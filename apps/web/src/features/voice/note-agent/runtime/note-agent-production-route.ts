import {
  DirectAiProviderError,
  type CompletedVoiceTurn,
  type DirectCommandRouteErrorCode,
  type DirectCommandRouteResult,
} from "../../domain";
import {
  DirectCommandExecutionRegistry,
  type DirectCommandContextBuilder,
  type DirectCommandHistoryContext,
  type SpatialScreenshotMarker,
  type SpatialScreenshotSourceResult,
} from "../../application";
import type { CompletedVoiceTurnRoute } from "../../integration/direct-command-voice-turn-bridge";
import type { NoteDecisionProvider } from "../decision";
import { NOTE_DECISION_SCHEMA_VERSION } from "../decision/note-decision-json-schema";
import {
  NoteContextAssembler,
  type NotePageActivationInput,
} from "../context";
import type {
  NoteDecisionInput,
  NoteToolId,
  ObjectHandle,
} from "../domain";
import type { FrozenWorldContext, UnifiedObjectWorld } from "../world";
import {
  AllEnabledActionsLoader,
  type NoteRuntimeContext,
  type NoteToolRegistry,
} from "../tools";
import { buildFrozenWorldContext } from "./note-agent-shadow-route";
import { NoteAgentShadowTraceStore } from "./note-agent-trace";
import { NoteRuntime, type NoteRuntimeResult } from "./note-runtime";
import { NoteRuntimeMetricsRecorder } from "./note-runtime-metrics";

export interface NoteAgentProductionRouteOptions {
  readonly contextBuilder: DirectCommandContextBuilder;
  readonly history: DirectCommandHistoryContext;
  readonly world: UnifiedObjectWorld;
  readonly registry: NoteToolRegistry;
  readonly provider: NoteDecisionProvider;
  readonly runtime?: NoteRuntime;
  readonly contextAssembler?: NoteContextAssembler;
  readonly createToolContext: (
    frozenWorld: FrozenWorldContext,
    turnId: string,
    options: {
      readonly signal?: AbortSignal;
      readonly metrics: NoteRuntimeMetricsRecorder;
    },
  ) => NoteRuntimeContext;
  readonly traces?: NoteAgentShadowTraceStore;
  readonly now?: () => number;
  readonly getTldrawProjectionMs?: () => number;
  readonly captureVisualContext?: (
    frozenWorld: FrozenWorldContext,
    markers: readonly SpatialScreenshotMarker[],
    signal?: AbortSignal,
  ) => Promise<SpatialScreenshotSourceResult>;
}

/** Production owner for one CompletedVoiceTurn. No old route is executed. */
export class NoteAgentProductionRoute implements CompletedVoiceTurnRoute {
  public readonly traces: NoteAgentShadowTraceStore;
  private readonly runtime: NoteRuntime;
  private readonly contextAssembler: NoteContextAssembler;
  private readonly registry = new DirectCommandExecutionRegistry();
  private readonly now: () => number;

  public constructor(private readonly options: NoteAgentProductionRouteOptions) {
    this.runtime = options.runtime ?? new NoteRuntime({ registry: options.registry });
    this.contextAssembler = options.contextAssembler ?? new NoteContextAssembler({
      actionLoader: new AllEnabledActionsLoader(options.registry),
    });
    this.traces = options.traces ?? new NoteAgentShadowTraceStore();
    this.now = options.now ?? Date.now;
  }

  public activatePage(
    input: NotePageActivationInput,
  ): boolean {
    return this.contextAssembler.activatePage(input) !== null;
  }

  public execute(
    turn: CompletedVoiceTurn,
    executeOptions: { readonly signal?: AbortSignal } = {},
  ): Promise<DirectCommandRouteResult> {
    return this.registry.execute(turn.id, () => this.executeOnce(turn, executeOptions.signal));
  }

  public dispose(): void {
    this.registry.clear();
    this.traces.clear();
  }

  private async executeOnce(
    turn: CompletedVoiceTurn,
    signal: AbortSignal | undefined,
  ): Promise<DirectCommandRouteResult> {
    const startedAt = this.now();
    if (signal?.aborted) return aborted(turn.id);
    const contextResult = this.options.contextBuilder.build(turn, {
      historySnapshot: this.options.history.snapshot(),
    });
    if (contextResult.status !== "READY") {
      return this.recordFailure(turn, startedAt, contextResult.errorCode, 0);
    }
    const directContext = contextResult.context;
    const documentId = directContext.pageTargetCatalog.documentId;
    if (
      documentId === undefined
      || this.options.world.getSnapshot(
        directContext.frozenContext.pageId,
        directContext.frozenContext.sceneRevision,
      ) === undefined
    ) return this.recordFailure(turn, startedAt, "STALE_SCENE", 0);

    const frozenWorld = buildFrozenWorldContext(documentId, directContext);
    const metrics = new NoteRuntimeMetricsRecorder(this.now);
    const baseContext = this.options.createToolContext(frozenWorld, turn.id, {
      ...(signal === undefined ? {} : { signal }),
      metrics,
    });
    let decisionInput: NoteDecisionInput;
    let handles: import("../context").NoteObjectHandleMap;
    let objectCatalogBuildMs = 0;
    let objectCatalogObjectCount = 0;
    let objectCatalogSerializedChars = 0;
    let visualContextTrace: VisualContextTrace = NO_VISUAL_CONTEXT;
    const contextAssemblyStartedAt = this.now();
    try {
      const assembly = await this.contextAssembler.assemble({
        turn,
        documentId,
        frozenWorld,
        world: this.options.world,
        toolContext: baseContext,
      });
      decisionInput = assembly.decisionInput;
      handles = assembly.handles;
      objectCatalogBuildMs = assembly.objectCatalogBuildMs;
      objectCatalogObjectCount = assembly.objectCatalogObjectCount;
      objectCatalogSerializedChars = assembly.objectCatalogSerializedChars;
    } catch {
      return this.recordFailure(
        turn,
        startedAt,
        "CONTEXT_ASSEMBLY_FAILED",
        0,
        0,
        0,
        elapsed(contextAssemblyStartedAt, this.now()),
      );
    }
    const screenshotMarkers = decisionInput.objectCatalog.objects.map((object) => ({
      id: object.handle,
      kind: object.kind,
      bounds: object.bounds,
    })) satisfies readonly SpatialScreenshotMarker[];
    if (this.options.captureVisualContext !== undefined) {
      visualContextTrace = {
        visualContextRequested: true,
        visualContextAttached: false,
        visualContextCaptureMs: 0,
        markedScreenshotObjectCount: screenshotMarkers.length,
        markedScreenshotHandles: screenshotMarkers.map((marker) => marker.id as ObjectHandle),
      };
      const visualStartedAt = this.now();
      try {
        const captured = await this.options.captureVisualContext(
          frozenWorld,
          screenshotMarkers,
          signal,
        );
        visualContextTrace = {
          ...visualContextTrace,
          visualContextCaptureMs: elapsed(visualStartedAt, this.now()),
        };
        if (captured.status === "READY"
          && captured.screenshot.pageId === frozenWorld.pageId
          && captured.screenshot.sceneRevision === frozenWorld.sceneRevision
          && screenshotMarkersMatch(screenshotMarkers, captured.screenshot.markers)) {
          decisionInput = {
            ...decisionInput,
            visualContext: {
              mimeType: captured.screenshot.imageDataUrl.startsWith("data:image/jpeg;")
                ? "image/jpeg"
                : "image/png",
              imageDataUrl: captured.screenshot.imageDataUrl,
              pixelWidth: captured.screenshot.pixelWidth,
              pixelHeight: captured.screenshot.pixelHeight,
              byteLength: captured.screenshot.byteLength,
              markedObjects: decisionInput.objectCatalog.objects.map((object) => ({
                objectId: object.handle,
                kind: object.kind,
                bounds: object.bounds,
              })),
            },
          };
          visualContextTrace = {
            ...visualContextTrace,
            visualContextAttached: true,
          };
        } else if (captured.status === "CANCELLED" && signal?.aborted) {
          return this.recordFailure(
            turn,
            startedAt,
            "ABORTED",
            0,
            0,
            0,
            elapsed(contextAssemblyStartedAt, this.now()),
            { ...visualContextTrace, visualContextFailureReason: "CANCELLED" },
          );
        } else {
          visualContextTrace = {
            ...visualContextTrace,
            visualContextFailureReason: captured.status === "READY"
              ? captured.screenshot.pageId !== frozenWorld.pageId
                || captured.screenshot.sceneRevision !== frozenWorld.sceneRevision
                ? "STALE_SCENE"
                : "MARKER_MISMATCH"
              : captured.status,
          };
        }
      } catch {
        visualContextTrace = {
          ...visualContextTrace,
          visualContextCaptureMs: elapsed(visualStartedAt, this.now()),
          visualContextFailureReason: "CAPTURE_FAILED",
        };
      }
    }
    const contextAssemblyMs = elapsed(contextAssemblyStartedAt, this.now());
    const decisionStartedAt = this.now();
    let decisionTelemetry: Parameters<NonNullable<import("../decision").NoteDecisionProviderOptions["onTelemetry"]>>[0]
      | undefined;
    let decision;
    try {
      decision = await this.options.provider.decide(decisionInput, {
        ...(signal === undefined ? {} : { signal }),
        onTelemetry: (telemetry) => {
          decisionTelemetry = telemetry;
        },
      });
    } catch (error) {
      return this.recordFailure(
        turn,
        startedAt,
        providerErrorCode(error),
        1,
        elapsed(decisionStartedAt, this.now()),
        0,
        contextAssemblyMs,
        visualContextTrace,
      );
    }

    const runtimeStartedAt = this.now();
    const result = await this.runtime.execute(decision, { ...baseContext, handles });
    const disambiguationMs = 0;
    const llmCallCount = 1 as const;
    const completedAt = this.now();
    const routeResult = routeResultFor(turn.id, result);
    const runtimeMetrics = metrics.snapshot();
    const visualMs = result.status === "SUCCESS" ? result.receipt?.visualMs ?? 0 : 0;
    const visualCallCount = result.status === "SUCCESS"
      ? result.receipt?.visualCallCount ?? 0
      : 0;
    this.traces.record({
      runtimeOwner: "note-agent-v2",
      decisionSchemaVersion: NOTE_DECISION_SCHEMA_VERSION,
      turnId: turn.id,
      pageId: turn.frozenContext.pageId,
      sceneRevision: turn.frozenContext.sceneRevision,
      shadowMode: false,
      decision,
      ...primaryTool(decisionInput, decision),
      resultStatus: result.status,
      ...runtimeFailureDiagnostics(result),
      llmCallCount,
      decisionCallCount: llmCallCount,
      toolCallCount: decision.status === "READY"
        ? decision.steps.length
        : decision.status === "CALL"
        ? 1
        : decision.status === "BATCH" ? decision.steps.length : 0,
      contextAssemblyMs,
      tldrawProjectionMs: this.options.getTldrawProjectionMs?.() ?? 0,
      objectCatalogBuildMs,
      objectCatalogObjectCount,
      objectCatalogSerializedChars,
      ...visualContextTrace,
      catalogHandles: decisionInput.objectCatalog.objects.map((object) => object.handle),
      ...decisionDiagnostics(decision),
      ...runtimeGroundingDiagnostics(result),
      legacyPlannerInvoked: false,
      fuzzyObjectSelectorInvoked: false,
      decisionMs: elapsed(decisionStartedAt, runtimeStartedAt),
      decisionTotalMs: elapsed(decisionStartedAt, runtimeStartedAt),
      openaiTtfbMs: decisionTelemetry?.openaiTtfbMs ?? 0,
      openaiBodyReadMs: decisionTelemetry?.openaiBodyReadMs ?? 0,
      decisionJsonParseMs: decisionTelemetry?.decisionJsonParseMs ?? 0,
      ...(decisionTelemetry?.inputTokens === undefined
        ? {}
        : { inputTokens: decisionTelemetry.inputTokens }),
      ...(decisionTelemetry?.cachedInputTokens === undefined
        ? {}
        : { cachedInputTokens: decisionTelemetry.cachedInputTokens }),
      ...(decisionTelemetry?.outputTokens === undefined
        ? {}
        : { outputTokens: decisionTelemetry.outputTokens }),
      runtimeMs: elapsed(runtimeStartedAt, completedAt),
      prepareMs: runtimeMetrics.prepareMs,
      worldResolveMs: runtimeMetrics.resolverMs,
      resolverMs: runtimeMetrics.resolverMs,
      computeMs: runtimeMetrics.computeMs,
      placementMs: runtimeMetrics.placementMs,
      disambiguationMs,
      visualMs,
      visualFallbackMs: visualMs,
      visualCallCount,
      guardMs: result.status === "SUCCESS" ? result.receipt?.guardMs ?? 0 : 0,
      commitMs: result.status === "SUCCESS" ? result.receipt?.commitMs ?? 0 : 0,
      totalMs: elapsed(startedAt, completedAt),
      endToVisibleMs: elapsed(turn.completedAt ?? turn.startedAt, completedAt),
      // Rendering is owned by the Editor subscriber and is not separately observable here.
      renderMs: 0,
      usedAmbiguityPass: false,
      usedVisualFallback: visualCallCount > 0,
      commitAttempted: result.commitAttempted,
      recordedAt: completedAt,
    });
    return routeResult;
  }

  private recordFailure(
    turn: CompletedVoiceTurn,
    startedAt: number,
    errorCode: string,
    llmCallCount: 0 | 1,
    decisionMs = 0,
    disambiguationMs = 0,
    contextAssemblyMs = 0,
    visualContextTrace: VisualContextTrace = NO_VISUAL_CONTEXT,
  ): DirectCommandRouteResult {
    const completedAt = this.now();
    this.traces.record({
      runtimeOwner: "note-agent-v2",
      decisionSchemaVersion: NOTE_DECISION_SCHEMA_VERSION,
      turnId: turn.id,
      pageId: turn.frozenContext.pageId,
      sceneRevision: turn.frozenContext.sceneRevision,
      shadowMode: false,
      resultStatus: llmCallCount === 0 ? "CONTEXT_FAILED" : "DECISION_FAILED",
      errorCode,
      llmCallCount,
      decisionCallCount: llmCallCount,
      toolCallCount: 0,
      legacyPlannerInvoked: false,
      fuzzyObjectSelectorInvoked: false,
      contextAssemblyMs,
      ...visualContextTrace,
      decisionMs,
      runtimeMs: 0,
      prepareMs: 0,
      worldResolveMs: 0,
      disambiguationMs,
      visualFallbackMs: 0,
      visualCallCount: 0,
      renderMs: 0,
      usedAmbiguityPass: false,
      usedVisualFallback: false,
      totalMs: elapsed(startedAt, completedAt),
      endToVisibleMs: elapsed(turn.completedAt ?? turn.startedAt, completedAt),
      commitAttempted: false,
      recordedAt: completedAt,
    });
    return { status: "ERROR", turnId: turn.id, errorCode: directErrorCode(errorCode) };
  }
}

interface VisualContextTrace {
  readonly visualContextRequested: boolean;
  readonly visualContextAttached: boolean;
  readonly visualContextCaptureMs: number;
  readonly visualContextFailureReason?: string;
  readonly markedScreenshotObjectCount?: number;
  readonly markedScreenshotHandles?: readonly ObjectHandle[];
}

const NO_VISUAL_CONTEXT: VisualContextTrace = Object.freeze({
  visualContextRequested: false,
  visualContextAttached: false,
  visualContextCaptureMs: 0,
});

function screenshotMarkersMatch(
  expected: readonly SpatialScreenshotMarker[],
  actual: readonly SpatialScreenshotMarker[],
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((marker, index) => {
    const candidate = actual[index];
    if (candidate === undefined || marker.id !== candidate.id) return false;
    return marker.bounds.x === candidate.bounds.x
      && marker.bounds.y === candidate.bounds.y
      && marker.bounds.width === candidate.bounds.width
      && marker.bounds.height === candidate.bounds.height;
  });
}

function routeResultFor(turnId: string, result: NoteRuntimeResult): DirectCommandRouteResult {
  switch (result.status) {
    case "SUCCESS": {
      const receipt = result.receipt;
      if (receipt?.kind === "COMMITTED" && receipt.planId !== undefined && receipt.operationId !== undefined) {
        return {
          status: "COMMITTED",
          turnId,
          planId: receipt.planId,
          operationId: receipt.operationId,
          ...(receipt.annotationId === undefined ? {} : { annotationId: receipt.annotationId }),
        };
      }
      if (receipt?.kind === "NAVIGATED" && receipt.direction !== undefined) {
        return { status: "NAVIGATED", turnId, direction: receipt.direction };
      }
      if (receipt?.kind === "UNDONE") {
        return {
          status: "UNDONE",
          turnId,
          ...(receipt.operationId === undefined ? {} : { operationId: receipt.operationId }),
        };
      }
      const last = result.steps.at(-1);
      return {
        status: "COMPUTED",
        turnId,
        toolId: last?.toolId ?? "note.no_op",
        data: result.steps.map((step) =>
          step.result.status === "SUCCESS" ? step.result.data : null),
      };
    }
    case "AMBIGUOUS": return { status: "TARGET_AMBIGUOUS", turnId };
    case "NOT_FOUND": return { status: "TARGET_NOT_FOUND", turnId };
    case "NEEDS_INPUT": return { status: "NEEDS_CLARIFICATION", turnId };
    case "UNSUPPORTED": return { status: "UNSUPPORTED", turnId };
    case "NO_OP": return { status: "CANCELLED", turnId };
    case "STALE_SCENE": return { status: "ERROR", turnId, errorCode: "STALE_SCENE" };
    case "NO_FEASIBLE_PLACEMENT":
      return { status: "ERROR", turnId, errorCode: "NO_FEASIBLE_PLACEMENT" };
    case "NOT_ALLOWED":
      return { status: "ERROR", turnId, errorCode: directErrorCode(result.reasonCode) };
    case "FAILED":
      return { status: "ERROR", turnId, errorCode: directErrorCode(result.reasonCode) };
  }
}

function primaryTool(
  _input: NoteDecisionInput,
  decision: Awaited<ReturnType<NoteDecisionProvider["decide"]>>,
): { readonly toolId?: NoteToolId } {
  const toolId = decision.status === "CALL"
    ? decision.call.toolId
    : decision.status === "BATCH" ? decision.steps[0]?.toolId
      : decision.status === "READY" ? decision.steps[0]?.action : undefined;
  return toolId === undefined ? {} : { toolId };
}

function decisionDiagnostics(
  decision: Awaited<ReturnType<NoteDecisionProvider["decide"]>>,
): {
  readonly selectedHandle?: `O${number}`;
  readonly decisionStatus: typeof decision.status;
  readonly decisionAction?: NoteToolId;
  readonly decisionPlacement?: import("../domain").CanvasPlacement;
} {
  const step = decision.status === "READY" ? decision.steps[0] : undefined;
  const targetHandle = step?.target?.object ?? undefined;
  return {
    decisionStatus: decision.status,
    ...(step === undefined ? {} : { decisionAction: step.action }),
    ...(targetHandle === undefined ? {} : { selectedHandle: targetHandle }),
    ...(step?.placement === null || step?.placement === undefined
      ? {}
      : { decisionPlacement: { ...step.placement } }),
  };
}

function runtimeGroundingDiagnostics(
  result: NoteRuntimeResult,
): Pick<
  import("./note-agent-trace").NoteAgentShadowTrace,
  "groundingMode" | "resolvedTargetHandle" | "resolvedCanvasBounds" | "finalLocalOperation"
> {
  if (result.status !== "SUCCESS") return {};
  const step = result.steps.find((candidate) => candidate.grounding !== undefined);
  const grounding = step?.grounding;
  const finalLocalOperation = result.steps.at(-1)?.toolId;
  return {
    ...(grounding === undefined ? {} : {
      groundingMode: grounding.mode,
      ...(grounding.objectHandle === undefined
        ? {}
        : { resolvedTargetHandle: grounding.objectHandle }),
      resolvedCanvasBounds: { ...grounding.canvasBounds },
    }),
    ...(finalLocalOperation === undefined ? {} : { finalLocalOperation }),
  };
}

function providerErrorCode(error: unknown): string {
  if (error instanceof DirectAiProviderError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "ABORTED";
  return "PLANNER_ERROR";
}

function directErrorCode(value: string): DirectCommandRouteErrorCode {
  const known: readonly DirectCommandRouteErrorCode[] = [
    "EMPTY_TRANSCRIPT", "PLANNER_ERROR", "PLANNER_UNAVAILABLE", "PLANNER_TIMEOUT",
    "PLANNER_INVALID_OUTPUT", "INVALID_PLAN", "TARGET_NOT_FOUND", "TARGET_AMBIGUOUS",
    "INVALID_TARGET", "TARGET_NOT_EDITABLE", "TARGET_NOT_ANNOTATABLE",
    "TARGET_KIND_UNSUPPORTED", "STALE_SCENE", "SPATIAL_REQUIRED",
    "NO_FEASIBLE_PLACEMENT", "MULTIMODAL_UNRESOLVED", "PREVIEW_UNAVAILABLE",
    "PREVIEW_RENDER_FAILED", "VALIDATION_FAILED", "UNSUPPORTED_CAPABILITY",
    "INVALID_SPATIAL_SCENE", "UNSUPPORTED_COMMAND", "DUPLICATE_TURN", "COMPILE_FAILED",
    "COMMIT_FAILED", "REVISE_NOT_AVAILABLE", "UNSUPPORTED_RELATION",
    "UNDO_NOT_AVAILABLE", "ABORTED",
  ];
  return known.includes(value as DirectCommandRouteErrorCode)
    ? value as DirectCommandRouteErrorCode
    : "UNSUPPORTED_COMMAND";
}

function runtimeFailureDiagnostics(
  result: NoteRuntimeResult,
): { readonly errorCode?: string } {
  switch (result.status) {
    case "SUCCESS":
    case "AMBIGUOUS":
    case "NEEDS_INPUT":
    case "NO_OP":
      return {};
    case "NOT_ALLOWED":
    case "FAILED":
    case "UNSUPPORTED":
      return { errorCode: result.reasonCode };
    case "NOT_FOUND":
    case "NO_FEASIBLE_PLACEMENT":
    case "STALE_SCENE":
      return { errorCode: result.status };
  }
}

function aborted(turnId: string): DirectCommandRouteResult {
  return { status: "ERROR", turnId, errorCode: "ABORTED" };
}

function elapsed(startedAt: number, completedAt: number): number {
  return Math.max(0, completedAt - startedAt);
}
