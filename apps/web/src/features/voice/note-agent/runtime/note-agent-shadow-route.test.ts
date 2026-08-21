import {
  buildSceneSnapshot,
  describeSceneObject,
  type WordSceneObject,
} from "@ggulnote/editor-core";
import { describe, expect, it, vi } from "vitest";
import {
  CurrentRevisionSceneSnapshotSource,
  DirectCommandContextBuilder,
  DirectCommandHistoryContext,
} from "../../application";
import type { CompletedVoiceTurn } from "../../domain";
import { FakeNoteDecisionProvider } from "../decision";
import { createExistingNoteToolRegistry } from "../tools";
import type { UnifiedObjectWorld } from "../world";
import { ExistingWorldResolver } from "../world";
import { NoteAgentShadowRoute } from "./note-agent-shadow-route";

const FOCUS: WordSceneObject = {
  id: "pdf-word-1",
  pageId: "page-1",
  source: "pdf",
  kind: "word",
  bounds: { x: 10, y: 20, width: 100, height: 20 },
  renderBounds: { x: 9, y: 19, width: 102, height: 22 },
  zIndex: 0,
  visible: true,
  locked: true,
  objectRevision: 1,
  sourceObjectId: "word-1",
  text: "hello",
  readingOrder: 1,
  lineId: "line-1",
  charOffsetStart: 0,
  charOffsetEnd: 5,
};

const SCENE = buildSceneSnapshot({
  mode: "pdf",
  page: { id: "page-1", index: 0, width: 600, height: 800 },
  sceneRevision: 7,
  pdfObjects: [FOCUS],
});

function turn(): CompletedVoiceTurn {
  return {
    id: "turn-1",
    providerId: "fake-speech",
    providerSessionId: "speech-1",
    language: "ko-KR",
    requestedAt: 1,
    startedAt: 2,
    completedAt: 4,
    state: "completed",
    rawTranscript: "다음 페이지",
    finalSegments: [{ id: "segment-1", index: 0, text: "다음 페이지" }],
    frozenContext: {
      pageId: "page-1",
      sceneMode: "pdf",
      sceneRevision: 7,
      focusObjectId: FOCUS.id,
      focusBounds: FOCUS.renderBounds,
      focusSource: "selection",
      focusStale: false,
      capturedAt: 2,
    },
    focusSnapshot: {
      source: "selection",
      capturedAt: 2,
      pageId: "page-1",
      sceneRevision: 7,
      objectId: FOCUS.id,
      bounds: FOCUS.renderBounds,
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

function setup(provider = new FakeNoteDecisionProvider({
  status: "CALL",
  call: { stepId: "s1", toolId: "navigation.next_page", input: {} },
} as const)) {
  const world: UnifiedObjectWorld = {
    getSnapshot: (pageId, revision) =>
      pageId === "page-1" && revision === 7 ? SCENE : undefined,
    getObject: (id) => id === FOCUS.id ? FOCUS : undefined,
    getObjectMetadata: (id) => id === FOCUS.id
      ? describeSceneObject(FOCUS, { documentId: "doc-1" })
      : undefined,
    listPageObjects: () => [FOCUS],
    searchIndex: () => [],
    getRecentOperationOutputs: () => [],
  };
  const frozenSceneSource = new CurrentRevisionSceneSnapshotSource(() => ({
    documentId: "doc-1",
    scene: SCENE,
  }));
  const contextBuilder = new DirectCommandContextBuilder({
    frozenSceneSource,
    recentOperationsSource: { getRecentOperations: () => [] },
  });
  const registry = createExistingNoteToolRegistry();
  const route = new NoteAgentShadowRoute({
    contextBuilder,
    history: new DirectCommandHistoryContext(),
    world,
    registry,
    provider,
    createToolContext: (frozenWorld, turnId) => ({
      mode: "SHADOW",
      turnId,
      frozenWorld,
      world,
      resolver: new ExistingWorldResolver({ world }),
      getCurrentSceneRevision: () => 7,
    }),
  });
  return { route, provider };
}

describe("NoteAgentShadowRoute parity boundary", () => {
  it("keeps the existing route as the only commit owner", async () => {
    const { route, provider } = setup();
    const oldRoute = {
      execute: vi.fn(async () => ({
        status: "COMMITTED" as const,
        turnId: "turn-1",
        planId: "old-plan",
        operationId: "old-operation",
      })),
    };
    const result = await route.executeAlongside(turn(), oldRoute);
    expect(result.status).toBe("COMMITTED");
    expect(oldRoute.execute).toHaveBeenCalledOnce();
    expect(provider.callCount).toBe(1);
    expect(route.traces.getAll()).toEqual([
      expect.objectContaining({
        oldRouteStatus: "COMMITTED",
        resultStatus: "SUCCESS",
        toolId: "navigation.next_page",
        llmCallCount: 1,
        toolCallCount: 1,
        commitAttempted: false,
      }),
    ]);
  });

  it("never blocks the existing route when shadow evaluation fails", async () => {
    const provider = new FakeNoteDecisionProvider(() => {
      throw new Error("shadow fixture failure");
    });
    const { route } = setup(provider);
    const oldRoute = {
      execute: vi.fn(async () => ({
        status: "NAVIGATED" as const,
        turnId: "turn-1",
        direction: "next_page" as const,
      })),
    };
    await expect(route.executeAlongside(turn(), oldRoute)).resolves
      .toMatchObject({ status: "NAVIGATED" });
    expect(route.traces.getAll()[0]).toMatchObject({
      resultStatus: "DECISION_FAILED",
      commitAttempted: false,
      oldRouteStatus: "NAVIGATED",
    });
  });
});
