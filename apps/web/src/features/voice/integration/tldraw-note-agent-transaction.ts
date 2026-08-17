import type { PreparedTldrawOperation, TldrawEditorAdapter } from "../../editor/adapters/tldraw";
import type { InteractionClock } from "@ggulnote/interaction-core";
import type { PreparedSpatialPlacement } from "../application";
import type {
  EntityRef,
  FrozenWorldContext,
  InMemoryNoteOperationLedger,
  NoteTransactionPort,
  NoteTransactionResult,
  NoteTransactionStep,
} from "../note-agent";
import { editorAnnotationSceneId } from "./editor-voice-context";

interface PreparedOperationData {
  readonly tldrawOperation?: PreparedTldrawOperation;
  readonly target?: EntityRef;
  readonly existingCommand?: {
    readonly capability?: string;
    readonly operation?: string;
  };
  readonly preparedSpatial?: PreparedSpatialPlacement;
}

export interface TldrawNoteAgentTransactionOptions {
  readonly getAdapter: () => TldrawEditorAdapter | undefined;
  readonly operationLedger: InMemoryNoteOperationLedger;
  readonly clock: Pick<InteractionClock, "now">;
  readonly getCurrentSceneRevision: () => number;
  readonly getCurrentPage: () => number;
  readonly goToPage: (page: number) => void;
}

/** Atomic production commit owner for tldraw-backed user-created objects. */
export class TldrawNoteAgentTransaction implements NoteTransactionPort {
  public constructor(private readonly options: TldrawNoteAgentTransactionOptions) {}

  public async commit(input: {
    readonly turnId: string;
    readonly frozenWorld: FrozenWorldContext;
    readonly steps: readonly NoteTransactionStep[];
    readonly signal?: AbortSignal;
  }): Promise<NoteTransactionResult> {
    if (input.steps.length === 0) return failed("EMPTY_PREPARED_BATCH", false);
    if (this.isStale(input)) return { status: "STALE_SCENE", commitAttempted: false };
    const parsed = input.steps.map((step) => ({ step, data: readData(step) }));
    if (parsed.some((entry) => entry.data === undefined)) {
      return failed("INVALID_COMPILED_TOOL_OUTPUT", false);
    }
    const entries = parsed as readonly {
      readonly step: NoteTransactionStep;
      readonly data: PreparedOperationData;
    }[];
    const controls = entries.filter((entry) => entry.data.tldrawOperation === undefined);
    if (controls.length > 0) {
      if (entries.length !== 1) return notAllowed("MIXED_CONTROL_BATCH_UNSUPPORTED");
      return this.commitControl(entries[0] as typeof entries[number], input);
    }
    const adapter = this.options.getAdapter();
    if (adapter === undefined) return notAllowed("TLDRAW_RUNTIME_UNAVAILABLE");
    if (this.isStale(input)) return { status: "STALE_SCENE", commitAttempted: false };
    if (entries.some((entry) => !validPreparedSpatial(entry.data.preparedSpatial, input.frozenWorld))) {
      return { status: "STALE_SCENE", commitAttempted: false };
    }
    const operations = entries.map((entry) => entry.data.tldrawOperation)
      .filter((operation): operation is PreparedTldrawOperation => operation !== undefined);
    const visualCallCount = entries.some((entry) =>
      entry.data.preparedSpatial?.diagnostics.multimodalCallCount === 1) ? 1 as const : 0 as const;
    const visualMs = Math.max(0, ...entries.map((entry) =>
      entry.data.preparedSpatial?.diagnostics.multimodalMs ?? 0));
    const commitStartedAt = Number(this.options.clock.now());
    try {
      const committed = adapter.applyPreparedOperations({
        turnId: input.turnId,
        operations,
      });
      const committedAt = Number(this.options.clock.now());
      const operationId = `note:${input.turnId}:${committed.sceneRevision}`;
      let createdIndex = 0;
      for (const entry of entries) {
        const operation = entry.data.tldrawOperation;
        const createdId = operation?.kind === "CREATE_TEXT" || operation?.kind === "CREATE_ANNOTATION"
          ? committed.createdObjectIds[createdIndex++]
          : undefined;
        const outputRef = createdId === undefined
          ? entry.data.target
          : {
              kind: "OBJECT" as const,
              objectId: editorAnnotationSceneId({
                id: createdId,
                pageId: input.frozenWorld.pageId,
                type: operation?.kind === "CREATE_ANNOTATION"
                  && operation.annotationType === "highlight"
                  ? "HIGHLIGHT"
                  : operation?.kind === "CREATE_ANNOTATION" ? "UNDERLINE" : "TEXT",
              }),
            };
        this.options.operationLedger.record({
          operationId,
          sourceTurnId: input.turnId,
          pageId: input.frozenWorld.pageId,
          toolId: entry.step.toolId,
          operation: operation?.kind ?? "UNKNOWN",
          ...(entry.data.target === undefined ? {} : { inputRefs: [entry.data.target] }),
          ...(outputRef === undefined ? {} : { outputRefs: [outputRef] }),
          createdAt: committedAt,
          undoGroupId: operationId,
        });
      }
      return {
        status: "SUCCESS",
        receipt: {
          kind: "COMMITTED",
          planId: `note:${input.frozenWorld.sceneRevision}:${input.turnId}`,
          operationId,
          ...(committed.createdObjectIds.at(-1) === undefined
            ? {}
            : { annotationId: committed.createdObjectIds.at(-1) }),
          guardMs: Math.max(0, commitStartedAt - commitStartedAt),
          commitMs: Math.max(0, committedAt - commitStartedAt),
          visualMs,
          visualCallCount,
        },
        commitAttempted: true,
      };
    } catch {
      return failed("COMMIT_FAILED", true);
    }
  }

  private commitControl(
    entry: { readonly step: NoteTransactionStep; readonly data: PreparedOperationData },
    input: { readonly turnId: string; readonly frozenWorld: FrozenWorldContext; readonly signal?: AbortSignal },
  ): NoteTransactionResult {
    if (this.isStale(input)) return { status: "STALE_SCENE", commitAttempted: false };
    const command = entry.data.existingCommand;
    if (command?.capability === "history" && command.operation === "undo") {
      const adapter = this.options.getAdapter();
      if (adapter === undefined) return notAllowed("TLDRAW_RUNTIME_UNAVAILABLE");
      return adapter.undo()
        ? {
            status: "SUCCESS",
            receipt: {
              kind: "UNDONE",
              operationId: `note:undo:${input.turnId}`,
              guardMs: 0,
              commitMs: 0,
              visualMs: 0,
              visualCallCount: 0,
            },
            commitAttempted: true,
          }
        : notAllowed("UNDO_NOT_AVAILABLE");
    }
    if (command?.capability === "navigation") {
      const direction = command.operation === "next_page"
        ? "next_page"
        : command.operation === "previous_page" ? "previous_page" : undefined;
      if (direction === undefined) return failed("UNSUPPORTED_CONTROL", false);
      this.options.goToPage(this.options.getCurrentPage() + (direction === "next_page" ? 1 : -1));
      return {
        status: "SUCCESS",
        receipt: {
          kind: "NAVIGATED",
          direction,
          guardMs: 0,
          commitMs: 0,
          visualMs: 0,
          visualCallCount: 0,
        },
        commitAttempted: true,
      };
    }
    return failed("UNSUPPORTED_CONTROL", false);
  }

  private isStale(input: {
    readonly frozenWorld: FrozenWorldContext;
    readonly signal?: AbortSignal;
  }): boolean {
    return input.signal?.aborted === true
      || this.options.getCurrentSceneRevision() !== input.frozenWorld.sceneRevision;
  }
}

function validPreparedSpatial(
  prepared: PreparedSpatialPlacement | undefined,
  frozenWorld: FrozenWorldContext,
): boolean {
  if (prepared === undefined) return true;
  return prepared.placement.pageId === frozenWorld.pageId
    && prepared.placement.sceneRevision === frozenWorld.sceneRevision
    && prepared.diagnostics.previewAttemptCount >= 1
    && prepared.diagnostics.validationResult === "VALIDATED";
}

function readData(step: NoteTransactionStep): PreparedOperationData | undefined {
  if (step.operation.kind !== "EXISTING_EDITOR_OPERATION") return undefined;
  const data = step.operation.data;
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? data as PreparedOperationData
    : undefined;
}

function notAllowed(reasonCode: string): NoteTransactionResult {
  return { status: "NOT_ALLOWED", reasonCode, commitAttempted: false };
}

function failed(reasonCode: string, commitAttempted: boolean): NoteTransactionResult {
  return { status: "FAILED", reasonCode, commitAttempted };
}
