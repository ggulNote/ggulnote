import {
  EditorEngine,
  type EditorPersistenceEvent,
} from "@ggulnote/editor-core";
import { toSessionTimeMs } from "@ggulnote/interaction-core";
import { describe, expect, it } from "vitest";
import type {
  CompletedVoiceTurn,
  DirectCommandContext,
  DirectEditorCommand,
  ExecutableCommandRelation,
  ReadyForDirectCommandExecution,
  ResolvedTarget,
} from "../domain";
import {
  type DirectCommandNavigationPort,
  createDocumentSessionDirectCommandNavigationPort,
  EditorDirectCommandExecutor,
} from "./editor-direct-command-executor";
import { editorAnnotationSceneId } from "./editor-voice-context";
import {
  documentSessionReducer,
  getInitialDocumentSessionState,
} from "../../document/model/document-state";

const PAGE_ID = "doc-1-page-1";
const PAGE_SIZE = { width: 1_000, height: 1_000 };

const TURN: CompletedVoiceTurn = {
  id: "turn-phase-d",
  providerId: "fake-speech",
  providerSessionId: "speech-phase-d",
  language: "ko-KR",
  requestedAt: 1,
  startedAt: 2,
  completedAt: 3,
  state: "completed",
  rawTranscript: "여기 밑줄",
  finalSegments: [{ id: "segment-1", index: 0, text: "여기 밑줄" }],
  frozenContext: {
    pageId: PAGE_ID,
    sceneMode: "pdf",
    sceneRevision: 7,
    focusObjectId: "pdf:line:1",
    focusBounds: { x: 100, y: 200, width: 300, height: 20 },
    focusSource: "selection",
    focusStale: false,
    capturedAt: 2,
  },
  focusSnapshot: {
    source: "selection",
    capturedAt: 2,
    pageId: PAGE_ID,
    sceneRevision: 7,
    objectId: "pdf:line:1",
    bounds: { x: 100, y: 200, width: 300, height: 20 },
    stale: false,
  },
  scene: {
    sceneRevisionAtSpeechStart: 7,
    pageIdAtSpeechStart: PAGE_ID,
    currentSceneRevisionAtCompletion: 7,
    sceneChangedDuringTurn: false,
    pageChangedDuringTurn: false,
  },
  metrics: {
    interimUpdateCount: 0,
    finalSegmentCount: 1,
    providerRestartCount: 0,
  },
};

const CONTEXT: DirectCommandContext = {
  turn: TURN,
  frozenContext: TURN.frozenContext,
  pageTargetCatalog: {
    pageId: PAGE_ID,
    sceneRevision: 7,
    candidates: [
      {
        candidateId: "candidate-pdf",
        source: "pdf",
        type: "line",
        pageId: PAGE_ID,
        sceneObjectId: "pdf:line:1",
        text: "PDF source text",
        bounds: { x: 100, y: 200, width: 300, height: 20 },
        editable: false,
        annotatable: true,
      },
      {
        candidateId: "candidate-text",
        source: "ggulnote",
        type: "text",
        pageId: PAGE_ID,
        sceneObjectId: "canvas:doc-1-page-1:text:ann-1",
        text: "old",
        bounds: { x: 100, y: 300, width: 200, height: 80 },
        editable: true,
        annotatable: true,
      },
    ],
  },
  recentOperations: [],
  plannerContext: {
    turn: {
      turnId: TURN.id,
      language: TURN.language,
      rawFinalTranscript: TURN.rawTranscript,
    },
    frozenContext: {
      pageId: PAGE_ID,
      sceneMode: "pdf",
      sceneRevision: 7,
      focusSource: "selection",
      focusStale: false,
      capturedAt: 2,
      focus: null,
    },
    allowedCommands: [
      "annotation.underline",
      "annotation.highlight",
      "navigation.next_page",
      "navigation.previous_page",
      "history.undo",
      "text.replace_content",
    ],
  },
};

const PDF_TEXT: ResolvedTarget = {
  kind: "text_span",
  candidateId: "candidate-pdf",
  pageId: PAGE_ID,
  sceneRevision: 7,
  source: "pdf",
  type: "line",
  objectId: "pdf:line:1",
  text: "PDF source text",
  bounds: [{ x: 100, y: 200, width: 300, height: 20 }],
  editable: false,
  annotatable: true,
};

function ready(
  command: DirectEditorCommand,
  target?: ResolvedTarget,
  relation: ExecutableCommandRelation = "NEW",
): ReadyForDirectCommandExecution {
  return {
    status: "READY_FOR_EXECUTION",
    turnId: TURN.id,
    context: CONTEXT,
    plan: {
      status: "EXECUTABLE",
      planId: "plan-phase-d",
      turnId: TURN.id,
      sceneRevision: 7,
      normalizedIntent: "테스트 명령",
      relation,
      command,
    },
    ...(target === undefined ? {} : { target }),
    disambiguationUsed: false,
    timestamps: { routeReceivedAt: 1, validatedAt: 2 },
  };
}

function createEngine(): EditorEngine {
  let id = 0;
  const editorEngine = new EditorEngine({
    idGenerator: () => "ann-" + String(++id),
  });
  editorEngine.setDocument("doc-1");
  editorEngine.setActivePage(PAGE_ID, PAGE_SIZE);
  return editorEngine;
}

class FakeNavigationPort implements DirectCommandNavigationPort {
  public readonly requests: number[] = [];

  public constructor(
    public currentPage = 1,
    private readonly totalPages = 3,
  ) {}

  public getCurrentPage(): number {
    return this.currentPage;
  }

  public goToPage(page: number): void {
    this.requests.push(page);
    this.currentPage = Math.min(
      this.totalPages,
      Math.max(1, Math.trunc(page)),
    );
  }
}

function createExecutor(
  editorEngine: EditorEngine,
  navigation: DirectCommandNavigationPort = new FakeNavigationPort(),
  revision = 7,
): EditorDirectCommandExecutor {
  return new EditorDirectCommandExecutor({
    editorEngine,
    navigation,
    getCurrentSceneRevision: () => revision,
    clock: { now: () => toSessionTimeMs(100) },
  });
}

function collectOperations(editorEngine: EditorEngine): {
  events: EditorPersistenceEvent[];
  dispose(): void;
} {
  const events: EditorPersistenceEvent[] = [];
  const dispose = editorEngine.subscribeToOperations((event) => {
    events.push(event);
  });
  return { events, dispose };
}

describe("EditorDirectCommandExecutor", () => {
  it("D1 creates one underline operation over PDF geometry and undo removes it", async () => {
    const editorEngine = createEngine();
    const executor = createExecutor(editorEngine);
    const log = collectOperations(editorEngine);
    const pdfSourceBefore = JSON.stringify(PDF_TEXT);

    const result = await executor.execute(ready({
      capability: "annotation",
      operation: "underline",
      target: { kind: "relative", relation: "focused" },
      payload: {},
    }, PDF_TEXT));

    expect(result).toMatchObject({
      status: "COMMITTED",
      turnId: TURN.id,
      planId: "plan-phase-d",
    });
    expect(editorEngine.exportPageSnapshot(PAGE_ID).annotations).toMatchObject([
      {
        type: "UNDERLINE",
        bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
      },
    ]);
    expect(log.events).toHaveLength(1);
    expect(log.events[0]).toMatchObject({
      historyAction: "execute",
      operation: { type: "CREATE_ANNOTATION" },
    });
    if (result.status === "COMMITTED") {
      expect(result.operationId).toBe(log.events[0]?.operation.operationId);
    }
    expect(JSON.stringify(PDF_TEXT)).toBe(pdfSourceBefore);

    editorEngine.undo();
    expect(editorEngine.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);
    expect(log.events.at(-1)?.historyAction).toBe("undo");
    log.dispose();
  });

  it("D2 creates a colored highlight in the editable annotation layer and undoes it", async () => {
    const editorEngine = createEngine();
    const executor = createExecutor(editorEngine);

    const result = await executor.execute(ready({
      capability: "annotation",
      operation: "highlight",
      target: { kind: "relative", relation: "focused" },
      payload: { color: "#facc15" },
    }, PDF_TEXT));

    expect(result.status).toBe("COMMITTED");
    expect(editorEngine.exportPageSnapshot(PAGE_ID).annotations[0]).toMatchObject({
      type: "HIGHLIGHT",
      properties: { color: "#facc15" },
    });
    editorEngine.undo();
    expect(editorEngine.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);
  });

  it("D3 delegates absent highlight color to the existing EditorEngine default", async () => {
    const baselineEngine = createEngine();
    baselineEngine.createAnnotation({
      type: "HIGHLIGHT",
      pageId: PAGE_ID,
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
    });
    const defaultColor = baselineEngine.exportPageSnapshot(PAGE_ID)
      .annotations[0]?.properties.color;

    const editorEngine = createEngine();
    const executor = createExecutor(editorEngine);
    await executor.execute(ready({
      capability: "annotation",
      operation: "highlight",
      target: { kind: "relative", relation: "focused" },
      payload: {},
    }, PDF_TEXT));

    expect(editorEngine.exportPageSnapshot(PAGE_ID)
      .annotations[0]?.properties.color).toBe(defaultColor);
  });

  it("D4 replaces editable text through UPDATE_ANNOTATION history and undo restores it", async () => {
    const editorEngine = createEngine();
    const annotationId = editorEngine.createAnnotation({
      type: "TEXT",
      pageId: PAGE_ID,
      bounds: { x: 0.1, y: 0.3, width: 0.2, height: 0.08 },
      text: "old",
    });
    const annotation = editorEngine.exportPageSnapshot(PAGE_ID).annotations[0];
    if (annotation === undefined) throw new Error("Expected text annotation.");
    const target: ResolvedTarget = {
      kind: "text_span",
      candidateId: "candidate-text",
      pageId: PAGE_ID,
      sceneRevision: 7,
      source: "ggulnote",
      type: "text",
      objectId: editorAnnotationSceneId(annotation),
      text: "old",
      bounds: [{ x: 100, y: 300, width: 200, height: 80 }],
      editable: true,
      annotatable: true,
    };
    const log = collectOperations(editorEngine);
    const executor = createExecutor(editorEngine);

    const result = await executor.execute(ready({
      capability: "text",
      operation: "replace_content",
      target: { kind: "relative", relation: "focused" },
      payload: { text: "new" },
    }, target));

    expect(result.status).toBe("COMMITTED");
    expect(editorEngine.exportPageSnapshot(PAGE_ID).annotations[0]).toMatchObject({
      id: annotationId,
      properties: { text: "new" },
    });
    expect(log.events).toHaveLength(1);
    expect(log.events[0]).toMatchObject({
      historyAction: "execute",
      operation: { type: "UPDATE_ANNOTATION", annotationId },
    });

    editorEngine.undo();
    expect(editorEngine.exportPageSnapshot(PAGE_ID)
      .annotations[0]?.properties.text).toBe("old");
    log.dispose();
  });

  it("D5 rejects a malformed PDF replace fixture before mutation", async () => {
    const editorEngine = createEngine();
    const log = collectOperations(editorEngine);
    const executor = createExecutor(editorEngine);

    const result = await executor.execute(ready({
      capability: "text",
      operation: "replace_content",
      target: { kind: "relative", relation: "focused" },
      payload: { text: "mutated" },
    }, PDF_TEXT));

    expect(result).toMatchObject({
      status: "ERROR",
      turnId: TURN.id,
      errorCode: "TARGET_NOT_EDITABLE",
    });
    expect(editorEngine.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);
    expect(log.events).toHaveLength(0);
    log.dispose();
  });

  it("D6/D7 delegates next/previous and page boundaries to navigation semantics", async () => {
    const editorEngine = createEngine();
    let documentState = documentSessionReducer(
      getInitialDocumentSessionState(),
      {
        type: "BLANK_CREATED",
        document: {
          id: "doc-1",
          kind: "blank",
          name: "blank",
          pageCount: 3,
        },
        pageCount: 3,
      },
    );
    documentState = documentSessionReducer(documentState, {
      type: "GO_TO_PAGE",
      page: 2,
    });
    const requests: number[] = [];
    const navigation = createDocumentSessionDirectCommandNavigationPort({
      getCurrentPage: () => documentState.currentPage,
      goToPage: (page) => {
        requests.push(page);
        documentState = documentSessionReducer(documentState, {
          type: "GO_TO_PAGE",
          page,
        });
      },
    });
    const executor = createExecutor(editorEngine, navigation);

    await executor.execute(ready({
      capability: "navigation",
      operation: "next_page",
      target: { kind: "CURRENT_PAGE" },
      payload: {},
    }));
    expect(documentState.currentPage).toBe(3);
    await executor.execute(ready({
      capability: "navigation",
      operation: "next_page",
      target: { kind: "CURRENT_PAGE" },
      payload: {},
    }));
    expect(documentState.currentPage).toBe(3);
    await executor.execute(ready({
      capability: "navigation",
      operation: "previous_page",
      target: { kind: "CURRENT_PAGE" },
      payload: {},
    }));
    expect(documentState.currentPage).toBe(2);
    expect(requests).toEqual([3, 4, 2]);
    expect(editorEngine.canUndo()).toBe(false);
  });

  it("D8 connects voice undo to EditorEngine history without replanning", async () => {
    const editorEngine = createEngine();
    editorEngine.createAnnotation({
      type: "UNDERLINE",
      pageId: PAGE_ID,
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
    });
    const executor = createExecutor(editorEngine);

    const result = await executor.execute(ready({
      capability: "history",
      operation: "undo",
      target: { kind: "LAST_OPERATION" },
      payload: {},
    }));

    expect(result).toMatchObject({
      status: "UNDONE",
      turnId: TURN.id,
    });
    expect(editorEngine.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);
  });

  it("D9 normalizes empty history to UNDO_NOT_AVAILABLE", async () => {
    const editorEngine = createEngine();
    const executor = createExecutor(editorEngine);

    await expect(executor.execute(ready({
      capability: "history",
      operation: "undo",
      target: { kind: "LAST_OPERATION" },
      payload: {},
    }))).resolves.toMatchObject({
      status: "ERROR",
      turnId: TURN.id,
      errorCode: "UNDO_NOT_AVAILABLE",
    });
  });

  it("D10 rejects an execution-time stale scene without mutation", async () => {
    const editorEngine = createEngine();
    const log = collectOperations(editorEngine);
    const executor = createExecutor(editorEngine, new FakeNavigationPort(), 8);

    await expect(executor.execute(ready({
      capability: "annotation",
      operation: "underline",
      target: { kind: "relative", relation: "focused" },
      payload: {},
    }, PDF_TEXT))).resolves.toMatchObject({
      status: "ERROR",
      turnId: TURN.id,
      errorCode: "STALE_SCENE",
    });
    expect(editorEngine.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);
    expect(log.events).toHaveLength(0);
    log.dispose();
  });

  it("D12 does not execute REVISE_LAST as NEW before Phase E", async () => {
    const editorEngine = createEngine();
    const log = collectOperations(editorEngine);
    const executor = createExecutor(editorEngine);

    await expect(executor.execute(ready({
      capability: "annotation",
      operation: "highlight",
      target: { kind: "relative", relation: "last_target" },
      payload: { color: "#3b82f6" },
    }, PDF_TEXT, "REVISE_LAST"))).resolves.toMatchObject({
      status: "ERROR",
      turnId: TURN.id,
      errorCode: "REVISE_NOT_AVAILABLE",
    });
    expect(editorEngine.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);
    expect(log.events).toHaveLength(0);
    log.dispose();
  });

  it("normalizes runtime adapter failures without leaking exceptions", async () => {
    const editorEngine = createEngine();
    const executor = createExecutor(editorEngine, {
      getCurrentPage: () => 1,
      goToPage: () => {
        throw new Error("navigation failed");
      },
    });

    await expect(executor.execute(ready({
      capability: "navigation",
      operation: "next_page",
      target: { kind: "CURRENT_PAGE" },
      payload: {},
    }))).resolves.toMatchObject({
      status: "ERROR",
      turnId: TURN.id,
      errorCode: "COMMIT_FAILED",
    });
  });
});
