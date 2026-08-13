import type { InteractionClock } from "@ggulnote/interaction-core";
import type {
  DirectCommandExecutionResult,
  DirectEditorCommand,
  DirectCommandRouteErrorCode,
  ResolvedPlacement,
  ResolvedTarget,
  ReadyForDirectCommandExecution,
} from "../domain";
import type {
  DirectCommandHistoryContext,
  SpatialCommandExecutionPort,
} from "../application";
import type {
  Destination,
  EntityRef,
  FrozenWorldContext,
  NoteToolId,
  NoteTransactionPort,
  NoteTransactionResult,
  NoteTransactionStep,
} from "../note-agent";
import { spatialQueryForDestination } from "../note-agent";
import type { DirectCommandExecutor } from "./editor-direct-command-executor";

interface ExistingToolOutput {
  readonly existingCommand: Readonly<Record<string, unknown>>;
  readonly target?: EntityRef;
  readonly placement?: ResolvedPlacement;
  readonly destination?: Destination;
}

export interface EditorNoteAgentTransactionOptions {
  readonly executor: DirectCommandExecutor;
  readonly spatial?: SpatialCommandExecutionPort;
  readonly history: DirectCommandHistoryContext;
  readonly clock: Pick<InteractionClock, "now">;
  readonly getCurrentSceneRevision: () => number;
}

/** Compatibility adapter; all mutation still compiles through existing runtime. */
export class EditorNoteAgentTransaction implements NoteTransactionPort {
  public constructor(private readonly options: EditorNoteAgentTransactionOptions) {}

  public async commit(input: {
    readonly turnId: string;
    readonly frozenWorld: FrozenWorldContext;
    readonly steps: readonly NoteTransactionStep[];
    readonly signal?: AbortSignal;
  }): Promise<NoteTransactionResult> {
    if (input.steps.length !== 1) {
      return notAllowed("ONE_MUTATION_PER_TRANSACTION_REQUIRED");
    }
    if (
      input.signal?.aborted
      || this.options.getCurrentSceneRevision() !== input.frozenWorld.sceneRevision
    ) return { status: "STALE_SCENE", commitAttempted: false };
    const directContext = input.frozenWorld.directContext;
    if (directContext === undefined || directContext.turn.id !== input.turnId) {
      return failed("FROZEN_CONTEXT_UNAVAILABLE", false);
    }
    const step = input.steps[0];
    const output = readToolOutput(step);
    if (output === undefined) return failed("INVALID_COMPILED_TOOL_OUTPUT", false);
    const ready = compileReady(step, output, input.frozenWorld);
    if (ready.status !== "READY") return ready.result;

    if (output.placement !== undefined) {
      const spatial = this.options.spatial;
      if (spatial === undefined) return notAllowed("SPATIAL_RUNTIME_UNAVAILABLE");
      const resolution = await spatial.execute(ready.ready, {
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (resolution.result.status === "ERROR") {
        return mapExecutionFailure(resolution.result.errorCode, resolution.diagnostics.runtimeExecuted);
      }
      this.options.history.recordSuccessfulExecution(ready.ready, resolution.result);
      return {
        status: "SUCCESS",
        receipt: {
          ...receiptFor(resolution.result),
          guardMs: resolution.diagnostics.previewValidationMs,
          commitMs: resolution.diagnostics.commitMs,
          visualMs: resolution.diagnostics.multimodalMs,
        },
        commitAttempted: true,
      };
    }

    const result = await this.options.executor.execute(ready.ready);
    if (result.status === "ERROR") {
      return mapExecutionFailure(result.errorCode, commitStarted(result));
    }
    this.options.history.recordSuccessfulExecution(ready.ready, result);
    const timestamps = result.executionTimestamps;
    return {
      status: "SUCCESS",
      receipt: {
        ...receiptFor(result),
        guardMs: elapsed(timestamps?.compileStartedAt, timestamps?.compiledAt),
        commitMs: elapsed(timestamps?.commitStartedAt, timestamps?.committedAt),
        visualMs: 0,
      },
      commitAttempted: true,
    };
  }
}

function compileReady(
  step: NoteTransactionStep,
  output: ExistingToolOutput,
  world: FrozenWorldContext,
): { readonly status: "READY"; readonly ready: ReadyForDirectCommandExecution }
  | { readonly status: "ERROR"; readonly result: NoteTransactionResult } {
  const context = world.directContext;
  if (context === undefined) return { status: "ERROR", result: failed("FROZEN_CONTEXT_UNAVAILABLE", false) };
  const command = commandFor(step.toolId, output);
  if (command === undefined) return { status: "ERROR", result: failed("UNSUPPORTED_TOOL_COMPILE", false) };
  const target = output.target === undefined
    ? undefined
    : resolvedTargetFor(output.target, world);
  if (output.target !== undefined && target === undefined) {
    return { status: "ERROR", result: failed("INVALID_TARGET", false) };
  }
  const placementQuery = output.placement === undefined
    ? undefined
    : spatialQueryForDestination(output.destination, output.placement.relation);
  const planId = `note:${world.sceneRevision}:${context.turn.id}:${step.stepId}`;
  const ready: ReadyForDirectCommandExecution = {
    status: "READY_FOR_EXECUTION",
    turnId: context.turn.id,
    timestamps: { routeReceivedAt: Number(context.turn.completedAt ?? context.turn.startedAt) },
    context,
    plan: {
      status: "EXECUTABLE",
      planId,
      turnId: context.turn.id,
      sceneRevision: world.sceneRevision,
      normalizedIntent: context.turn.rawTranscript,
      relation: "NEW",
      command,
      ...(placementQuery === undefined ? {} : { placementQuery }),
    },
    ...(output.placement === undefined
      ? target === undefined ? {} : { target }
      : target === undefined ? {} : { spatialAnchorTarget: target }),
    disambiguationUsed: false,
  };
  return { status: "READY", ready };
}

function commandFor(
  toolId: NoteToolId,
  output: ExistingToolOutput,
): DirectEditorCommand | undefined {
  const existing = output.existingCommand;
  const payload = typeof existing.payload === "object" && existing.payload !== null
    ? existing.payload as Record<string, unknown>
    : {};
  switch (toolId) {
    case "text.create":
      return typeof payload.text !== "string" ? undefined : {
        capability: "text",
        operation: "create",
        target: { kind: "CURRENT_PAGE" },
        payload: { text: payload.text },
      };
    case "text.replace":
      return typeof payload.text !== "string" ? undefined : {
        capability: "text",
        operation: "replace_content",
        target: { kind: "relative", relation: "focused" },
        payload: { text: payload.text },
      };
    case "annotation.apply": {
      const operation = existing.operation;
      if (operation !== "underline" && operation !== "highlight") return undefined;
      return operation === "underline"
        ? {
            capability: "annotation",
            operation,
            target: { kind: "relative", relation: "focused" },
            payload: {},
          }
        : {
            capability: "annotation",
            operation,
            target: { kind: "relative", relation: "focused" },
            payload: typeof payload.color === "string" ? { color: payload.color } : {},
          };
    }
    case "navigation.next_page":
    case "navigation.previous_page":
      return {
        capability: "navigation",
        operation: toolId === "navigation.next_page" ? "next_page" : "previous_page",
        target: { kind: "CURRENT_PAGE" },
        payload: {},
      };
    case "history.undo":
      return {
        capability: "history",
        operation: "undo",
        target: { kind: "LAST_OPERATION" },
        payload: {},
      };
    default:
      return undefined;
  }
}

function resolvedTargetFor(
  ref: EntityRef,
  world: FrozenWorldContext,
): ResolvedTarget | undefined {
  if (ref.kind === "PAGE" || ref.kind === "OBJECT_PART") return undefined;
  const candidate = ref.kind === "OBJECT"
    ? world.catalog.candidates.find((entry) => entry.sceneObjectId === ref.objectId)
    : world.catalog.candidates.find((entry) =>
        entry.candidateId === ref.rangeId
        || (entry.sceneObjectId !== undefined && ref.objectIds.includes(entry.sceneObjectId)));
  if (candidate === undefined) return undefined;
  if (ref.kind === "OBJECT") {
    return {
      kind: "object",
      candidateId: candidate.candidateId,
      pageId: candidate.pageId,
      sceneRevision: world.sceneRevision,
      source: candidate.source,
      type: candidate.type,
      editable: candidate.editable,
      annotatable: candidate.annotatable,
      objectId: ref.objectId,
      ...(candidate.bounds === undefined ? {} : { bounds: { ...candidate.bounds } }),
    };
  }
  return {
    kind: "text_span",
    candidateId: candidate.candidateId,
    pageId: candidate.pageId,
    sceneRevision: world.sceneRevision,
    source: candidate.source,
    type: candidate.type,
    editable: candidate.editable,
    annotatable: candidate.annotatable,
    ...(candidate.sceneObjectId === undefined ? {} : { objectId: candidate.sceneObjectId }),
    text: candidate.text ?? "",
    bounds: ref.rects.map((rect) => ({ ...rect })),
  };
}

function readToolOutput(step: NoteTransactionStep): ExistingToolOutput | undefined {
  if (typeof step.data !== "object" || step.data === null || Array.isArray(step.data)) return undefined;
  const data = step.data as Record<string, unknown>;
  if (typeof data.existingCommand !== "object" || data.existingCommand === null) return undefined;
  return data as unknown as ExistingToolOutput;
}

function mapExecutionFailure(
  errorCode: DirectCommandRouteErrorCode,
  commitAttempted: boolean,
): NoteTransactionResult {
  if (errorCode === "STALE_SCENE") return { status: "STALE_SCENE", commitAttempted };
  if (errorCode === "TARGET_NOT_FOUND") return { status: "NOT_FOUND", commitAttempted };
  if (errorCode === "NO_FEASIBLE_PLACEMENT") {
    return { status: "NO_FEASIBLE_PLACEMENT", commitAttempted };
  }
  if (
    errorCode === "TARGET_NOT_EDITABLE"
    || errorCode === "TARGET_NOT_ANNOTATABLE"
    || errorCode === "TARGET_KIND_UNSUPPORTED"
    || errorCode === "UNSUPPORTED_CAPABILITY"
    || errorCode === "UNDO_NOT_AVAILABLE"
  ) return { status: "NOT_ALLOWED", reasonCode: errorCode, commitAttempted };
  return failed(errorCode, commitAttempted);
}

function receiptFor(result: Exclude<DirectCommandExecutionResult, { status: "ERROR" }>) {
  switch (result.status) {
    case "COMMITTED":
      return {
        kind: "COMMITTED" as const,
        planId: result.planId,
        operationId: result.operationId,
        ...(result.annotationId === undefined ? {} : { annotationId: result.annotationId }),
      };
    case "NAVIGATED": return { kind: "NAVIGATED" as const, direction: result.direction };
    case "UNDONE": return {
      kind: "UNDONE" as const,
      ...(result.operationId === undefined ? {} : { operationId: result.operationId }),
    };
  }
}

function commitStarted(result: Extract<DirectCommandExecutionResult, { status: "ERROR" }>): boolean {
  return result.executionTimestamps?.commitStartedAt !== undefined;
}

function elapsed(start: number | undefined, end: number | undefined): number {
  return start === undefined || end === undefined ? 0 : Math.max(0, end - start);
}

function notAllowed(reasonCode: string): NoteTransactionResult {
  return { status: "NOT_ALLOWED", reasonCode, commitAttempted: false };
}

function failed(reasonCode: string, commitAttempted: boolean): NoteTransactionResult {
  return { status: "FAILED", reasonCode, commitAttempted };
}
