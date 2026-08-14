import {
  AnnotationFactory,
  CreateAnnotationCommand,
  UpdateAnnotationCommand,
  type EditorCommand,
  type EditorEngine,
  type SerializedAnnotation,
} from "@ggulnote/editor-core";
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
  PreparedSpatialPlacement,
  SpatialCommandExecutionPort,
} from "../application";
import { compileDirectCommandCapability } from "../application";
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
import { editorAnnotationSceneId } from "./editor-voice-context";

interface ExistingToolOutput {
  readonly existingCommand: Readonly<Record<string, unknown>>;
  readonly target?: EntityRef;
  readonly placement?: ResolvedPlacement;
  readonly destination?: Destination;
  readonly preparedSpatial?: PreparedSpatialPlacement;
  readonly spatialDecisionInstruction?: string;
}

export interface EditorNoteAgentTransactionOptions {
  readonly editorEngine: EditorEngine;
  readonly executor: DirectCommandExecutor;
  readonly spatial?: SpatialCommandExecutionPort;
  readonly history: DirectCommandHistoryContext;
  readonly clock: Pick<InteractionClock, "now">;
  readonly getCurrentSceneRevision: () => number;
}

/** Compatibility adapter; all mutation still compiles through existing runtime. */
export class EditorNoteAgentTransaction implements NoteTransactionPort {
  private readonly annotationFactory = new AnnotationFactory();

  public constructor(private readonly options: EditorNoteAgentTransactionOptions) {}

  public async commit(input: {
    readonly turnId: string;
    readonly frozenWorld: FrozenWorldContext;
    readonly steps: readonly NoteTransactionStep[];
    readonly signal?: AbortSignal;
  }): Promise<NoteTransactionResult> {
    if (input.steps.length === 0) return failed("EMPTY_PREPARED_BATCH", false);
    if (
      input.signal?.aborted
      || this.options.getCurrentSceneRevision() !== input.frozenWorld.sceneRevision
    ) return { status: "STALE_SCENE", commitAttempted: false };
    const directContext = input.frozenWorld.directContext;
    if (directContext === undefined || directContext.turn.id !== input.turnId) {
      return failed("FROZEN_CONTEXT_UNAVAILABLE", false);
    }
    const prepared = input.steps.map((step) => {
      const output = readToolOutput(step);
      if (output === undefined) return undefined;
      const ready = compileReady(step, output, input.frozenWorld);
      return ready.status === "READY" ? { step, output, ready: ready.ready } : ready;
    });
    if (prepared.some((entry) => entry === undefined)) {
      return failed("INVALID_COMPILED_TOOL_OUTPUT", false);
    }
    const invalid = prepared.find((entry) => entry !== undefined && "status" in entry);
    if (invalid !== undefined && "status" in invalid) return invalid.result;
    const commands = prepared.filter((entry): entry is {
      readonly step: NoteTransactionStep;
      readonly output: ExistingToolOutput;
      readonly ready: ReadyForDirectCommandExecution;
    } => entry !== undefined && !("status" in entry));

    const spatialCommands = commands.filter((entry) => entry.output.placement !== undefined);
    if (spatialCommands.length > 0) {
      if (commands.length !== 1) return notAllowed("MIXED_SPATIAL_BATCH_UNSUPPORTED");
      return this.commitSpatial(commands[0] as typeof commands[number], input.signal);
    }

    const compiled = commands.map((entry) => ({
      entry,
      compiled: compileDirectCommandCapability(entry.ready, {
        pageSize: this.options.editorEngine.getActivePageSize() ?? undefined,
      }),
    }));
    const compileError = compiled.find((entry) => entry.compiled.status === "ERROR");
    if (compileError?.compiled.status === "ERROR") {
      return mapExecutionFailure(compileError.compiled.errorCode, false);
    }
    const instructions = compiled.map((entry) => ({
      entry: entry.entry,
      instruction: entry.compiled.status === "COMPILED" ? entry.compiled.instruction : undefined,
    }));
    if (instructions.some((entry) => entry.instruction === undefined)) {
      return failed("COMPILE_FAILED", false);
    }
    const control = instructions.filter((entry) =>
      entry.instruction?.kind === "NAVIGATE" || entry.instruction?.kind === "UNDO");
    if (control.length > 0) {
      if (instructions.length !== 1) return notAllowed("MIXED_CONTROL_BATCH_UNSUPPORTED");
      return this.commitControl(commands[0] as typeof commands[number]);
    }

    const guardStartedAt = Number(this.options.clock.now());
    const editorCommands: EditorCommand[] = [];
    const annotationIds: string[] = [];
    const undoGroupId = `turn:${input.turnId}`;
    for (const { entry, instruction } of instructions) {
      if (instruction === undefined) return failed("COMPILE_FAILED", false);
      const compiledCommand = this.editorCommandFor(
        entry.ready,
        instruction,
        undoGroupId,
      );
      if (compiledCommand === undefined) return failed("COMPILE_FAILED", false);
      editorCommands.push(compiledCommand.command);
      annotationIds.push(compiledCommand.annotationId);
    }
    if (
      input.signal?.aborted
      || this.options.getCurrentSceneRevision() !== input.frozenWorld.sceneRevision
    ) return { status: "STALE_SCENE", commitAttempted: false };
    const commitStartedAt = Number(this.options.clock.now());
    try {
      const committed = this.options.editorEngine.executeCommandBatch(editorCommands);
      const committedAt = Number(this.options.clock.now());
      for (const [index, entry] of commands.entries()) {
        const annotationId = annotationIds[index];
        if (annotationId === undefined) return failed("COMMIT_FAILED", true);
        this.options.history.recordSuccessfulExecution(entry.ready, {
          status: "COMMITTED",
          turnId: input.turnId,
          planId: entry.ready.plan.planId,
          operationId: committed.operation.operationId,
          annotationId,
        });
      }
      const lastCommand = commands.at(-1);
      const lastAnnotationId = annotationIds.at(-1);
      return {
        status: "SUCCESS",
        receipt: {
          kind: "COMMITTED",
          ...(lastCommand === undefined ? {} : { planId: lastCommand.ready.plan.planId }),
          operationId: committed.operation.operationId,
          ...(lastAnnotationId === undefined ? {} : { annotationId: lastAnnotationId }),
          guardMs: Math.max(0, commitStartedAt - guardStartedAt),
          commitMs: Math.max(0, committedAt - commitStartedAt),
          visualMs: 0,
          visualCallCount: 0,
        },
        commitAttempted: true,
      };
    } catch {
      return failed("COMMIT_FAILED", true);
    }
  }

  private async commitSpatial(
    command: {
      readonly output: ExistingToolOutput;
      readonly ready: ReadyForDirectCommandExecution;
    },
    signal: AbortSignal | undefined,
  ): Promise<NoteTransactionResult> {
    const { output, ready } = command;
    if (output.placement !== undefined) {
      const spatial = this.options.spatial;
      if (spatial === undefined) return notAllowed("SPATIAL_RUNTIME_UNAVAILABLE");
      const executionOptions = signal === undefined ? {} : { signal };
      const resolution = output.preparedSpatial === undefined
        ? await spatial.execute(ready, executionOptions)
        : spatial.executePrepared === undefined
          ? undefined
          : await spatial.executePrepared(ready, output.preparedSpatial, executionOptions);
      if (resolution === undefined) return notAllowed("PREPARED_SPATIAL_COMMIT_UNAVAILABLE");
      if (resolution.result.status === "ERROR") {
        return mapExecutionFailure(resolution.result.errorCode, resolution.diagnostics.runtimeExecuted);
      }
      this.options.history.recordSuccessfulExecution(ready, resolution.result);
      return {
        status: "SUCCESS",
        receipt: {
          ...receiptFor(resolution.result),
          guardMs: resolution.diagnostics.previewValidationMs,
          commitMs: resolution.diagnostics.commitMs,
          visualMs: resolution.diagnostics.multimodalMs,
          visualCallCount: resolution.diagnostics.multimodalCallCount > 0 ? 1 : 0,
        },
        commitAttempted: true,
      };
    }
    return failed("SPATIAL_PLACEMENT_MISSING", false);
  }

  private async commitControl(command: {
    readonly ready: ReadyForDirectCommandExecution;
  }): Promise<NoteTransactionResult> {
    const ready = command.ready;
    const result = await this.options.executor.execute(ready);
    if (result.status === "ERROR") {
      return mapExecutionFailure(result.errorCode, commitStarted(result));
    }
    this.options.history.recordSuccessfulExecution(ready, result);
    const timestamps = result.executionTimestamps;
    return {
      status: "SUCCESS",
      receipt: {
        ...receiptFor(result),
        guardMs: elapsed(timestamps?.compileStartedAt, timestamps?.compiledAt),
        commitMs: elapsed(timestamps?.commitStartedAt, timestamps?.committedAt),
        visualMs: 0,
        visualCallCount: 0,
      },
      commitAttempted: true,
    };
  }

  private editorCommandFor(
    ready: ReadyForDirectCommandExecution,
    instruction: import("../domain").DirectCommandRuntimeInstruction,
    undoGroupId: string,
  ): { readonly command: EditorCommand; readonly annotationId: string } | undefined {
    const metadata = {
      sourceTurnId: ready.turnId,
      toolId: `${ready.plan.command.capability}.${ready.plan.command.operation}`,
      undoGroupId,
    };
    const documentId = ready.context.pageTargetCatalog.documentId;
    if (documentId === undefined) return undefined;
    if (instruction.kind === "CREATE_ANNOTATION") {
      const targetObjectIds = ready.target?.objectId === undefined
        ? undefined
        : [ready.target.objectId];
      const annotation = this.annotationFactory.create({
        ...instruction.input,
        createdByTurnId: ready.turnId,
        ...(targetObjectIds === undefined ? {} : { targetObjectIds }),
      });
      return {
        command: new CreateAnnotationCommand(
          annotation,
          documentId,
          metadata,
        ),
        annotationId: annotation.id,
      };
    }
    if (instruction.kind !== "REPLACE_TEXT_CONTENT") return undefined;
    const target = this.options.editorEngine.exportPageSnapshot(instruction.pageId)
      .annotations.find((annotation) =>
        editorAnnotationSceneId(annotation) === instruction.sceneObjectId);
    if (target === undefined || target.type !== "TEXT") return undefined;
    const updated: SerializedAnnotation = {
      ...target,
      properties: { ...target.properties, text: instruction.text },
      updatedAt: Date.now(),
    };
    return {
      command: new UpdateAnnotationCommand(
        target,
        updated,
        documentId,
        metadata,
      ),
      annotationId: target.id,
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
    ...(output.spatialDecisionInstruction === undefined
      ? {}
      : { spatialDecisionInstruction: output.spatialDecisionInstruction }),
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
  if (step.operation.kind !== "EXISTING_EDITOR_OPERATION") return undefined;
  const operationData = step.operation.data;
  if (typeof operationData !== "object" || operationData === null || Array.isArray(operationData)) return undefined;
  const data = operationData as Record<string, unknown>;
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
