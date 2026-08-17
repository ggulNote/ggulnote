import {
  EditorEngine,
  type SceneSnapshot,
} from "@ggulnote/editor-core";
import { toSessionTimeMs } from "@ggulnote/interaction-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Editor,
  createTLStore,
  defaultAddFontsFromNode,
  defaultBindingUtils,
  defaultShapeUtils,
  tipTapDefaultExtensions,
  type TLAnyShapeUtilConstructor,
} from "tldraw";
import {
  NoteAnnotationShapeUtil,
  TldrawEditorAdapter,
} from "../../editor/adapters/tldraw";
import type { CompletedVoiceTurn } from "../domain";
import type {
  NoteDecisionCompositionProvider,
  NoteDecisionInput,
  NoteDisambiguationChoice,
} from "../note-agent";
import { buildEditorVoiceContextRead } from "./editor-voice-context";
import { createEditorDirectCommandComposition } from "./editor-direct-command-composition";

const PAGE_ID = "doc-sequential-page-1";
const PAGE_SIZE = { width: 600, height: 800 } as const;
const IMAGE_DATA_URL = "data:image/png;base64,AA==";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("tldraw One Decision sequential production flow", () => {
  it("creates, catalogs, places below a recent handle, and undoes the second turn once", async () => {
    const { editor: tldrawEditor, adapter } = createTldrawAdapter();
    installBrowserCanvas();
    const editorEngine = new EditorEngine();
    editorEngine.setDocument("doc-sequential");
    editorEngine.setActivePage(PAGE_ID, PAGE_SIZE);
    let currentRevision = 7;
    let currentScene = projectScene(adapter, currentRevision);
    const provider = new SequentialDecisionProvider();
    const sourceCanvas = { width: 600, height: 800 } as HTMLCanvasElement;
    const composition = createEditorDirectCommandComposition({
      editorEngine,
      clock: { now: () => toSessionTimeMs(100) },
      readCurrentGroundingSnapshot: () => ({ documentId: "doc-sequential", scene: currentScene }),
      getCurrentSceneRevision: () => currentRevision,
      getCurrentPage: () => 1,
      goToPage: () => undefined,
      getTldrawAdapter: () => adapter,
      spatial: {
        getBaseCanvas: () => sourceCanvas,
        getOverlayCanvas: () => null,
        mountPreviewCanvas: () => () => undefined,
      },
      noteAgent: { mode: "PRODUCTION", provider },
    });

    const firstResult = await composition.noteAgentProduction?.execute(
      turn("turn-1", "안녕하세요 써줘", currentRevision),
    );
    if (firstResult?.status !== "COMMITTED") {
      throw new Error(JSON.stringify({
        firstResult,
        trace: composition.noteAgentProduction?.traces.getAll().at(-1),
      }));
    }
    const firstObject = adapter.getCurrentPageObjects()[0];
    expect(firstObject).toMatchObject({ kind: "text", text: "안녕하세요" });

    currentRevision = 8;
    currentScene = projectScene(adapter, currentRevision);
    await expect(composition.noteAgentProduction?.execute(
      turn("turn-2", "안녕하세여 밑에 가나다라라고 써줘", currentRevision),
    )).resolves.toMatchObject({ status: "COMMITTED" });
    const afterSecond = adapter.getCurrentPageObjects();
    expect(afterSecond).toHaveLength(2);
    expect(afterSecond[1]).toMatchObject({ kind: "text", text: "가나다라" });
    expect(afterSecond[1]!.bounds.y).toBeGreaterThanOrEqual(
      firstObject!.bounds.y + firstObject!.bounds.height,
    );
    const secondInput = provider.inputs[1];
    expect(secondInput?.objectCatalog.objects).toEqual([
      expect.objectContaining({
        handle: "O1",
        source: "tldraw",
        kind: "text",
        summary: "안녕하세요",
        recent: true,
      }),
    ]);
    expect(JSON.stringify(secondInput)).not.toContain(firstObject!.objectId);
    const secondTrace = composition.noteAgentProduction?.traces.getAll().at(-1);
    expect(secondTrace).toMatchObject({
      decisionCallCount: 1,
      visualCallCount: 0,
      commitAttempted: true,
      objectCatalogObjectCount: 1,
    });
    expect(secondTrace?.tldrawProjectionMs).toBeGreaterThanOrEqual(0);
    expect(secondTrace?.objectCatalogBuildMs).toBeGreaterThanOrEqual(0);
    expect(secondTrace?.objectCatalogSerializedChars).toBeGreaterThan(0);
    expect(secondTrace?.decisionTotalMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(secondTrace)).not.toContain(firstObject!.objectId);

    currentRevision = 9;
    currentScene = projectScene(adapter, currentRevision);
    await expect(composition.noteAgentProduction?.execute(
      turn("turn-3", "실행 취소", currentRevision),
    )).resolves.toMatchObject({ status: "UNDONE" });
    expect(adapter.getCurrentPageObjects()).toEqual([
      expect.objectContaining({ text: "안녕하세요" }),
    ]);
    expect(provider.decisionCallCount).toBe(3);
    expect(provider.disambiguationCallCount).toBe(0);

    composition.dispose();
    tldrawEditor.dispose();
    editorEngine.destroy();
  });

  it("keeps duplicate-content objects distinct and commits nothing on model clarification", async () => {
    const { editor: tldrawEditor, adapter } = createTldrawAdapter();
    adapter.applyPreparedOperations({
      turnId: "duplicate-fixture",
      operations: [
        { kind: "CREATE_TEXT", text: "안녕하세요", bounds: { x: 40, y: 80, width: 160, height: 40 } },
        { kind: "CREATE_TEXT", text: "안녕하세요", bounds: { x: 320, y: 80, width: 160, height: 40 } },
      ],
    });
    const editorEngine = new EditorEngine();
    editorEngine.setDocument("doc-sequential");
    editorEngine.setActivePage(PAGE_ID, PAGE_SIZE);
    const revision = 7;
    const scene = projectScene(adapter, revision);
    let decisionInput: NoteDecisionInput | undefined;
    const provider: NoteDecisionCompositionProvider = {
      decide: (input) => {
        decisionInput = input;
        return Promise.resolve({
          status: "NEEDS_CLARIFICATION",
          sceneRevision: revision,
          reason: "AMBIGUOUS_OBJECT",
        });
      },
      disambiguate: () => Promise.reject(new Error("Separate disambiguation is forbidden.")),
    };
    const composition = createEditorDirectCommandComposition({
      editorEngine,
      clock: { now: () => toSessionTimeMs(100) },
      readCurrentGroundingSnapshot: () => ({ documentId: "doc-sequential", scene }),
      getCurrentSceneRevision: () => revision,
      getCurrentPage: () => 1,
      goToPage: () => undefined,
      getTldrawAdapter: () => adapter,
      spatial: {
        getBaseCanvas: () => null,
        getOverlayCanvas: () => null,
        mountPreviewCanvas: () => () => undefined,
      },
      noteAgent: { mode: "PRODUCTION", provider },
    });

    await expect(composition.noteAgentProduction?.execute(
      turn("turn-duplicate", "안녕하세요 밑에 써줘", revision),
    )).resolves.toMatchObject({ status: "NEEDS_CLARIFICATION" });
    expect(decisionInput?.objectCatalog.objects).toEqual([
      expect.objectContaining({ handle: "O1", summary: "안녕하세요" }),
      expect.objectContaining({ handle: "O2", summary: "안녕하세요" }),
    ]);
    expect(adapter.getCurrentPageObjects()).toHaveLength(2);
    expect(composition.noteAgentProduction?.traces.getAll().at(-1)).toMatchObject({
      decisionCallCount: 1,
      commitAttempted: false,
    });

    composition.dispose();
    tldrawEditor.dispose();
    editorEngine.destroy();
  });
});

class SequentialDecisionProvider implements NoteDecisionCompositionProvider {
  public decisionCallCount = 0;
  public disambiguationCallCount = 0;
  public readonly inputs: NoteDecisionInput[] = [];

  public decide(input: NoteDecisionInput) {
    this.decisionCallCount += 1;
    this.inputs.push(input);
    const sceneRevision = input.frozenContext.sceneRevision;
    if (input.turn.rawFinalTranscript === "안녕하세요 써줘") {
      return Promise.resolve({
        status: "READY" as const,
        sceneRevision,
        steps: [{
          action: "text.create" as const,
          target: null,
          args: { text: "안녕하세요" },
          destination: { relation: "CANVAS_REGION" as const, anchor: null, region: "TOP_LEFT" as const },
        }],
      });
    }
    if (input.turn.rawFinalTranscript === "실행 취소") {
      return Promise.resolve({
        status: "READY" as const,
        sceneRevision,
        steps: [{ action: "history.undo" as const, target: null, args: {}, destination: null }],
      });
    }
    const anchor = input.objectCatalog.objects.find((object) => object.summary === "안녕하세요");
    if (anchor === undefined) throw new Error("Expected recent tldraw catalog anchor.");
    return Promise.resolve({
      status: "READY" as const,
      sceneRevision,
      steps: [{
        action: "text.create" as const,
        target: null,
        args: { text: "가나다라" },
        destination: {
          relation: "BELOW" as const,
          anchor: { object: anchor.handle, part: null },
          region: null,
        },
      }],
    });
  }

  public disambiguate(): Promise<NoteDisambiguationChoice> {
    this.disambiguationCallCount += 1;
    throw new Error("A separate target-selection call is forbidden.");
  }
}

function projectScene(adapter: TldrawEditorAdapter, revision: number): SceneSnapshot {
  return buildEditorVoiceContextRead({
    documentId: "doc-sequential",
    mode: "blank",
    pageId: PAGE_ID,
    pageIndex: 0,
    pageSize: PAGE_SIZE,
    sceneRevision: revision,
    pageSnapshot: adapter.exportPageProjection(),
  }).scene;
}

function turn(id: string, transcript: string, revision: number): CompletedVoiceTurn {
  return {
    id,
    providerId: "sequential-test",
    providerSessionId: `session:${id}`,
    language: "ko-KR",
    requestedAt: 1,
    startedAt: 2,
    completedAt: 3,
    state: "completed",
    rawTranscript: transcript,
    finalSegments: [{ id: `segment:${id}`, index: 0, text: transcript }],
    frozenContext: {
      pageId: PAGE_ID,
      sceneMode: "blank",
      sceneRevision: revision,
      focusSource: "page",
      focusStale: false,
      capturedAt: 2,
    },
    focusSnapshot: {
      source: "page",
      capturedAt: 2,
      pageId: PAGE_ID,
      sceneRevision: revision,
      stale: false,
    },
    scene: {
      sceneRevisionAtSpeechStart: revision,
      pageIdAtSpeechStart: PAGE_ID,
      currentSceneRevisionAtCompletion: revision,
      sceneChangedDuringTurn: false,
      pageChangedDuringTurn: false,
    },
    metrics: { interimUpdateCount: 0, finalSegmentCount: 1, providerRestartCount: 0 },
  };
}

function createTldrawAdapter(): { editor: Editor; adapter: TldrawEditorAdapter } {
  const shapeUtils: readonly TLAnyShapeUtilConstructor[] = [
    ...defaultShapeUtils,
    NoteAnnotationShapeUtil,
  ];
  const editor = new Editor({
    store: createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils }),
    shapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [],
    getContainer: () => document.body,
    options: {
      text: {
        addFontsFromNode: defaultAddFontsFromNode,
        tipTapConfig: { extensions: tipTapDefaultExtensions },
      },
    },
  });
  return {
    editor,
    adapter: new TldrawEditorAdapter(
      editor,
      "doc-sequential",
      PAGE_ID,
      1,
      PAGE_SIZE,
      () => 100,
    ),
  };
}

function installBrowserCanvas(): void {
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName.toLowerCase() !== "canvas") return originalCreateElement(tagName);
    return runtimeCanvas();
  }) as typeof document.createElement);
  class ImmediateImage {
    public onload: (() => void) | null = null;
    public set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", ImmediateImage);
}

function runtimeCanvas(): HTMLCanvasElement {
  let paintRect: { x: number; y: number; width: number; height: number } | undefined;
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    setAttribute: vi.fn(),
    remove: vi.fn(),
    toDataURL: vi.fn(() => IMAGE_DATA_URL),
  } as unknown as HTMLCanvasElement;
  const context = {
    canvas,
    setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    scale: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), fillText: vi.fn(), setLineDash: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: Math.max(1, text.length * 7) })),
    strokeRect: vi.fn((x: number, y: number, width: number, height: number) => {
      paintRect = { x, y, width, height };
    }),
    getImageData: vi.fn(() => {
      const width = Math.max(1, canvas.width);
      const height = Math.max(1, canvas.height);
      const data = new Uint8ClampedArray(width * height * 4);
      if (paintRect !== undefined) {
        const left = Math.max(0, Math.floor(paintRect.x));
        const top = Math.max(0, Math.floor(paintRect.y));
        const right = Math.min(width, Math.ceil(paintRect.x + paintRect.width));
        const bottom = Math.min(height, Math.ceil(paintRect.y + paintRect.height));
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) data[(y * width + x) * 4 + 3] = 255;
        }
      }
      return { data };
    }),
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "",
    textAlign: "start", textBaseline: "alphabetic",
  };
  Object.assign(canvas, { getContext: vi.fn(() => context) });
  return canvas;
}
