import {
  buildSceneSnapshot,
  EditorEngine,
  type PdfSceneObject,
} from "@ggulnote/editor-core";
import { PageSemanticModel } from "@ggulnote/document-core";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompletedVoiceTurn } from "../domain";
import { useOwnedBrowserDirectCommandComposition } from "./use-owned-browser-direct-command-composition";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PAGE_ID = "pdf-production-page-1";

const ONLINE_WORD: PdfSceneObject = {
  id: "pdf:word:online",
  pageId: PAGE_ID,
  source: "pdf",
  kind: "word",
  bounds: { x: 40, y: 80, width: 60, height: 18 },
  zIndex: 0,
  visible: true,
  locked: false,
  objectRevision: 1,
  sourceObjectId: "word-online",
  text: "online",
  readingOrder: 1,
  lineId: "line-online",
  charOffsetStart: 0,
  charOffsetEnd: 6,
};

const FINISH_WORD: PdfSceneObject = {
  ...ONLINE_WORD,
  id: "pdf:word:finish",
  sourceObjectId: "word-finish",
  text: "finish",
  bounds: { x: 40, y: 110, width: 55, height: 18 },
  readingOrder: 2,
  lineId: "line-finish",
  charOffsetStart: 7,
  charOffsetEnd: 13,
};

const PRODUCTION_SCENE = buildSceneSnapshot({
  mode: "pdf",
  page: { id: PAGE_ID, index: 0, width: 600, height: 800 },
  sceneRevision: 9,
  pdfObjects: [ONLINE_WORD, FINISH_WORD],
  canvasObjects: [],
});

const ORIENTATION = { angle: 0, writingMode: "horizontal" } as const;
const AXIS = { advanceX: 8, advanceY: 0, normalX: 0, normalY: 1 } as const;
const ONLINE_BOUNDS = { x: 40 / 600, y: 80 / 800, width: 60 / 600, height: 18 / 800 };
const FINISH_BOUNDS = { x: 40 / 600, y: 110 / 800, width: 55 / 600, height: 18 / 800 };
const RANGE_BOUNDS = {
  x: 40 / 600,
  y: 80 / 800,
  width: 60 / 600,
  height: 48 / 800,
};

const PRODUCTION_SEMANTIC_MODEL = new PageSemanticModel({
  schemaVersion: 1,
  extractorVersion: "production-composition-test",
  documentId: "doc-production",
  pageId: PAGE_ID,
  pageNumber: 1,
  sourceSignature: "online-finish-source",
  semanticSource: "legacy-semantic-fallback",
  readingOrder: ["word-online", "word-finish"],
  words: [
    {
      id: "word-online",
      type: "WORD",
      pageId: PAGE_ID,
      text: "online",
      normalizedText: "online",
      bounds: ONLINE_BOUNDS,
      readingOrder: 1,
      confidence: 1,
      orientation: ORIENTATION,
      regionId: "region-1",
      blockId: "block-1",
      columnId: "column-1",
      sourceItemIds: ["source-text-1"],
      sourceRanges: [{
        sourceTextItemId: "source-text-1",
        startOffset: 0,
        endOffset: 6,
      }],
      lineId: "line-online",
      direction: "ltr",
      startsWithPunctuation: false,
      endsWithPunctuation: false,
      hasEOL: true,
      axis: AXIS,
      quad: {
        points: [
          { x: ONLINE_BOUNDS.x, y: ONLINE_BOUNDS.y },
          { x: ONLINE_BOUNDS.x + ONLINE_BOUNDS.width, y: ONLINE_BOUNDS.y },
          {
            x: ONLINE_BOUNDS.x + ONLINE_BOUNDS.width,
            y: ONLINE_BOUNDS.y + ONLINE_BOUNDS.height,
          },
          { x: ONLINE_BOUNDS.x, y: ONLINE_BOUNDS.y + ONLINE_BOUNDS.height },
        ],
      },
    },
    {
      id: "word-finish",
      type: "WORD",
      pageId: PAGE_ID,
      text: "finish",
      normalizedText: "finish",
      bounds: FINISH_BOUNDS,
      readingOrder: 2,
      confidence: 1,
      orientation: ORIENTATION,
      regionId: "region-1",
      blockId: "block-1",
      columnId: "column-1",
      sourceItemIds: ["source-text-1"],
      sourceRanges: [{
        sourceTextItemId: "source-text-1",
        startOffset: 7,
        endOffset: 13,
      }],
      lineId: "line-finish",
      direction: "ltr",
      startsWithPunctuation: false,
      endsWithPunctuation: false,
      hasEOL: true,
      axis: AXIS,
      quad: {
        points: [
          { x: FINISH_BOUNDS.x, y: FINISH_BOUNDS.y },
          { x: FINISH_BOUNDS.x + FINISH_BOUNDS.width, y: FINISH_BOUNDS.y },
          {
            x: FINISH_BOUNDS.x + FINISH_BOUNDS.width,
            y: FINISH_BOUNDS.y + FINISH_BOUNDS.height,
          },
          { x: FINISH_BOUNDS.x, y: FINISH_BOUNDS.y + FINISH_BOUNDS.height },
        ],
      },
    },
  ],
  unassignedWords: [],
  lines: [
    {
      id: "line-online",
      type: "LINE",
      pageId: PAGE_ID,
      text: "online",
      normalizedText: "online",
      bounds: ONLINE_BOUNDS,
      readingOrder: 1,
      confidence: 1,
      orientation: ORIENTATION,
      regionId: "region-1",
      blockId: "block-1",
      columnId: "column-1",
      wordIds: ["word-online"],
      paragraphId: "paragraph-1",
      baseline: 0,
      direction: "ltr",
      columnIndex: 0,
      axis: AXIS,
      horizontalGaps: [],
    },
    {
      id: "line-finish",
      type: "LINE",
      pageId: PAGE_ID,
      text: "finish",
      normalizedText: "finish",
      bounds: FINISH_BOUNDS,
      readingOrder: 2,
      confidence: 1,
      orientation: ORIENTATION,
      regionId: "region-1",
      blockId: "block-1",
      columnId: "column-1",
      wordIds: ["word-finish"],
      paragraphId: "paragraph-1",
      baseline: 0,
      direction: "ltr",
      columnIndex: 0,
      axis: AXIS,
      horizontalGaps: [],
    },
  ],
  layoutRegions: [],
  layoutBlocks: [],
  columns: [],
  sentences: [{
    id: "sentence-1",
    type: "SENTENCE",
    pageId: PAGE_ID,
    text: "online finish",
    normalizedText: "online finish",
    bounds: RANGE_BOUNDS,
    fragments: [ONLINE_BOUNDS, FINISH_BOUNDS],
    readingOrder: 1,
    confidence: 1,
    orientation: ORIENTATION,
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    wordIds: ["word-online", "word-finish"],
    lineIds: ["line-online", "line-finish"],
    paragraphId: "paragraph-1",
    startWordId: "word-online",
    endWordId: "word-finish",
  }],
  paragraphs: [{
    id: "paragraph-1",
    type: "PARAGRAPH",
    pageId: PAGE_ID,
    text: "online finish",
    normalizedText: "online finish",
    bounds: RANGE_BOUNDS,
    fragments: [ONLINE_BOUNDS, FINISH_BOUNDS],
    readingOrder: 1,
    confidence: 1,
    orientation: ORIENTATION,
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    lineIds: ["line-online", "line-finish"],
    sentenceIds: ["sentence-1"],
    columnIndex: 0,
    averageFontSize: 12,
  }],
  createdAt: 1,
  sourceItemCount: 1,
  processingDurationMs: 0,
});

const TURN: CompletedVoiceTurn = {
  id: "turn-after-unmount",
  providerId: "fake",
  providerSessionId: "session-1",
  language: "ko-KR",
  requestedAt: 0,
  startedAt: 1,
  completedAt: 2,
  state: "completed",
  rawTranscript: "여기 밑줄",
  finalSegments: [{ id: "segment-1", index: 0, text: "여기 밑줄" }],
  frozenContext: {
    pageId: "page-1",
    sceneMode: "pdf",
    sceneRevision: 1,
    focusSource: "none",
    focusStale: false,
    capturedAt: 1,
  },
  focusSnapshot: {
    source: "none",
    capturedAt: 1,
    pageId: "page-1",
    sceneRevision: 1,
    stale: false,
  },
  scene: {
    sceneRevisionAtSpeechStart: 1,
    pageIdAtSpeechStart: "page-1",
    sceneChangedDuringTurn: false,
    pageChangedDuringTurn: false,
  },
  metrics: {
    interimUpdateCount: 0,
    finalSegmentCount: 1,
    providerRestartCount: 0,
  },
};

function createTextSpanTurn(
  id: string,
  rawTranscript: string,
): CompletedVoiceTurn {
  return {
    ...TURN,
    id,
    rawTranscript,
    finalSegments: [{ id: `${id}-segment`, index: 0, text: rawTranscript }],
    frozenContext: {
      pageId: PAGE_ID,
      sceneMode: "pdf",
      sceneRevision: 9,
      focusSource: "page",
      focusStale: false,
      capturedAt: 1,
    },
    focusSnapshot: {
      source: "page",
      capturedAt: 1,
      pageId: PAGE_ID,
      sceneRevision: 9,
      stale: false,
    },
    scene: {
      sceneRevisionAtSpeechStart: 9,
      pageIdAtSpeechStart: PAGE_ID,
      currentSceneRevisionAtCompletion: 9,
      sceneChangedDuringTurn: false,
      pageChangedDuringTurn: false,
    },
  };
}

function plannerResult(
  turnId: string,
  startAnchor: string,
  endAnchor: string,
) {
  return {
    status: "EXECUTABLE" as const,
    planId: `plan-${turnId}`,
    turnId,
    sceneRevision: 9,
    normalizedIntent: `${startAnchor}부터 ${endAnchor}까지 하이라이트`,
    relation: "NEW" as const,
    command: {
      capability: "annotation" as const,
      operation: "highlight" as const,
      target: { kind: "text_span" as const, startAnchor, endAnchor },
      payload: {},
    },
  };
}

function createProductionHarness(fetchMock: typeof fetch) {
  vi.stubGlobal("fetch", fetchMock);
  const editorEngine = new EditorEngine({ idGenerator: () => "production-highlight" });
  editorEngine.setDocument("doc-production");
  editorEngine.setActivePage(PAGE_ID, { width: 600, height: 800 });
  const rendered = renderHook(() => useOwnedBrowserDirectCommandComposition({
    editorEngine,
    readCurrentVoiceContext: () => {
      throw new Error("Context is not read during direct route execution.");
    },
    readCurrentGroundingSnapshot: () => ({
      scene: PRODUCTION_SCENE,
      semanticModel: PRODUCTION_SEMANTIC_MODEL,
    }),
    getCurrentSceneRevision: () => 9,
    getCurrentPage: () => 1,
    goToPage: () => undefined,
  }));
  return { editorEngine, ...rendered };
}

describe("useOwnedBrowserDirectCommandComposition", () => {
  it("keeps one session composition through Strict Mode and disposes route on unmount", async () => {
    const editorEngine = new EditorEngine();
    const { result, rerender, unmount } = renderHook(
      () => useOwnedBrowserDirectCommandComposition({
        editorEngine,
        readCurrentVoiceContext: () => {
          throw new Error("Context is not read before speech-start.");
        },
        readCurrentGroundingSnapshot: () => undefined,
        getCurrentSceneRevision: () => 1,
        getCurrentPage: () => 1,
        goToPage: () => undefined,
      }),
      { wrapper: StrictMode },
    );
    const initial = result.current;

    rerender();
    expect(result.current).toBe(initial);
    expect(result.current.voice.controller.getState().status).toBe("idle");

    unmount();
    await act(async () => Promise.resolve());

    await expect(initial.direct.route.execute(TURN)).resolves.toEqual({
      status: "ERROR",
      turnId: TURN.id,
      errorCode: "ABORTED",
    });
  });

  it("wires HTTP grounded recovery into the owned production composition", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const turn = createTextSpanTurn(
      "turn-online-finish",
      "온라인부터 피니시까지 하이라이트 해 줘",
    );
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/voice/direct-command/planner") {
        return Response.json({ result: plannerResult(turn.id, "온라인", "피니시") });
      }
      if (url === "/api/voice/direct-command/recover") {
        return Response.json({
          result: { status: "SELECTED", pairLabel: "P1" },
        });
      }
      throw new Error(`Unexpected endpoint: ${url}`);
    });
    const harness = createProductionHarness(fetchMock);

    let routeResult;
    await act(async () => {
      routeResult = await harness.result.current.direct.route.execute(turn);
    });

    expect(routeResult).toMatchObject({
      status: "COMMITTED",
      annotationId: "production-highlight",
    });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/voice/direct-command/planner",
      "/api/voice/direct-command/recover",
    ]);
    expect(harness.editorEngine.exportPageSnapshot(PAGE_ID).annotations[0])
      .toMatchObject({ type: "HIGHLIGHT" });
    expect(harness.editorEngine.exportPageSnapshot(PAGE_ID).annotations[0]?.rects)
      .toHaveLength(2);
    expect(harness.result.current.direct.traces.getSnapshot().at(-1)).toMatchObject({
      targetQueryKind: "text_span",
      initialResolutionStatus: "NOT_FOUND",
      initialResolutionReason: expect.any(String),
      targetRecoveryUsed: true,
      targetRecoveryKind: "text_span",
      recoveryCandidateCount: expect.any(Number),
      recoveryResult: "SELECTED",
      finalResolutionStatus: "RESOLVED",
      guardStatus: "PASSED",
      executionStatus: "COMMITTED",
    });
    expect(consoleDebug).toHaveBeenCalledWith(
      "[voice/direct-command]",
      expect.objectContaining({
        turnId: turn.id,
        targetQueryKind: "text_span",
        initialResolutionStatus: "NOT_FOUND",
        initialResolutionReason: expect.any(String),
        targetRecoveryUsed: true,
        targetRecoveryResult: "SELECTED",
        finalResolutionStatus: "RESOLVED",
        guardStatus: "PASSED",
        executionStatus: "COMMITTED",
      }),
    );
  });

  it("wires bounded speech refinement before planning in production", async () => {
    const turn = createTextSpanTurn(
      "turn-refined-online-finish",
      "어 online부터 아니 online부터 finish까지 하이라이트 해 줘",
    );
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/voice/direct-command/refine") {
        return Response.json({
          result: {
            status: "REFINED",
            refinedTranscript: "online부터 finish까지 하이라이트 해 줘",
            corrections: [{ kind: "self_correction" }],
          },
        });
      }
      if (url === "/api/voice/direct-command/planner") {
        return Response.json({
          result: plannerResult(turn.id, "online", "finish"),
        });
      }
      throw new Error("Unexpected endpoint: " + url);
    });
    const harness = createProductionHarness(fetchMock);

    await act(async () => {
      await expect(harness.result.current.direct.route.execute(turn))
        .resolves.toMatchObject({ status: "COMMITTED" });
    });

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/voice/direct-command/refine",
      "/api/voice/direct-command/planner",
    ]);
    expect(harness.result.current.direct.traces.getSnapshot().at(-1))
      .toMatchObject({
        speechRefinerUsed: true,
        speechRefinerResult: "REFINED",
        targetQueryKind: "text_span",
        targetSlotKind: "text_span",
        initialResolutionStatus: "RESOLVED",
        targetRecoveryUsed: false,
        executionStatus: "COMMITTED",
      });
  });

  it("does not call recovery when deterministic text span grounding resolves", async () => {
    const turn = createTextSpanTurn(
      "turn-exact-online-finish",
      "online부터 finish까지 하이라이트 해 줘",
    );
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url !== "/api/voice/direct-command/planner") {
        throw new Error(`Recovery must not be called: ${url}`);
      }
      return Response.json({ result: plannerResult(turn.id, "online", "finish") });
    });
    const harness = createProductionHarness(fetchMock);

    await act(async () => {
      await expect(harness.result.current.direct.route.execute(turn))
        .resolves.toMatchObject({ status: "COMMITTED" });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(harness.result.current.direct.traces.getSnapshot().at(-1)).toMatchObject({
      initialResolutionStatus: "RESOLVED",
      targetRecoveryUsed: false,
      finalResolutionStatus: "RESOLVED",
      executionStatus: "COMMITTED",
    });
  });
});
