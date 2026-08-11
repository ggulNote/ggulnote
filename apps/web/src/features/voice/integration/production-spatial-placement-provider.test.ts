import {
  EditorEngine,
  buildSceneSnapshot,
  type EditorPersistenceEvent,
  type ImageSceneObject,
} from "@ggulnote/editor-core";
import { toSessionTimeMs } from "@ggulnote/interaction-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompletedVoiceTurn } from "../domain";
import { HttpMultimodalPlacementJudgeProvider } from "../providers";
import { FakeDirectCommandPlannerProvider } from "../providers/testing/fake-direct-command-planner-provider";
import { createEditorDirectCommandComposition } from "./editor-direct-command-composition";

const PAGE_ID = "doc-spatial-page-1";
const IMAGE_DATA_URL = "data:image/png;base64,AA==";

const FIGURE: ImageSceneObject = {
  id: "pdf:figure:1",
  pageId: PAGE_ID,
  source: "pdf",
  kind: "image",
  bounds: { x: 100, y: 100, width: 100, height: 50 },
  zIndex: 0,
  visible: true,
  locked: true,
  objectRevision: 1,
  sourceObjectId: "figure-source-1",
  imageId: "figure-image-1",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function turn(id: string): CompletedVoiceTurn {
  return {
    id,
    providerId: "production-spatial-test",
    providerSessionId: `session:${id}`,
    language: "ko-KR",
    requestedAt: 1,
    startedAt: 2,
    completedAt: 3,
    state: "completed",
    rawTranscript: "이 그림 아래에 메모 추가",
    finalSegments: [{ id: `segment:${id}`, index: 0, text: "이 그림 아래에 메모 추가" }],
    frozenContext: {
      pageId: PAGE_ID,
      sceneMode: "pdf",
      sceneRevision: 7,
      focusSource: "page",
      focusStale: false,
      capturedAt: 2,
    },
    focusSnapshot: {
      source: "page",
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
    metrics: {
      interimUpdateCount: 0,
      finalSegmentCount: 1,
      providerRestartCount: 0,
    },
  };
}

function planner(
  turnId: string,
  alignment: "START" | "AUTO",
): FakeDirectCommandPlannerProvider {
  return new FakeDirectCommandPlannerProvider({
    result: {
      status: "EXECUTABLE",
      planId: `plan:${turnId}`,
      turnId,
      sceneRevision: 7,
      normalizedIntent: "이 그림 아래에 메모 추가",
      relation: "NEW",
      command: {
        capability: "text",
        operation: "create",
        target: { kind: "CURRENT_PAGE" },
        payload: { text: "그림 설명" },
      },
      placementQuery: {
        reference: {
          kind: "TARGET",
          query: { kind: "object", objectType: "image", query: "이 그림" },
        },
        relation: "BELOW",
        alignment,
        overlayIntent: "NONE",
      },
    },
  });
}

function installBrowserCanvas(options: { readonly overflowPreview?: boolean } = {}) {
  const originalCreateElement = document.createElement.bind(document);
  const created: ReturnType<typeof runtimeCanvas>[] = [];
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName.toLowerCase() !== "canvas") {
      return originalCreateElement(tagName);
    }
    const surface = runtimeCanvas(options);
    created.push(surface);
    return surface.canvas;
  }) as typeof document.createElement);

  class ImmediateImage {
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;

    public set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", ImmediateImage);
  return created;
}

function runtimeCanvas(options: { readonly overflowPreview?: boolean }) {
  let paintRect: { x: number; y: number; width: number; height: number } | undefined;
  const style: Record<string, string> = {};
  const canvas = {
    width: 0,
    height: 0,
    style,
    setAttribute: vi.fn(),
    remove: vi.fn(),
    toDataURL: vi.fn(() => IMAGE_DATA_URL),
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
      paintRect = { x, y, width, height };
    }),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: Math.max(1, text.length * 7) })),
    getImageData: vi.fn(() => {
      const width = Math.max(1, canvas.width);
      const height = Math.max(1, canvas.height);
      const data = new Uint8ClampedArray(width * height * 4);
      const source = options.overflowPreview
        ? { x: 0, y: 0, width, height }
        : paintRect;
      if (source !== undefined) {
        const left = Math.max(0, Math.floor(source.x));
        const top = Math.max(0, Math.floor(source.y));
        const right = Math.min(width, Math.ceil(source.x + source.width));
        const bottom = Math.min(height, Math.ceil(source.y + source.height));
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
  return { canvas, context };
}

function sourceCanvas(): HTMLCanvasElement {
  return { width: 600, height: 800 } as HTMLCanvasElement;
}

function createHarness(options: {
  readonly id: string;
  readonly alignment: "START" | "AUTO";
  readonly fetch: typeof fetch;
  readonly overflowPreview?: boolean;
}) {
  const createdCanvases = installBrowserCanvas({
    ...(options.overflowPreview === undefined
      ? {}
      : { overflowPreview: options.overflowPreview }),
  });
  const scene = buildSceneSnapshot({
    mode: "pdf",
    page: { id: PAGE_ID, index: 0, width: 600, height: 800 },
    sceneRevision: 7,
    pdfObjects: [FIGURE],
  });
  let currentRevision = 7;
  let annotationSequence = 0;
  const editor = new EditorEngine({
    idGenerator: () => `spatial-text-${++annotationSequence}`,
  });
  editor.setDocument("doc-spatial");
  editor.setActivePage(PAGE_ID, { width: 600, height: 800 });
  const operations: EditorPersistenceEvent[] = [];
  const unsubscribe = editor.subscribeToOperations((event) => operations.push(event));
  const detached = vi.fn();
  const composition = createEditorDirectCommandComposition({
    editorEngine: editor,
    clock: { now: () => toSessionTimeMs(100) },
    readCurrentGroundingSnapshot: () => ({ scene }),
    getCurrentSceneRevision: () => currentRevision,
    getCurrentPage: () => 1,
    goToPage: () => undefined,
    planner: planner(options.id, options.alignment),
    spatial: {
      getBaseCanvas: sourceCanvas,
      getOverlayCanvas: sourceCanvas,
      mountPreviewCanvas: () => detached,
      placementJudge: new HttpMultimodalPlacementJudgeProvider({ fetch: options.fetch }),
    },
  });
  return {
    composition,
    editor,
    operations,
    detached,
    createdCanvases,
    setRevision: (revision: number) => {
      currentRevision = revision;
    },
    dispose: () => {
      unsubscribe();
      composition.dispose();
    },
  };
}

describe("production spatial placement judge wiring", () => {
  it("keeps the deterministic route screenshot/VLM-free and commits once after preview", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error("The deterministic path must not call the placement judge.");
    });
    const harness = createHarness({
      id: "turn-production-deterministic",
      alignment: "START",
      fetch: fetchMock,
    });

    const result = await harness.composition.route.execute(turn("turn-production-deterministic"));

    expect(result.status).toBe("COMMITTED");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(1);
    expect(harness.operations).toHaveLength(1);
    expect(harness.detached).toHaveBeenCalledTimes(1);
    expect(harness.composition.traces.getSnapshot().at(-1)?.spatial).toMatchObject({
      deterministicGate: "RESOLVED",
      screenshotCallCount: 0,
      multimodalCallCount: 0,
      previewAttemptCount: 1,
      runtimeExecuted: true,
      operationRecorded: true,
    });
    harness.dispose();
  });

  it("uses the same-origin judge once for ambiguity, commits exactly once, and preserves undo/redo", async () => {
    let serializedRequest = "";
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("/api/voice/direct-command/placement-judge");
      serializedRequest = String(init?.body);
      return Response.json({ result: { choice: "S2" } });
    });
    const harness = createHarness({
      id: "turn-production-ambiguous",
      alignment: "AUTO",
      fetch: fetchMock,
    });
    const voiceTurn = turn("turn-production-ambiguous");

    const [first, duplicate] = await Promise.all([
      harness.composition.route.execute(voiceTurn),
      harness.composition.route.execute(voiceTurn),
    ]);

    expect(first).toEqual(duplicate);
    expect(first.status).toBe("COMMITTED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(serializedRequest).not.toContain("objectId");
    expect(serializedRequest).not.toContain("candidateId");
    expect(serializedRequest).not.toContain("\"bounds\"");
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(1);
    expect(harness.operations).toHaveLength(1);
    expect(harness.detached).toHaveBeenCalledTimes(1);
    expect(harness.composition.traces.getSnapshot().at(-1)?.spatial).toMatchObject({
      deterministicGate: "AMBIGUOUS",
      screenshotCallCount: 1,
      multimodalCallCount: 1,
      multimodalProviderResult: "S2",
      previewAttemptCount: 1,
      runtimeExecuted: true,
      operationRecorded: true,
    });

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

  it.each([
    {
      name: "NONE",
      response: () => Response.json({ result: { choice: "NONE" } }),
      expectedError: "NO_FEASIBLE_PLACEMENT",
      mutate: (_harness: ReturnType<typeof createHarness>) => undefined,
      overflowPreview: false,
    },
    {
      name: "provider error",
      response: () => Response.json({
        error: { code: "PLANNER_UNAVAILABLE", reason: "NETWORK_FAILURE" },
      }, { status: 503 }),
      expectedError: "MULTIMODAL_UNRESOLVED",
      mutate: (_harness: ReturnType<typeof createHarness>) => undefined,
      overflowPreview: false,
    },
    {
      name: "stale response",
      response: () => Response.json({ result: { choice: "S1" } }),
      expectedError: "STALE_SCENE",
      mutate: (harness: ReturnType<typeof createHarness>) => harness.setRevision(8),
      overflowPreview: false,
    },
    {
      name: "validation failure",
      response: () => Response.json({ result: { choice: "S2" } }),
      expectedError: "VALIDATION_FAILED",
      mutate: (_harness: ReturnType<typeof createHarness>) => undefined,
      overflowPreview: true,
    },
  ])("keeps $name side-effect free", async ({
    name,
    response,
    expectedError,
    mutate,
    overflowPreview,
  }) => {
    let harness: ReturnType<typeof createHarness>;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      mutate(harness);
      return response();
    });
    harness = createHarness({
      id: `turn-production-${name.replace(/\s+/gu, "-")}`,
      alignment: "AUTO",
      fetch: fetchMock,
      overflowPreview,
    });

    const result = await harness.composition.route.execute(
      turn(`turn-production-${name.replace(/\s+/gu, "-")}`),
    );

    expect(result).toMatchObject({ status: "ERROR", errorCode: expectedError });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(harness.editor.exportPageSnapshot(PAGE_ID).annotations).toHaveLength(0);
    expect(harness.operations).toHaveLength(0);
    const spatial = harness.composition.traces.getSnapshot().at(-1)?.spatial;
    expect(spatial).toMatchObject({
      screenshotCallCount: 1,
      multimodalCallCount: 1,
      runtimeExecuted: false,
      operationRecorded: false,
    });
    if (name === "validation failure") {
      expect(spatial?.previewAttemptCount).toBe(2);
      expect(spatial?.previewFailureReason).toBe("FOOTPRINT_OVERFLOW");
      expect(harness.detached).toHaveBeenCalledTimes(2);
    } else {
      expect(spatial?.previewAttemptCount).toBe(0);
      expect(harness.detached).not.toHaveBeenCalled();
    }
    harness.dispose();
  });
});
