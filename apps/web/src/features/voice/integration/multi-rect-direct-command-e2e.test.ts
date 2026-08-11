import { EditorEngine, type EditorPersistenceEvent } from "@ggulnote/editor-core";
import { InteractionClock } from "@ggulnote/interaction-core";
import { describe, expect, it, vi } from "vitest";
import { DirectCommandHistoryContext, DirectCommandRoute } from "../application";
import type {
  CompletedVoiceTurn,
  DirectCommandContext,
  DirectCommandPlanningResult,
  ReadyForDirectCommandExecution,
} from "../domain";
import { EditorDirectCommandExecutor } from "./editor-direct-command-executor";

const PAGE_ID = "doc-1-page-1";
const TURN: CompletedVoiceTurn = {
  id: "turn-multi-rect",
  providerId: "fake-speech",
  providerSessionId: "speech-multi-rect",
  language: "ko-KR",
  requestedAt: 1,
  startedAt: 2,
  completedAt: 3,
  state: "completed",
  rawTranscript: "모얼오벌부터 인스탠스까지 밑줄",
  finalSegments: [{ id: "segment-1", index: 0, text: "모얼오벌부터 인스탠스까지 밑줄" }],
  frozenContext: {
    pageId: PAGE_ID,
    sceneMode: "pdf",
    sceneRevision: 7,
    focusSource: "none",
    focusStale: false,
    capturedAt: 2,
  },
  focusSnapshot: {
    source: "none",
    capturedAt: 2,
    pageId: PAGE_ID,
    sceneRevision: 7,
    stale: false,
  },
  scene: {
    sceneRevisionAtSpeechStart: 7,
    pageIdAtSpeechStart: PAGE_ID,
    currentSceneRevisionAtCompletion: 7,
    sceneChangedDuringTurn: false,
    pageChangedDuringTurn: false,
  },
  metrics: { interimUpdateCount: 0, finalSegmentCount: 1, providerRestartCount: 0 },
};

const CONTEXT: DirectCommandContext = {
  turn: TURN,
  frozenContext: TURN.frozenContext,
  pageTargetCatalog: {
    pageId: PAGE_ID,
    sceneRevision: 7,
    candidates: [{
      candidateId: "range-candidate",
      source: "pdf",
      type: "word",
      pageId: PAGE_ID,
      sourceObjectId: "word-moreover",
      sceneObjectId: "pdf:word:moreover",
      text: "Moreover through instance",
      bounds: { x: 60, y: 80, width: 360, height: 78 },
      editable: false,
      annotatable: true,
    }],
  },
  recentOperations: [],
  plannerContext: {
    turn: { turnId: TURN.id, language: TURN.language, rawFinalTranscript: TURN.rawTranscript },
    frozenContext: {
      pageId: PAGE_ID,
      sceneMode: "pdf",
      sceneRevision: 7,
      focusSource: "none",
      focusStale: false,
      capturedAt: 2,
      focus: null,
    },
    allowedCommands: ["annotation.underline"],
  },
};

const READY: ReadyForDirectCommandExecution = {
  status: "READY_FOR_EXECUTION",
  turnId: TURN.id,
  context: CONTEXT,
  plan: {
    status: "EXECUTABLE",
    planId: "plan-multi-rect",
    turnId: TURN.id,
    sceneRevision: 7,
    normalizedIntent: "Moreover부터 instance까지 밑줄",
    relation: "NEW",
    command: {
      capability: "annotation",
      operation: "underline",
      target: { kind: "text_span", startAnchor: "모얼오벌", endAnchor: "인스탠스" },
      payload: {},
    },
  },
  target: {
    kind: "text_span",
    candidateId: "range-candidate",
    pageId: PAGE_ID,
    sceneRevision: 7,
    source: "pdf",
    type: "word",
    objectId: "pdf:word:moreover",
    text: "Moreover modern neural networks For instance",
    bounds: [
      { x: 60, y: 80, width: 360, height: 18 },
      { x: 60, y: 110, width: 420, height: 18 },
      { x: 60, y: 140, width: 180, height: 18 },
    ],
    editable: false,
    annotatable: true,
  },
  disambiguationUsed: false,
  timestamps: { routeReceivedAt: 1, validatedAt: 2 },
  diagnostics: {
    plannerStatus: "EXECUTABLE",
    targetQueryKind: "text_span",
    resolutionStatus: "RESOLVED",
    disambiguationUsed: false,
    guardStatus: "PASSED",
    targetRecoveryUsed: true,
    targetRecoveryKind: "text_span",
    recoveryCandidateCount: 2,
    recoveryResult: "SELECTED",
    initialResolutionStatus: "NOT_FOUND",
    finalResolutionStatus: "RESOLVED",
  },
};

function createHarness(currentRevision = 7) {
  const clock = new InteractionClock(() => 100);
  const editor = new EditorEngine({ idGenerator: () => "multi-rect-annotation" });
  editor.setDocument("doc-1");
  editor.setActivePage(PAGE_ID, { width: 600, height: 800 });
  const planning = { plan: vi.fn(async (): Promise<DirectCommandPlanningResult> => READY) };
  const executor = new EditorDirectCommandExecutor({
    editorEngine: editor,
    navigation: { getCurrentPage: () => 1, goToPage: () => undefined },
    getCurrentSceneRevision: () => currentRevision,
    clock,
  });
  const route = new DirectCommandRoute({
    planning,
    executor,
    history: new DirectCommandHistoryContext({ now: () => 100 }),
    clock,
  });
  return { editor, planning, route };
}

describe("multi-rect grounded direct command E2E", () => {
  it("commits recovered Rect[] as one annotation, operation, and Undo unit", async () => {
    const harness = createHarness();
    const events: EditorPersistenceEvent[] = [];
    harness.editor.subscribeToOperations((event) => events.push(event));

    const [first, duplicate] = await Promise.all([
      harness.route.execute(TURN),
      harness.route.execute(TURN),
    ]);
    const sequential = await harness.route.execute(TURN);

    expect(first).toMatchObject({ status: "COMMITTED", annotationId: "multi-rect-annotation" });
    expect(duplicate).toEqual(first);
    expect(sequential).toEqual(first);
    expect(harness.planning.plan).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.operation.type).toBe("CREATE_ANNOTATION");
    const snapshot = harness.editor.exportPageSnapshot(PAGE_ID);
    expect(snapshot.annotations).toHaveLength(1);
    expect(snapshot.annotations[0]).toMatchObject({
      type: "UNDERLINE",
      rects: [
        { x: 0.1, y: 0.1, width: 0.6, height: 0.0225 },
        { x: 0.1, y: 0.1375, width: 0.7, height: 0.0225 },
        { x: 0.1, y: 0.175, width: 0.3, height: 0.0225 },
      ],
    });
    expect(harness.editor.getUndoStackSize()).toBe(1);

    harness.editor.undo();
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations).toEqual([]);
    harness.editor.redo();
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations[0]?.rects).toHaveLength(3);
  });

  it("rejects a stale recovered target before mutation", async () => {
    const harness = createHarness(8);
    await expect(harness.route.execute(TURN)).resolves.toMatchObject({
      status: "ERROR",
      errorCode: "STALE_SCENE",
    });
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations).toEqual([]);
  });

  it("keeps legacy no-evidence single-rect execution deterministic", async () => {
    const harness = createHarness();
    const legacyReady: ReadyForDirectCommandExecution = {
      ...READY,
      context: { ...CONTEXT, speechGroundingEvidence: undefined },
      target: {
        kind: "text_span",
        candidateId: "range-candidate",
        pageId: PAGE_ID,
        sceneRevision: 7,
        source: "pdf",
        type: "word",
        objectId: "pdf:word:moreover",
        text: "Moreover",
        bounds: [{ x: 60, y: 80, width: 180, height: 18 }],
        editable: false,
        annotatable: true,
      },
    };
    harness.planning.plan.mockResolvedValueOnce(legacyReady);

    await expect(harness.route.execute({ ...TURN, id: "legacy-turn" }))
      .resolves.toMatchObject({ status: "COMMITTED" });
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations[0]).not.toHaveProperty("rects");
  });
});
