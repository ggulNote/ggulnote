import { EditorEngine, type EditorPersistenceEvent } from "@ggulnote/editor-core";
import { toSessionTimeMs } from "@ggulnote/interaction-core";
import { describe, expect, it, vi } from "vitest";
import {
  DirectCommandHistoryContext,
  type PreparedSpatialPlacement,
  type SpatialCommandExecutionPort,
} from "../application";
import type { CompletedVoiceTurn, DirectCommandContext } from "../domain";
import type { FrozenWorldContext } from "../note-agent";
import { EditorDirectCommandExecutor } from "./editor-direct-command-executor";
import { EditorNoteAgentTransaction } from "./editor-note-agent-transaction";

const PAGE_ID = "doc-1-page-1";
const TURN: CompletedVoiceTurn = {
  id: "turn-note-production", providerId: "fake", providerSessionId: "session",
  language: "ko-KR", requestedAt: 1, startedAt: 2, completedAt: 3,
  state: "completed", rawTranscript: "Moreover부터 instance까지 밑줄",
  finalSegments: [],
  frozenContext: {
    pageId: PAGE_ID, sceneMode: "pdf", sceneRevision: 7,
    focusSource: "none", focusStale: false, capturedAt: 2,
  },
  focusSnapshot: {
    source: "none", capturedAt: 2, pageId: PAGE_ID, sceneRevision: 7, stale: false,
  },
  scene: {
    sceneRevisionAtSpeechStart: 7, pageIdAtSpeechStart: PAGE_ID,
    currentSceneRevisionAtCompletion: 7,
    sceneChangedDuringTurn: false, pageChangedDuringTurn: false,
  },
  metrics: { interimUpdateCount: 0, finalSegmentCount: 1, providerRestartCount: 0 },
};

describe("EditorNoteAgentTransaction", () => {
  it("compiles a NoteTool output through the existing editor runtime as one undo unit", async () => {
    const editor = createEditor();
    const events: EditorPersistenceEvent[] = [];
    const unsubscribe = editor.subscribeToOperations((event) => events.push(event));
    const transaction = createTransaction(editor, 7);
    const result = await transaction.commit({
      turnId: TURN.id,
      frozenWorld: frozenWorld(),
      steps: [{
        stepId: "s1",
        toolId: "annotation.apply",
        operation: { kind: "EXISTING_EDITOR_OPERATION", data: {
          existingCommand: { capability: "annotation", operation: "underline", payload: {} },
          target: {
            kind: "TEXT_RANGE", rangeId: "candidate-pdf",
            objectIds: ["pdf-line-1"],
            rects: [{ x: 100, y: 200, width: 300, height: 20 }],
          },
        } },
      }],
    });
    expect(result).toMatchObject({ status: "SUCCESS", commitAttempted: true });
    expect(editor.exportPageSnapshot(PAGE_ID).annotations).toMatchObject([{
      type: "UNDERLINE",
      createdByTurnId: TURN.id,
      targetObjectIds: ["pdf-line-1"],
    }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      historyAction: "execute",
      operation: { sourceTurnId: TURN.id, toolId: "annotation.underline" },
    });
    expect(editor.getUndoStackSize()).toBe(1);
    editor.undo();
    expect(editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);
    unsubscribe();
  });

  it("rejects stale scene and invalid prepared steps before editor mutation", async () => {
    const editor = createEditor();
    const events: EditorPersistenceEvent[] = [];
    editor.subscribeToOperations((event) => events.push(event));
    const stale = createTransaction(editor, 8);
    await expect(stale.commit({
      turnId: TURN.id,
      frozenWorld: frozenWorld(),
      steps: [{
        stepId: "s1", toolId: "annotation.apply",
        operation: { kind: "EXISTING_EDITOR_OPERATION", data: {} },
      }],
    })).resolves.toEqual({ status: "STALE_SCENE", commitAttempted: false });
    const current = createTransaction(editor, 7);
    await expect(current.commit({
      turnId: TURN.id,
      frozenWorld: frozenWorld(),
      steps: [{
        stepId: "s1", toolId: "annotation.apply",
        operation: { kind: "EXISTING_EDITOR_OPERATION", data: {} },
      }],
    })).resolves.toMatchObject({
      status: "FAILED",
      reasonCode: "INVALID_COMPILED_TOOL_OUTPUT",
      commitAttempted: false,
    });
    expect(events).toHaveLength(0);
    expect(editor.getUndoStackSize()).toBe(0);
  });

  it("commits two prepared annotations as one operation event and one undo", async () => {
    const editor = createEditor();
    const events: EditorPersistenceEvent[] = [];
    editor.subscribeToOperations((event) => events.push(event));
    const transaction = createTransaction(editor, 7);
    const operation = (step: string, type: "underline" | "highlight") => ({
      stepId: step,
      toolId: "annotation.apply" as const,
      operation: {
        kind: "EXISTING_EDITOR_OPERATION" as const,
        data: {
          existingCommand: { capability: "annotation", operation: type, payload: {} },
          target: {
            kind: "TEXT_RANGE" as const,
            rangeId: "candidate-pdf",
            objectIds: ["pdf-line-1"],
            rects: [{ x: 100, y: 200, width: 300, height: 20 }],
          },
        },
      },
    });
    await expect(transaction.commit({
      turnId: TURN.id,
      frozenWorld: frozenWorld(),
      steps: [operation("s1", "underline"), operation("s2", "highlight")],
    })).resolves.toMatchObject({
      status: "SUCCESS",
      commitAttempted: true,
      receipt: { kind: "COMMITTED" },
    });
    expect(editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(2);
    expect(events).toHaveLength(1);
    expect(events[0]?.operation.type).toBe("BATCH");
    expect(editor.getUndoStackSize()).toBe(1);
    editor.undo();
    expect(editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);
  });

  it("commits a preview-validated spatial preparation without rerunning placement", async () => {
    const editor = createEditor();
    const execute = vi.fn<SpatialCommandExecutionPort["execute"]>();
    const executePrepared = vi.fn(async (ready) => ({
      result: {
        status: "COMMITTED" as const,
        turnId: ready.turnId,
        planId: ready.plan.planId,
        operationId: "operation-spatial",
        annotationId: "annotation-spatial",
      },
      diagnostics: {
        multimodalCallCount: 1,
        previewValidationMs: 2,
        commitMs: 3,
        multimodalMs: 4,
        runtimeExecuted: true,
      } as never,
    }));
    const transaction = createTransaction(editor, 7, { execute, executePrepared });
    const preparedSpatial = {} as PreparedSpatialPlacement;

    const result = await transaction.commit({
      turnId: TURN.id,
      frozenWorld: frozenWorld(),
      steps: [{
        stepId: "s1",
        toolId: "text.create",
        operation: {
          kind: "EXISTING_EDITOR_OPERATION",
          data: {
            existingCommand: {
              capability: "text",
              operation: "create",
              payload: { text: "메모" },
            },
            placement: { relation: "FREE_SPACE" },
            destination: { kind: "PAGE_REGION", region: "TOP_LEFT" },
            preparedSpatial,
          },
        },
      }],
    });

    expect(result).toMatchObject({
      status: "SUCCESS",
      receipt: { visualCallCount: 1, visualMs: 4, commitMs: 3 },
    });
    expect(executePrepared).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });
});

function createEditor(): EditorEngine {
  let id = 0;
  const editor = new EditorEngine({ idGenerator: () => `annotation-${id += 1}` });
  editor.setDocument("doc-1");
  editor.setActivePage(PAGE_ID, { width: 1_000, height: 1_000 });
  return editor;
}

function createTransaction(
  editor: EditorEngine,
  revision: number,
  spatial?: SpatialCommandExecutionPort,
) {
  const executor = new EditorDirectCommandExecutor({
    editorEngine: editor,
    navigation: { getCurrentPage: () => 1, goToPage: () => undefined },
    getCurrentSceneRevision: () => revision,
    clock: { now: () => toSessionTimeMs(100) },
  });
  return new EditorNoteAgentTransaction({
    editorEngine: editor,
    executor,
    ...(spatial === undefined ? {} : { spatial }),
    history: new DirectCommandHistoryContext(),
    clock: { now: () => toSessionTimeMs(100) },
    getCurrentSceneRevision: () => revision,
  });
}

function frozenWorld(): FrozenWorldContext {
  const directContext: DirectCommandContext = {
    turn: TURN,
    frozenContext: TURN.frozenContext,
    pageTargetCatalog: {
      documentId: "doc-1", pageId: PAGE_ID, sceneRevision: 7,
      candidates: [{
        candidateId: "candidate-pdf", source: "pdf", type: "line",
        pageId: PAGE_ID, sceneObjectId: "pdf-line-1", text: "Moreover instance",
        bounds: { x: 100, y: 200, width: 300, height: 20 },
        editable: false, annotatable: true,
      }],
    },
    recentOperations: [],
    plannerContext: {
      turn: {
        turnId: TURN.id, language: TURN.language,
        rawFinalTranscript: TURN.rawTranscript,
      },
      frozenContext: {
        pageId: PAGE_ID, sceneMode: "pdf", sceneRevision: 7,
        focusSource: "none", focusStale: false, capturedAt: 2, focus: null,
      },
      allowedCommands: [],
    },
  };
  return {
    documentId: "doc-1", pageId: PAGE_ID, sceneRevision: 7,
    frozenVoiceContext: TURN.frozenContext,
    catalog: directContext.pageTargetCatalog,
    recentOperations: [],
    directContext,
  };
}
