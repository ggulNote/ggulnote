import {
  buildSceneSnapshot,
  type PdfSceneObject,
} from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import type { CompletedVoiceTurn, DirectRecentOperation } from "../domain";
import {
  CurrentRevisionSceneSnapshotSource,
  DirectCommandContextBuilder,
} from "./direct-command-context-builder";

const FROZEN_LINE: PdfSceneObject = {
  id: "pdf:doc:0:line:frozen",
  pageId: "page-1",
  source: "pdf",
  kind: "line",
  bounds: { x: 10, y: 20, width: 200, height: 18 },
  zIndex: 0,
  visible: true,
  locked: false,
  objectRevision: 1,
  sourceObjectId: "frozen",
  text: "Frozen focus text",
  readingOrder: 1,
  childWordIds: [],
  paragraphId: null,
};

function createTurn(): CompletedVoiceTurn {
  return {
    id: "turn-1",
    providerId: "fake-speech",
    providerSessionId: "speech-1",
    language: "ko-KR",
    requestedAt: 1,
    startedAt: 2,
    completedAt: 4,
    state: "completed",
    rawTranscript: "  여기 밑줄 쳐줘  ",
    finalSegments: [{ id: "segment-1", index: 0, text: "여기 밑줄 쳐줘" }],
    frozenContext: {
      pageId: "page-1",
      sceneMode: "pdf",
      sceneRevision: 7,
      focusObjectId: FROZEN_LINE.id,
      focusBounds: { ...FROZEN_LINE.bounds },
      focusSource: "selection",
      focusStale: false,
      capturedAt: 2,
    },
    focusSnapshot: {
      source: "selection",
      capturedAt: 2,
      pageId: "page-1",
      sceneRevision: 7,
      objectId: FROZEN_LINE.id,
      bounds: { ...FROZEN_LINE.bounds },
      stale: false,
    },
    scene: {
      sceneRevisionAtSpeechStart: 7,
      pageIdAtSpeechStart: "page-1",
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
}

function createScene(pageId = "page-1", sceneRevision = 7) {
  return buildSceneSnapshot({
    mode: "pdf",
    page: { id: pageId, index: 0, width: 600, height: 800 },
    sceneRevision,
    pdfObjects: pageId === "page-1" ? [FROZEN_LINE] : [],
  });
}

const RECENT_OPERATION: DirectRecentOperation = {
  operationId: "op-1",
  pageId: "page-1",
  operationType: "CREATE_ANNOTATION",
  annotationId: "annotation-1",
  createdAt: 100,
  targetSceneObjectId: FROZEN_LINE.id,
};

describe("DirectCommandContextBuilder", () => {
  it("uses frozen page/revision/focus, preserves raw transcript, and hides internal IDs", () => {
    const builder = new DirectCommandContextBuilder({
      frozenSceneSource: new CurrentRevisionSceneSnapshotSource(() => ({
        scene: createScene(),
      })),
      recentOperationsSource: {
        getRecentOperations: () => [RECENT_OPERATION],
      },
    });

    const result = builder.build(createTurn());

    expect(result.status).toBe("READY");
    if (result.status !== "READY") throw new Error("Expected READY context.");
    expect(result.context.frozenContext).toBe(result.context.turn.frozenContext);
    expect(result.context.plannerContext.turn.rawFinalTranscript)
      .toBe("  여기 밑줄 쳐줘  ");
    expect(result.context.plannerContext.frozenContext).toMatchObject({
      pageId: "page-1",
      sceneRevision: 7,
      focus: { kind: "line", source: "pdf", text: "Frozen focus text" },
    });
    expect(result.context.recentOperations).toEqual([RECENT_OPERATION]);
    expect(result.context.plannerContext.recentOperations).toEqual([
      {
        operationId: "op-1",
        operationType: "CREATE_ANNOTATION",
        targetType: "line",
        createdAt: 100,
      },
    ]);
    const plannerJson = JSON.stringify(result.context.plannerContext);
    expect(plannerJson).not.toContain("candidateId");
    expect(plannerJson).not.toContain("targetSceneObjectId");
    expect(plannerJson).not.toContain(FROZEN_LINE.id);
  });

  it.each([
    { pageId: "page-2", sceneRevision: 7 },
    { pageId: "page-1", sceneRevision: 8 },
  ])("returns STALE_SCENE when the frozen snapshot cannot be reconstructed", ({
    pageId,
    sceneRevision,
  }) => {
    const builder = new DirectCommandContextBuilder({
      frozenSceneSource: new CurrentRevisionSceneSnapshotSource(() => ({
        scene: createScene(pageId, sceneRevision),
      })),
      recentOperationsSource: { getRecentOperations: () => [] },
    });

    expect(builder.build(createTurn())).toEqual({
      status: "ERROR",
      errorCode: "STALE_SCENE",
    });
  });
});
