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
import { FrozenTargetResolver } from "../application";
import type { DirectCommandPlannerProvider } from "../providers";
import type {
  NoteDecisionCompositionProvider,
  NoteDecisionInput,
  NoteDisambiguationChoice,
} from "../note-agent";
import { HttpNoteDecisionProvider } from "../note-agent";
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
  it("sends the raw utterance and compact catalog through the same-origin strict Decision route", async () => {
    const { editor: tldrawEditor, adapter } = createTldrawAdapter();
    installBrowserCanvas();
    const editorEngine = new EditorEngine();
    editorEngine.setDocument("doc-sequential");
    editorEngine.setActivePage(PAGE_ID, PAGE_SIZE);
    let revision = 7;
    let scene = projectScene(adapter, revision);
    const requestBodies: NoteDecisionInput[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/voice/note-decision");
      const envelope = JSON.parse(String(init?.body)) as { input: NoteDecisionInput };
      const body = envelope.input;
      requestBodies.push(body);
      if (body.turn.rawFinalTranscript === "안녕하세요라고 써 줘") {
        return Response.json({
          result: {
            status: "READY",
            sceneRevision: body.frozenContext.sceneRevision,
            steps: [{
              action: "text.create",
              target: null,
              args: { text: "안녕하세요" },
              destination: {
                relation: "CANVAS_REGION",
                anchor: null,
                region: "TOP_LEFT",
              },
            }],
          },
        });
      }
      return Response.json({
        result: {
          status: "READY",
          sceneRevision: body.frozenContext.sceneRevision,
          steps: [{
            action: "text.create",
            target: null,
            args: { text: "가나다라" },
            destination: {
              relation: "BELOW",
              anchor: {
                object: "O1",
                part: {
                  kind: "text_range",
                  index: null,
                  row: null,
                  column: null,
                  text: "안녕하세요",
                  startText: null,
                  endText: null,
                },
              },
              region: null,
            },
          }],
        },
      });
    });
    const legacyPlanner: DirectCommandPlannerProvider = {
      plan: vi.fn(() => Promise.reject(new Error("Legacy planner must not run."))),
    };
    const composition = createEditorDirectCommandComposition({
      editorEngine,
      clock: { now: () => toSessionTimeMs(100) },
      readCurrentGroundingSnapshot: () => ({ documentId: "doc-sequential", scene }),
      getCurrentSceneRevision: () => revision,
      getCurrentPage: () => 1,
      goToPage: () => undefined,
      getTldrawAdapter: () => adapter,
      planner: legacyPlanner,
      spatial: {
        getBaseCanvas: () => ({ width: 600, height: 800 }) as HTMLCanvasElement,
        getOverlayCanvas: () => null,
        mountPreviewCanvas: () => () => undefined,
      },
      noteAgent: {
        mode: "PRODUCTION",
        provider: new HttpNoteDecisionProvider({ fetch }),
      },
    });

    const firstHttpResult = await composition.noteAgentProduction?.execute(
      turn("turn-http-1", "안녕하세요라고 써 줘", revision),
    );
    if (firstHttpResult?.status !== "COMMITTED") {
      throw new Error(JSON.stringify({
        firstHttpResult,
        trace: composition.noteAgentProduction?.traces.getAll().at(-1),
      }));
    }
    revision = 8;
    scene = projectScene(adapter, revision);
    const result = await composition.noteAgentProduction?.execute(
      turn("turn-http", "안녕하세요 밑에 가나다라라고 써 줘", revision),
    );
    if (result?.status !== "COMMITTED") {
      throw new Error(JSON.stringify({
        result,
        trace: composition.noteAgentProduction?.traces.getAll().at(-1),
      }));
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(legacyPlanner.plan).not.toHaveBeenCalled();
    const requestBody = requestBodies[1];
    expect(requestBody?.turn.rawFinalTranscript)
      .toBe("안녕하세요 밑에 가나다라라고 써 줘");
    expect(requestBody?.objectCatalog.objects).toEqual([
      expect.objectContaining({
        handle: "O1",
        source: "tldraw",
        kind: "text",
        text: "안녕하세요",
      }),
    ]);
    expect(JSON.stringify(requestBody)).not.toContain(
      adapter.getCurrentPageObjects()[0]?.objectId,
    );
    const objects = adapter.getCurrentPageObjects();
    expect(objects[1]?.text).toBe("가나다라");
    expect(objects[1]!.bounds.y).toBeGreaterThanOrEqual(
      objects[0]!.bounds.y + objects[0]!.bounds.height,
    );
    expect(composition.noteAgentProduction?.traces.getAll().at(-1)).toMatchObject({
      runtimeOwner: "note-agent-v2",
      catalogHandles: ["O1"],
      selectedHandle: "O1",
      decisionStatus: "READY",
      decisionAction: "text.create",
      decisionReferenceHandle: "O1",
      decisionRelation: "BELOW",
      legacyPlannerInvoked: false,
      fuzzyObjectSelectorInvoked: false,
      commitAttempted: true,
    });

    composition.dispose();
    tldrawEditor.dispose();
    editorEngine.destroy();
  });

  it("creates, catalogs, places below a recent handle, and undoes the second turn once", async () => {
    const { editor: tldrawEditor, adapter } = createTldrawAdapter();
    installBrowserCanvas();
    const editorEngine = new EditorEngine();
    editorEngine.setDocument("doc-sequential");
    editorEngine.setActivePage(PAGE_ID, PAGE_SIZE);
    let currentRevision = 7;
    let currentScene = projectScene(adapter, currentRevision);
    const provider = new SequentialDecisionProvider();
    const legacyPlanner: DirectCommandPlannerProvider = {
      plan: vi.fn(() => Promise.reject(new Error("Legacy planner must not run."))),
    };
    const legacyTargetResolver = new FrozenTargetResolver();
    const legacyTargetResolve = vi.spyOn(legacyTargetResolver, "resolve");
    const composition = createEditorDirectCommandComposition({
      editorEngine,
      clock: { now: () => toSessionTimeMs(100) },
      readCurrentGroundingSnapshot: () => ({ documentId: "doc-sequential", scene: currentScene }),
      getCurrentSceneRevision: () => currentRevision,
      getCurrentPage: () => 1,
      goToPage: () => undefined,
      getTldrawAdapter: () => adapter,
      planner: legacyPlanner,
      targetResolver: legacyTargetResolver,
      spatial: {
        getBaseCanvas: () => null,
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
      turn("turn-2", "안녕하세요 밑에 가나다라라고 써 줘", currentRevision),
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
        text: "안녕하세요",
        recent: true,
      }),
    ]);
    expect(JSON.stringify(secondInput)).not.toContain(firstObject!.objectId);
    const secondTrace = composition.noteAgentProduction?.traces.getAll().at(-1);
    expect(secondTrace).toMatchObject({
      runtimeOwner: "note-agent-v2",
      decisionSchemaVersion: "phase5-one-decision-v1",
      decisionCallCount: 1,
      decisionStatus: "READY",
      decisionAction: "text.create",
      decisionReferenceHandle: "O1",
      decisionRelation: "BELOW",
      legacyPlannerInvoked: false,
      fuzzyObjectSelectorInvoked: false,
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

    currentRevision = 10;
    currentScene = projectScene(adapter, currentRevision);
    await expect(composition.noteAgentProduction?.execute(
      turn("turn-4", "안녕하새요 밑에 가나다라라고 써 줘", currentRevision),
    )).resolves.toMatchObject({ status: "COMMITTED" });
    expect(provider.references.at(-1)).toMatchObject({
      transcript: "안녕하새요 밑에 가나다라라고 써 줘",
      summary: "안녕하세요",
      relation: "BELOW",
    });

    currentRevision = 11;
    currentScene = projectScene(adapter, currentRevision);
    await expect(composition.noteAgentProduction?.execute(
      turn("turn-5", "방금 쓴 글 아래에 테스트라고 써 줘", currentRevision),
    )).resolves.toMatchObject({ status: "COMMITTED" });
    expect(provider.references.at(-1)).toMatchObject({
      transcript: "방금 쓴 글 아래에 테스트라고 써 줘",
      summary: "가나다라",
      recent: true,
      relation: "BELOW",
    });
    const afterRecent = adapter.getCurrentPageObjects();
    const recentAnchor = afterRecent.find((object) => object.text === "가나다라");
    const recentOutput = afterRecent.find((object) => object.createdByTurnId === "turn-5");
    expect(recentOutput!.bounds.y).toBeGreaterThanOrEqual(
      recentAnchor!.bounds.y + recentAnchor!.bounds.height,
    );

    currentRevision = 12;
    adapter.applyPreparedOperations({
      turnId: "case-d-fixture",
      operations: [{
        kind: "CREATE_TEXT",
        text: "반갑습니다",
        bounds: { x: 200, y: 300, width: 160, height: 40 },
      }],
    });
    currentScene = projectScene(adapter, currentRevision);

    currentRevision = 13;
    currentScene = projectScene(adapter, currentRevision);
    const rightResult = await composition.noteAgentProduction?.execute(
      turn("turn-7", "반갑습니다 오른쪽에 테스트라고 써 줘", currentRevision),
    );
    if (rightResult?.status !== "COMMITTED") {
      throw new Error(JSON.stringify({
        rightResult,
        trace: composition.noteAgentProduction?.traces.getAll().at(-1),
      }));
    }
    expect(provider.references.at(-1)).toMatchObject({
      transcript: "반갑습니다 오른쪽에 테스트라고 써 줘",
      summary: "반갑습니다",
      relation: "RIGHT_OF",
    });
    const afterRight = adapter.getCurrentPageObjects();
    const rightAnchor = afterRight.find((object) => object.text === "반갑습니다");
    const rightOutput = afterRight.find((object) => object.createdByTurnId === "turn-7");
    expect(rightOutput!.bounds.x).toBeGreaterThanOrEqual(
      rightAnchor!.bounds.x + rightAnchor!.bounds.width,
    );

    currentRevision = 14;
    currentScene = projectScene(adapter, currentRevision);
    const selected = currentScene.objects.find((object) =>
      object.source === "canvas" && object.kind === "text" && object.text === "반갑습니다");
    if (selected === undefined) throw new Error("Expected selectable tldraw text projection.");
    await expect(composition.noteAgentProduction?.execute(
      turn(
        "turn-8",
        "선택한 글 아래에 가나다라마바사라고 써 줘",
        currentRevision,
        selected.id,
      ),
    )).resolves.toMatchObject({ status: "COMMITTED" });
    expect(provider.references.at(-1)).toMatchObject({
      transcript: "선택한 글 아래에 가나다라마바사라고 써 줘",
      summary: "반갑습니다",
      selected: true,
      relation: "BELOW",
    });
    const selectedOutput = adapter.getCurrentPageObjects()
      .find((object) => object.createdByTurnId === "turn-8");
    expect(selectedOutput!.bounds.y).toBeGreaterThanOrEqual(
      rightAnchor!.bounds.y + rightAnchor!.bounds.height,
    );
    expect(legacyPlanner.plan).not.toHaveBeenCalled();
    expect(legacyTargetResolve).not.toHaveBeenCalled();

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
      expect.objectContaining({ handle: "O1", text: "안녕하세요" }),
      expect.objectContaining({ handle: "O2", text: "안녕하세요" }),
    ]);
    expect(adapter.getCurrentPageObjects()).toHaveLength(2);
    expect(composition.noteAgentProduction?.traces.getAll().at(-1)).toMatchObject({
      decisionCallCount: 1,
      commitAttempted: false,
      legacyPlannerInvoked: false,
      fuzzyObjectSelectorInvoked: false,
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
  public readonly references: Array<{
    readonly transcript: string;
    readonly summary: string;
    readonly recent: boolean;
    readonly selected: boolean;
    readonly relation: "BELOW" | "RIGHT_OF";
  }> = [];

  public decide(input: NoteDecisionInput) {
    this.decisionCallCount += 1;
    this.inputs.push(input);
    const sceneRevision = input.frozenContext.sceneRevision;
    const transcript = input.turn.rawFinalTranscript;
    if (transcript === "안녕하세요 써줘") {
      return Promise.resolve({
        status: "READY" as const,
        sceneRevision,
        steps: [{
          action: "text.create" as const,
          target: null,
          args: { text: "안녕하세요" },
          destination: null,
        }],
      });
    }
    if (transcript === "실행 취소") {
      return Promise.resolve({
        status: "READY" as const,
        sceneRevision,
        steps: [{ action: "history.undo" as const, target: null, args: {}, destination: null }],
      });
    }
    const reference = transcript.startsWith("방금 쓴 글")
      ? { summary: "가나다라", relation: "BELOW" as const, text: "테스트" }
      : transcript.startsWith("반갑습니다 오른쪽")
        ? { summary: "반갑습니다", relation: "RIGHT_OF" as const, text: "테스트" }
        : transcript.startsWith("선택한 글")
          ? { summary: "반갑습니다", relation: "BELOW" as const, text: "가나다라마바사" }
          : { summary: "안녕하세요", relation: "BELOW" as const, text: "가나다라" };
    const anchor = transcript.startsWith("선택한 글")
      ? input.objectCatalog.objects.find((object) => object.selected)
      : input.objectCatalog.objects.find((object) => object.text === reference.summary);
    if (anchor?.text === undefined) {
      throw new Error("Expected model-selected tldraw catalog anchor.");
    }
    this.references.push({
      transcript,
      summary: anchor.text,
      recent: anchor.recent,
      selected: anchor.selected,
      relation: reference.relation,
    });
    return Promise.resolve({
      status: "READY" as const,
      sceneRevision,
      steps: [{
        action: "text.create" as const,
        target: { object: anchor.handle, part: null },
        args: { text: reference.text },
        destination: {
          relation: reference.relation,
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

function turn(
  id: string,
  transcript: string,
  revision: number,
  selectedObjectId?: string,
): CompletedVoiceTurn {
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
      focusSource: selectedObjectId === undefined ? "page" : "selection",
      focusStale: false,
      capturedAt: 2,
      ...(selectedObjectId === undefined ? {} : { focusObjectId: selectedObjectId }),
    },
    focusSnapshot: {
      source: selectedObjectId === undefined ? "page" : "selection",
      capturedAt: 2,
      pageId: PAGE_ID,
      sceneRevision: revision,
      stale: false,
      ...(selectedObjectId === undefined ? {} : { objectId: selectedObjectId }),
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
