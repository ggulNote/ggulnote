import {
  EditorEngine,
  buildSceneSnapshot,
  type EditorPersistenceEvent,
} from "@ggulnote/editor-core";
import { toSessionTimeMs } from "@ggulnote/interaction-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompletedVoiceTurn } from "../domain";
import { FakeDirectCommandPlannerProvider } from "../providers/testing/fake-direct-command-planner-provider";
import { createEditorDirectCommandComposition } from "./editor-direct-command-composition";

const PAGE_ID = "blank-natural-placement-page";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("natural text placement production flow", () => {
  it.each([
    {
      transcript: "왼쪽 위에 가나다라라고 써 줘",
      mode: "EXPLICIT_REGION",
      policy: "EXPLICIT_REGION",
      regionHint: "TOP",
      alignment: "START",
      stableFallbackUsed: false,
    },
    {
      transcript: "가나다라라고 써 줘",
      mode: "AUTO_FLOW",
      policy: "WRITING_FLOW",
      regionHint: "TOP",
      alignment: "START",
      stableFallbackUsed: false,
    },
    {
      transcript: "빈 공간에 가나다라라고 써 줘",
      mode: "AUTO_FREE_SPACE",
      policy: "USER_DELEGATED_LAYOUT",
      regionHint: undefined,
      alignment: "AUTO",
      stableFallbackUsed: true,
    },
    {
      transcript: "위에 가나다라라고 써 줘",
      mode: "EXPLICIT_REGION",
      policy: "EXPLICIT_REGION",
      regionHint: "TOP",
      alignment: "START",
      stableFallbackUsed: false,
    },
  ] as const)("recovers and commits '$transcript' exactly once", async ({
    transcript,
    mode,
    policy,
    regionHint,
    alignment,
    stableFallbackUsed,
  }) => {
    const harness = createHarness(transcript);
    const completed = turn(transcript);

    const [first, duplicate] = await Promise.all([
      harness.composition.route.execute(completed),
      harness.composition.route.execute(completed),
    ]);

    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({ status: "COMMITTED" });
    expect(harness.planner.planCallCount).toBe(1);
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(1);
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations[0]).toMatchObject({
      type: "TEXT",
      properties: { text: "가나다라" },
    });
    expect(harness.operations).toHaveLength(1);
    expect(harness.detached).toHaveBeenCalledTimes(1);
    const trace = harness.composition.traces.getSnapshot().at(-1);
    expect(trace).toMatchObject({
      plannerStatus: "EXECUTABLE",
      plannerPlacementPresent: false,
      normalizedPlacementMode: mode,
      placementChoicePolicy: policy,
      plannerOutputRecovered: true,
      placementRecoveryReason: "MISSING_PLACEMENT_QUERY",
      effectivePlacementQuery: {
        reference: { kind: "PAGE" },
        relation: "FREE_SPACE",
        alignment,
        ...(regionHint === undefined ? {} : { regionHint }),
      },
      executionStatus: "COMMITTED",
      spatial: {
        screenshotCallCount: 0,
        multimodalCallCount: 0,
        previewAttemptCount: 1,
        stableFallbackUsed,
        runtimeExecuted: true,
        operationRecorded: true,
      },
    });
    if (trace?.spatial === undefined) throw new Error("Expected spatial trace.");
    expect(trace.spatial.multimodalCallCount).toBe(0);
    expect(trace.spatial.screenshotCallCount).toBe(0);
    expect(trace.spatial.placementChoicePolicy).toBe(policy);
    expect(trace.spatial.stableFallbackUsed).toBe(stableFallbackUsed);
    const effective = harness.planner.lastInput;
    expect(effective?.turn.rawFinalTranscript).toBe(transcript);
    expect(trace?.spatial?.previewAttemptCount).toBe(1);
    expect(trace?.spatial?.runtimeExecuted).toBe(true);
    expect(trace?.spatial?.operationRecorded).toBe(true);
    expect(trace?.normalizedPlacementMode).toBe(mode);
    expect(trace?.spatialPhraseEvidenceKind).toBe(
      mode === "AUTO_FLOW" ? "NONE" : mode,
    );
    expect(trace?.spatial?.failureReason).toBeUndefined();
    expect(trace?.spatial?.selectionSource).toBe("DETERMINISTIC");

    const annotation = harness.editor.exportPageSnapshot(PAGE_ID).annotations[0];
    expect(annotation?.bounds.x).toBeGreaterThanOrEqual(0);
    expect(annotation?.bounds.y).toBeGreaterThanOrEqual(0);
    if (regionHint === "TOP") {
      expect(annotation?.bounds.y).toBeLessThan(0.5);
    }
    if (alignment === "START") {
      expect(annotation?.bounds.x).toBeLessThan(0.5);
    }

    harness.editor.undo();
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);
    harness.editor.redo();
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(1);
    expect(harness.operations.map((event) => event.historyAction)).toEqual([
      "execute",
      "undo",
      "redo",
    ]);
    harness.dispose();
  });

  it("keeps a missing deictic reference as a typed no-commit", async () => {
    const harness = createHarness("그 위에 가나다라라고 써 줘");

    const result = await harness.composition.route.execute(
      turn("그 위에 가나다라라고 써 줘"),
    );

    expect(result.status).toBe("TARGET_NOT_FOUND");
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);
    expect(harness.operations).toHaveLength(0);
    expect(harness.detached).not.toHaveBeenCalled();
    harness.dispose();
  });
});

function createHarness(transcript: string) {
  installPreviewCanvas();
  const scene = buildSceneSnapshot({
    mode: "blank",
    page: { id: PAGE_ID, index: 0, width: 600, height: 800 },
    sceneRevision: 10,
  });
  let annotationSequence = 0;
  const editor = new EditorEngine({
    idGenerator: () => `natural-text-${++annotationSequence}`,
  });
  editor.setDocument("blank-natural-placement");
  editor.setActivePage(PAGE_ID, { width: 600, height: 800 });
  const planner = new FakeDirectCommandPlannerProvider({
    result: {
      status: "EXECUTABLE",
      planId: "natural-plan-1",
      turnId: "natural-turn-1",
      sceneRevision: 10,
      normalizedIntent: transcript,
      relation: "NEW",
      command: {
        capability: "text",
        operation: "create",
        target: { kind: "CURRENT_PAGE" },
        payload: { text: "가나다라" },
      },
    },
  });
  const operations: EditorPersistenceEvent[] = [];
  const unsubscribe = editor.subscribeToOperations((event) => operations.push(event));
  const detached = vi.fn();
  const source = { width: 600, height: 800 } as HTMLCanvasElement;
  const composition = createEditorDirectCommandComposition({
    editorEngine: editor,
    clock: { now: () => toSessionTimeMs(100) },
    readCurrentGroundingSnapshot: () => ({ scene }),
    getCurrentSceneRevision: () => 10,
    getCurrentPage: () => 1,
    goToPage: () => undefined,
    planner,
    spatial: {
      getBaseCanvas: () => source,
      getOverlayCanvas: () => source,
      mountPreviewCanvas: () => detached,
    },
  });
  return {
    composition,
    editor,
    planner,
    operations,
    detached,
    dispose() {
      unsubscribe();
      composition.dispose();
    },
  };
}

function turn(transcript: string): CompletedVoiceTurn {
  return {
    id: "natural-turn-1",
    providerId: "natural-placement-test",
    providerSessionId: "natural-session-1",
    language: "ko-KR",
    requestedAt: 1,
    startedAt: 2,
    completedAt: 3,
    state: "completed",
    rawTranscript: transcript,
    finalSegments: [{ id: "segment-1", index: 0, text: transcript }],
    frozenContext: {
      pageId: PAGE_ID,
      sceneMode: "blank",
      sceneRevision: 10,
      focusSource: "page",
      focusStale: false,
      capturedAt: 2,
    },
    focusSnapshot: {
      source: "page",
      capturedAt: 2,
      pageId: PAGE_ID,
      sceneRevision: 10,
      stale: false,
    },
    scene: {
      sceneRevisionAtSpeechStart: 10,
      pageIdAtSpeechStart: PAGE_ID,
      currentSceneRevisionAtCompletion: 10,
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

function installPreviewCanvas(): void {
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName.toLowerCase() !== "canvas") return originalCreateElement(tagName);
    return previewCanvas();
  }) as typeof document.createElement);
}

function previewCanvas(): HTMLCanvasElement {
  let painted: { x: number; y: number; width: number; height: number } | undefined;
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    setAttribute: vi.fn(),
    remove: vi.fn(),
  } as unknown as HTMLCanvasElement;
  const context = {
    canvas,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn((x: number, y: number, width: number, height: number) => {
      painted = { x, y, width, height };
    }),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: Math.max(1, text.length * 7) })),
    getImageData: vi.fn(() => {
      const width = Math.max(1, canvas.width);
      const height = Math.max(1, canvas.height);
      const data = new Uint8ClampedArray(width * height * 4);
      if (painted !== undefined) {
        const left = Math.max(0, Math.floor(painted.x));
        const top = Math.max(0, Math.floor(painted.y));
        const right = Math.min(width, Math.ceil(painted.x + painted.width));
        const bottom = Math.min(height, Math.ceil(painted.y + painted.height));
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            data[(y * width + x) * 4 + 3] = 255;
          }
        }
      }
      return { data };
    }),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
  };
  Object.assign(canvas, { getContext: vi.fn(() => context) });
  return canvas;
}
