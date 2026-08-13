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
} from "../../application";
import type { CompletedVoiceTurnRoute } from "../../integration/direct-command-voice-turn-bridge";
import type { NoteDecisionCompositionProvider } from "../decision";
import type {
  NoteDecisionInput,
  NoteDisambiguationCandidate,
  NoteToolId,
} from "../domain";
import type { FrozenWorldContext, UnifiedObjectWorld } from "../world";
import type { NoteToolContext, NoteToolRegistry } from "../tools";
import { buildDecisionInput, buildFrozenWorldContext } from "./note-agent-shadow-route";
import { NoteAgentShadowTraceStore } from "./note-agent-trace";
import { NoteRuntime, type NoteRuntimeResult } from "./note-runtime";
import { NoteRuntimeMetricsRecorder } from "./note-runtime-metrics";

export interface NoteAgentProductionRouteOptions {
  readonly contextBuilder: DirectCommandContextBuilder;
  readonly history: DirectCommandHistoryContext;
  readonly world: UnifiedObjectWorld;
  readonly registry: NoteToolRegistry;
  readonly provider: NoteDecisionCompositionProvider;
  readonly runtime?: NoteRuntime;
  readonly createToolContext: (
    frozenWorld: FrozenWorldContext,
    turnId: string,
    options: {
      readonly signal?: AbortSignal;
      readonly metrics: NoteRuntimeMetricsRecorder;
      readonly candidateSelection?: {
        readonly stepId: string;
        readonly alias: `${"C" | "S"}${number}`;
      };
    },
  ) => NoteToolContext;
  readonly traces?: NoteAgentShadowTraceStore;
  readonly now?: () => number;
}

/** Production owner for one CompletedVoiceTurn. No old route is executed. */
export class NoteAgentProductionRoute implements CompletedVoiceTurnRoute {
  public readonly traces: NoteAgentShadowTraceStore;
  private readonly runtime: NoteRuntime;
  private readonly registry = new DirectCommandExecutionRegistry();
  private readonly now: () => number;

  public constructor(private readonly options: NoteAgentProductionRouteOptions) {
    this.runtime = options.runtime ?? new NoteRuntime({ registry: options.registry });
    this.traces = options.traces ?? new NoteAgentShadowTraceStore();
    this.now = options.now ?? Date.now;
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
    const decisionInput = buildDecisionInput(
      documentId,
      directContext,
      this.options.registry.compactSchemas(baseContext),
    );
    const decisionStartedAt = this.now();
    let decision;
    try {
      decision = await this.options.provider.decide(decisionInput, { signal });
    } catch (error) {
      return this.recordFailure(
        turn,
        startedAt,
        providerErrorCode(error),
        1,
        elapsed(decisionStartedAt, this.now()),
      );
    }

    const runtimeStartedAt = this.now();
    let result = await this.runtime.execute(decision, baseContext);
    let disambiguationMs = 0;
    let llmCallCount: 1 | 2 = 1;
    if (result.status === "AMBIGUOUS") {
      const candidates = compactCandidates(result.candidates);
      if (candidates.length >= 2) {
        const disambiguationStartedAt = this.now();
        try {
          const choice = await this.options.provider.disambiguate({
            turnId: turn.id,
            language: turn.language,
            rawFinalTranscript: turn.rawTranscript,
            stepId: result.stepId,
            toolId: result.toolId,
            candidates,
          }, { signal });
          disambiguationMs = elapsed(disambiguationStartedAt, this.now());
          llmCallCount = 2;
          if (choice.status === "SELECTED") {
            result = await this.runtime.execute(
              decision,
              this.options.createToolContext(frozenWorld, turn.id, {
                ...(signal === undefined ? {} : { signal }),
                metrics,
                candidateSelection: {
                  stepId: result.stepId,
                  alias: choice.alias,
                },
              }),
            );
          }
        } catch (error) {
          return this.recordFailure(
            turn,
            startedAt,
            providerErrorCode(error),
            2,
            elapsed(decisionStartedAt, runtimeStartedAt),
            disambiguationMs,
          );
        }
      }
    }
    const completedAt = this.now();
    const routeResult = routeResultFor(turn.id, result);
    const runtimeMetrics = metrics.snapshot();
    this.traces.record({
      turnId: turn.id,
      pageId: turn.frozenContext.pageId,
      sceneRevision: turn.frozenContext.sceneRevision,
      shadowMode: false,
      decision,
      ...primaryTool(decisionInput, decision),
      resultStatus: result.status,
      llmCallCount,
      toolCallCount: decision.status === "CALL"
        ? 1
        : decision.status === "BATCH" ? decision.steps.length : 0,
      decisionMs: elapsed(decisionStartedAt, runtimeStartedAt),
      runtimeMs: elapsed(runtimeStartedAt, completedAt),
      resolverMs: runtimeMetrics.resolverMs,
      computeMs: runtimeMetrics.computeMs,
      placementMs: runtimeMetrics.placementMs,
      disambiguationMs,
      visualMs: result.status === "SUCCESS" ? result.receipt?.visualMs ?? 0 : 0,
      guardMs: result.status === "SUCCESS" ? result.receipt?.guardMs ?? 0 : 0,
      commitMs: result.status === "SUCCESS" ? result.receipt?.commitMs ?? 0 : 0,
      totalMs: elapsed(startedAt, completedAt),
      endToVisibleMs: elapsed(turn.completedAt ?? turn.startedAt, completedAt),
      commitAttempted: result.commitAttempted,
      recordedAt: completedAt,
    });
    return routeResult;
  }

  private recordFailure(
    turn: CompletedVoiceTurn,
    startedAt: number,
    errorCode: string,
    llmCallCount: 0 | 1 | 2,
    decisionMs = 0,
    disambiguationMs = 0,
  ): DirectCommandRouteResult {
    const completedAt = this.now();
    this.traces.record({
      turnId: turn.id,
      pageId: turn.frozenContext.pageId,
      sceneRevision: turn.frozenContext.sceneRevision,
      shadowMode: false,
      resultStatus: llmCallCount === 0 ? "CONTEXT_FAILED" : "DECISION_FAILED",
      errorCode,
      llmCallCount,
      toolCallCount: 0,
      decisionMs,
      runtimeMs: 0,
      disambiguationMs,
      totalMs: elapsed(startedAt, completedAt),
      endToVisibleMs: elapsed(turn.completedAt ?? turn.startedAt, completedAt),
      commitAttempted: false,
      recordedAt: completedAt,
    });
    return { status: "ERROR", turnId: turn.id, errorCode: directErrorCode(errorCode) };
  }
}

function compactCandidates(candidates: readonly unknown[]): readonly NoteDisambiguationCandidate[] {
  return candidates.slice(0, 6).flatMap((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const candidate = value as Record<string, unknown>;
    const alias = typeof candidate.alias === "string"
      ? candidate.alias
      : typeof candidate.label === "string" ? candidate.label : undefined;
    // S aliases are Stage 4 placement candidates and remain owned by its
    // bounded multimodal/preview path; this text-only fallback selects only
    // WorldResolver C aliases.
    if (alias === undefined || !/^C[1-9][0-9]*$/u.test(alias)) return [];
    return [{
      alias: alias as `${"C" | "S"}${number}`,
      ...(typeof candidate.kind === "string" ? { kind: candidate.kind } : {}),
      ...(typeof candidate.source === "string" ? { source: candidate.source } : {}),
      ...(typeof candidate.textPreview === "string"
        ? { textPreview: candidate.textPreview.slice(0, 160) }
        : {}),
    }];
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
  decision: Awaited<ReturnType<NoteDecisionCompositionProvider["decide"]>>,
): { readonly toolId?: NoteToolId } {
  const toolId = decision.status === "CALL"
    ? decision.call.toolId
    : decision.status === "BATCH" ? decision.steps[0]?.toolId : undefined;
  return toolId === undefined ? {} : { toolId };
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

function aborted(turnId: string): DirectCommandRouteResult {
  return { status: "ERROR", turnId, errorCode: "ABORTED" };
}

function elapsed(startedAt: number, completedAt: number): number {
  return Math.max(0, completedAt - startedAt);
}
