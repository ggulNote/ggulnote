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
import { deserializeMathObject } from "@ggulnote/math-core";
import {
  HandwritingTextShapeUtil,
  MathObjectShapeUtil,
  NoteAnnotationShapeUtil,
  TldrawEditorAdapter,
  mathObjectShapeId,
} from "../../editor/adapters/tldraw";
import type { CompletedVoiceTurn } from "../domain";
import { FrozenTargetResolver } from "../application";
import type { DirectCommandPlannerProvider } from "../providers";
import type {
  NoteDecisionProvider,
  NoteDecisionInput,
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
  it("executes connected math placement and tangent actions on one logical graph shape", async () => {
    const { editor: tldrawEditor, adapter } = createTldrawAdapter();
    const editorEngine = new EditorEngine();
    editorEngine.setDocument("doc-sequential");
    editorEngine.setActivePage(PAGE_ID, PAGE_SIZE);
    let currentRevision = 7;
    let currentScene = projectScene(adapter, currentRevision);
    const provider = new MathSmokeDecisionProvider();
    const composition = createEditorDirectCommandComposition({
      editorEngine,
      clock: { now: () => toSessionTimeMs(100) },
      readCurrentGroundingSnapshot: () => ({ documentId: "doc-sequential", scene: currentScene }),
      getCurrentSceneRevision: () => currentRevision,
      getCurrentPage: () => 1,
      goToPage: () => undefined,
      getTldrawAdapter: () => adapter,
      noteAgent: { mode: "PRODUCTION", provider },
    });

    await expect(composition.noteAgentProduction?.execute(
      turn("math-turn-1", "x제곱 그래프 그려줘", currentRevision),
    )).resolves.toMatchObject({ status: "COMMITTED" });
    const createdGraph = adapter.getCurrentPageObjects().find((object) =>
      object.mathObjectKind === "graph");
    expect(createdGraph).toBeDefined();
    const graphLogicalId = createdGraph!.logicalObjectId!;
    const graphShapeId = mathObjectShapeId(graphLogicalId);
    expect(createdGraph?.objectId).toBe(graphShapeId);
    expect(tldrawEditor.getShape(graphShapeId)).toMatchObject({
      type: "ggulnote-math",
      props: { logicalObjectId: graphLogicalId, objectKind: "graph" },
    });
    expect(tldrawEditor.getCurrentPageShapes()).toHaveLength(1);
    expect(deserializeMathObject(createdGraph!.mathObjectSnapshot!)).toMatchObject({
      id: graphLogicalId,
      kind: "graph",
      style: { handDrawn: true },
      coordinateSystem: { showAxes: true, showGrid: false },
    });
    expect(createdGraph!.bounds.x).toBeGreaterThanOrEqual(24);
    expect(createdGraph!.bounds.y).toBeGreaterThanOrEqual(24);

    currentRevision += 1;
    currentScene = projectScene(adapter, currentRevision);
    await expect(composition.noteAgentProduction?.execute(
      turn("math-turn-2", "방금 만든 그래프에 점 하나 찍어줘", currentRevision),
    )).resolves.toMatchObject({ status: "COMMITTED" });
    const graphObjects = adapter.getCurrentPageObjects().filter((object) =>
      object.mathObjectKind === "graph");
    expect(graphObjects).toHaveLength(1);
    expect(graphObjects[0]?.objectId).toBe(graphShapeId);
    expect(graphObjects[0]?.logicalObjectId).toBe(graphLogicalId);
    expect(tldrawEditor.getCurrentPageShapes()).toHaveLength(1);
    expect(deserializeMathObject(graphObjects[0]!.mathObjectSnapshot!)).toMatchObject({
      id: graphLogicalId,
      kind: "graph",
      points: [{ position: { x: 1, y: 1 } }],
    });
    expect(provider.selectedGraphHandle).toBe("O1");
    expect(provider.inputs[1]?.objectCatalog.objects[0]).toMatchObject({
      handle: "O1",
      kind: "graph",
      summary: "y=x² graph",
      capabilities: expect.arrayContaining(["mathPointAddable"]),
      recent: true,
    });

    currentRevision += 1;
    currentScene = projectScene(adapter, currentRevision);
    await expect(composition.noteAgentProduction?.execute(
      turn("math-turn-tangent", "x제곱 그래프 2사분면 쪽에 접선 하나 그어줘", currentRevision),
    )).resolves.toMatchObject({ status: "COMMITTED" });
    const tangentGraph = adapter.getCurrentPageObjects().find((object) =>
      object.logicalObjectId === graphLogicalId);
    const tangentObject = deserializeMathObject(tangentGraph!.mathObjectSnapshot!);
    expect(tangentObject).toMatchObject({
      kind: "graph",
      tangents: [{ point: { x: expect.any(Number), y: expect.any(Number) }, slope: expect.any(Number) }],
    });
    if (tangentObject.kind !== "graph") throw new Error("Expected graph tangent result.");
    expect(tangentObject.tangents[0]!.point.x).toBeLessThan(0);
    expect(tangentObject.tangents[0]!.point.y).toBeGreaterThan(0);
    expect(tangentObject.tangents[0]!.slope).toBeLessThan(0);
    expect(tldrawEditor.getCurrentPageShapes()).toHaveLength(1);

    currentRevision += 1;
    currentScene = projectScene(adapter, currentRevision);
    await expect(composition.noteAgentProduction?.execute(
      turn("math-turn-3", "58 곱하기 72 세로셈으로 써줘", currentRevision),
    )).resolves.toMatchObject({ status: "COMMITTED" });
    const arithmetic = adapter.getCurrentPageObjects().find((object) =>
      object.mathObjectKind === "arithmetic_layout");
    expect(deserializeMathObject(arithmetic!.mathObjectSnapshot!)).toMatchObject({
      kind: "arithmetic_layout",
      arithmeticType: "multiply",
      operands: ["58", "72"],
      rows: [
        { rowType: "operand" },
        { rowType: "operand", operator: "×" },
        { rowType: "partial", cells: [] },
      ],
      separators: [{ lineStyle: "solid" }],
    });

    currentRevision += 1;
    currentScene = projectScene(adapter, currentRevision);
    await expect(composition.noteAgentProduction?.execute(
      turn("math-turn-4", "직사각형 하나 그려줘", currentRevision),
    )).resolves.toMatchObject({ status: "COMMITTED" });
    const rectangle = adapter.getCurrentPageObjects().find((object) =>
      object.mathObjectKind === "shape");
    expect(deserializeMathObject(rectangle!.mathObjectSnapshot!)).toMatchObject({
      kind: "shape",
      shapeType: "rectangle",
      preset: "rectangle",
      geometry: { kind: "polygon" },
    });

    currentRevision += 1;
    currentScene = projectScene(adapter, currentRevision);
    await expect(composition.noteAgentProduction?.execute(
      turn("math-turn-5", "x제곱 그래프 밑에 x제곱 더하기 2x 더하기 1이라고 써줘", currentRevision),
    )).resolves.toMatchObject({ status: "COMMITTED" });
    const expression = adapter.getCurrentPageObjects().find((object) =>
      object.mathObjectKind === "expression");
    expect(deserializeMathObject(expression!.mathObjectSnapshot!)).toMatchObject({
      kind: "expression",
      content: { source: "x² + 2x + 1", format: "plain" },
    });
    expect(expression!.bounds.y).toBeGreaterThanOrEqual(
      tangentGraph!.bounds.y + tangentGraph!.bounds.height + 16,
    );
    expect(adapter.getCurrentPageObjects().filter((object) => object.kind === "math"))
      .toHaveLength(4);
    expect(provider.inputs).toHaveLength(6);

    composition.dispose();
    tldrawEditor.dispose();
    editorEngine.destroy();
  });

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
              placement: { x: 0.1, y: 0.1, width: null, height: null },
            }],
          },
          telemetry: {
            openaiTtfbMs: 3179.7819,
            openaiBodyReadMs: 94.5279,
            decisionJsonParseMs: 0.1791,
            inputTokens: 8011,
            cachedInputTokens: 8008,
            outputTokens: 58,
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
            placement: { x: 0.1, y: 0.25, width: null, height: null },
          }],
        },
      });
    });
    const legacyPlanner: DirectCommandPlannerProvider = {
      plan: vi.fn(() => Promise.reject(new Error("Legacy planner must not run."))),
    };
    const placementJudge = {
      judge: vi.fn(() => Promise.reject(new Error("Placement VLM must not run."))),
    };
    const mountPreviewCanvas = vi.fn(() => () => undefined);
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
        mountPreviewCanvas,
        placementJudge,
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
    const firstObject = adapter.getCurrentPageObjects()[0];
    expect(firstObject).toMatchObject({ kind: "text", text: "안녕하세요" });
    expect(firstObject!.bounds.x).toBeGreaterThanOrEqual(24);
    expect(firstObject!.bounds.y).toBeGreaterThanOrEqual(24);
    expect(composition.noteAgentProduction?.traces.getAll().at(-1)).toMatchObject({
      decisionStatus: "READY",
      decisionAction: "text.create",
      resultStatus: "SUCCESS",
      commitAttempted: true,
      visualCallCount: 0,
      openaiTtfbMs: 3179.7819,
      outputTokens: 58,
    });
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
    expect(placementJudge.judge).not.toHaveBeenCalled();
    expect(mountPreviewCanvas).not.toHaveBeenCalled();
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
      objects[0]!.bounds.y + objects[0]!.bounds.height + 16,
    );
    expect(composition.noteAgentProduction?.traces.getAll().at(-1)).toMatchObject({
      runtimeOwner: "note-agent-v2",
      catalogHandles: ["O1"],
      decisionStatus: "READY",
      decisionAction: "text.create",
      decisionPlacement: {
        x: expect.any(Number),
        y: expect.any(Number),
        width: null,
        height: null,
      },
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
    expect(firstObject!.bounds.x).toBeGreaterThanOrEqual(24);
    expect(firstObject!.bounds.y).toBeGreaterThanOrEqual(24);

    currentRevision = 8;
    currentScene = projectScene(adapter, currentRevision);
    await expect(composition.noteAgentProduction?.execute(
      turn("turn-2", "안녕하세요 밑에 가나다라라고 써 줘", currentRevision),
    )).resolves.toMatchObject({ status: "COMMITTED" });
    const afterSecond = adapter.getCurrentPageObjects();
    expect(afterSecond).toHaveLength(2);
    expect(afterSecond[1]).toMatchObject({ kind: "text", text: "가나다라" });
    expect(afterSecond[1]!.bounds.y).toBeGreaterThanOrEqual(
      firstObject!.bounds.y + firstObject!.bounds.height + 16,
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
      decisionSchemaVersion: "multimodal-final-placement-v2",
      decisionCallCount: 1,
      decisionStatus: "READY",
      decisionAction: "text.create",
      decisionPlacement: {
        x: expect.any(Number),
        y: expect.any(Number),
        width: 0.25,
        height: null,
      },
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

    currentRevision = 10;
    currentScene = projectScene(adapter, currentRevision);
    await expect(composition.noteAgentProduction?.execute(
      turn("turn-4", "안녕하새요 밑에 가나다라라고 써 줘", currentRevision),
    )).resolves.toMatchObject({ status: "COMMITTED" });
    expect(provider.references.at(-1)).toMatchObject({
      transcript: "안녕하새요 밑에 가나다라라고 써 줘",
      summary: "안녕하세요",
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
    });
    const afterRecent = adapter.getCurrentPageObjects();
    const recentAnchor = afterRecent.find((object) => object.text === "가나다라");
    const recentOutput = afterRecent.find((object) => object.createdByTurnId === "turn-5");
    expect(recentOutput!.bounds.y).toBeGreaterThanOrEqual(
      recentAnchor!.bounds.y + recentAnchor!.bounds.height + 16,
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
    });
    const afterRight = adapter.getCurrentPageObjects();
    const rightAnchor = afterRight.find((object) => object.text === "반갑습니다");
    const rightOutput = afterRight.find((object) => object.createdByTurnId === "turn-7");
    expect(rightOutput!.bounds.x).toBeCloseTo(
      rightAnchor!.bounds.x + rightAnchor!.bounds.width + 16,
      8,
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
    });
    const selectedOutput = adapter.getCurrentPageObjects()
      .find((object) => object.createdByTurnId === "turn-8");
    expect(selectedOutput!.bounds.y).toBeGreaterThanOrEqual(
      rightAnchor!.bounds.y + rightAnchor!.bounds.height + 16,
    );
    expect(legacyPlanner.plan).not.toHaveBeenCalled();
    expect(legacyTargetResolve).not.toHaveBeenCalled();

    composition.dispose();
    tldrawEditor.dispose();
    editorEngine.destroy();
  });

  it("keeps repeated final-placement text creation deterministic past the visual threshold", async () => {
    const { editor: tldrawEditor, adapter } = createTldrawAdapter();
    installBrowserCanvas();
    const editorEngine = new EditorEngine();
    editorEngine.setDocument("doc-sequential");
    editorEngine.setActivePage(PAGE_ID, PAGE_SIZE);
    let revision = 7;
    let scene = projectScene(adapter, revision);
    const mountPreviewCanvas = vi.fn(() => () => undefined);
    const provider = new SequentialDecisionProvider();
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
        mountPreviewCanvas,
      },
      noteAgent: { mode: "PRODUCTION", provider },
    });

    for (let index = 0; index < 6; index += 1) {
      await expect(composition.noteAgentProduction?.execute(
        turn(`turn-repeat-${index + 1}`, "안녕하세요 써줘", revision),
      )).resolves.toMatchObject({ status: "COMMITTED" });
      revision += 1;
      scene = projectScene(adapter, revision);
    }

    expect(adapter.getCurrentPageObjects()).toHaveLength(6);
    expect(adapter.getCurrentPageObjects().map((object) => object.text))
      .toEqual(Array.from({ length: 6 }, () => "안녕하세요"));
    expect(mountPreviewCanvas).not.toHaveBeenCalled();
    expect(composition.noteAgentProduction?.traces.getAll().at(-1)).toMatchObject({
      resultStatus: "SUCCESS",
      commitAttempted: true,
      visualCallCount: 0,
    });

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
    const provider: NoteDecisionProvider = {
      decide: (input) => {
        decisionInput = input;
        return Promise.resolve({
          status: "NEEDS_CLARIFICATION",
          sceneRevision: revision,
          reason: "AMBIGUOUS_OBJECT",
        });
      },
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

class SequentialDecisionProvider implements NoteDecisionProvider {
  public decisionCallCount = 0;
  public readonly inputs: NoteDecisionInput[] = [];
  public readonly references: Array<{
    readonly transcript: string;
    readonly summary: string;
    readonly recent: boolean;
    readonly selected: boolean;
    readonly placement: { readonly x: number; readonly y: number };
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
          placement: { x: 0.1, y: 0.1, width: null, height: null },
        }],
      });
    }
    if (transcript === "실행 취소") {
      return Promise.resolve({
        status: "READY" as const,
        sceneRevision,
        steps: [{ action: "history.undo" as const, target: null, args: {} }],
      });
    }
    const reference = transcript.startsWith("방금 쓴 글")
      ? { summary: "가나다라", text: "테스트" }
      : transcript.startsWith("반갑습니다 오른쪽")
        ? { summary: "반갑습니다", text: "테스트" }
        : transcript.startsWith("선택한 글")
          ? { summary: "반갑습니다", text: "가나다라마바사" }
          : { summary: "안녕하세요", text: "가나다라" };
    const anchor = transcript.startsWith("선택한 글")
      ? input.objectCatalog.objects.find((object) => object.selected)
      : input.objectCatalog.objects.find((object) => object.text === reference.summary);
    if (anchor?.text === undefined) {
      throw new Error("Expected model-selected tldraw catalog anchor.");
    }
    const placement = transcript.startsWith("반갑습니다 오른쪽")
      ? {
          x: Math.min(0.9, anchor.bounds.x + anchor.bounds.width + 16 / PAGE_SIZE.width),
          y: anchor.bounds.y,
        }
      : {
          x: anchor.bounds.x,
          y: Math.min(0.9, anchor.bounds.y + anchor.bounds.height + 16 / PAGE_SIZE.height),
        };
    this.references.push({
      transcript,
      summary: anchor.text,
      recent: anchor.recent,
      selected: anchor.selected,
      placement,
    });
    return Promise.resolve({
      status: "READY" as const,
      sceneRevision,
      steps: [{
        action: "text.create" as const,
        target: null,
        args: { text: reference.text },
        placement: { ...placement, width: 0.25, height: null },
      }],
    });
  }

}

class MathSmokeDecisionProvider implements NoteDecisionProvider {
  public readonly inputs: NoteDecisionInput[] = [];
  public selectedGraphHandle: string | undefined;

  public decide(input: NoteDecisionInput) {
    this.inputs.push(input);
    const sceneRevision = input.frozenContext.sceneRevision;
    switch (input.turn.rawFinalTranscript) {
      case "x제곱 그래프 그려줘":
        return Promise.resolve({
          status: "READY" as const,
          sceneRevision,
          steps: [{
            action: "math.graph.create" as const,
            target: null,
            args: { expression: "y=x²" },
            placement: { x: 0.1, y: 0.1, width: 0.4, height: 0.3 },
          }],
        });
      case "방금 만든 그래프에 점 하나 찍어줘": {
        const graph = input.objectCatalog.objects.find((object) =>
          object.kind === "graph" && object.recent);
        if (graph === undefined) throw new Error("Expected the recent graph in Object Catalog.");
        this.selectedGraphHandle = graph.handle;
        return Promise.resolve({
          status: "READY" as const,
          sceneRevision,
          steps: [{
            action: "math.graph.add_point" as const,
            target: { object: graph.handle, part: null },
            args: { point: { x: 1, y: 1 }, label: null },
          }],
        });
      }
      case "x제곱 그래프 2사분면 쪽에 접선 하나 그어줘": {
        const graph = input.objectCatalog.objects.find((object) => object.kind === "graph");
        if (graph === undefined) throw new Error("Expected graph tangent target.");
        return Promise.resolve({
          status: "READY" as const,
          sceneRevision,
          steps: [{
            action: "math.graph.add_tangent" as const,
            target: {
              object: graph.handle,
              part: null,
            },
            args: { at: { x: -1 }, label: null },
          }],
        });
      }
      case "58 곱하기 72 세로셈으로 써줘":
        return Promise.resolve({
          status: "READY" as const,
          sceneRevision,
          steps: [{
            action: "math.arithmetic.setup_vertical_multiply" as const,
            target: null,
            args: { operands: ["58", "72"] },
            placement: { x: 0.55, y: 0.1, width: 0.3, height: 0.25 },
          }],
        });
      case "직사각형 하나 그려줘":
        return Promise.resolve({
          status: "READY" as const,
          sceneRevision,
          steps: [{
            action: "math.shape.create_rectangle" as const,
            target: null,
            args: {},
            placement: { x: 0.55, y: 0.45, width: 0.3, height: 0.25 },
          }],
        });
      case "x제곱 그래프 밑에 x제곱 더하기 2x 더하기 1이라고 써줘": {
        const graph = input.objectCatalog.objects.find((object) => object.kind === "graph");
        if (graph === undefined) throw new Error("Expected graph placement anchor.");
        return Promise.resolve({
          status: "READY" as const,
          sceneRevision,
          steps: [{
            action: "math.expression.create" as const,
            target: null,
            args: { source: "x² + 2x + 1" },
            placement: { x: 0.1, y: 0.45, width: 0.4, height: 0.08 },
          }],
        });
      }
      default:
        throw new Error(`Unexpected math smoke transcript: ${input.turn.rawFinalTranscript}`);
    }
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
    tldrawObjects: adapter.getCurrentPageObjects(),
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
    MathObjectShapeUtil,
    HandwritingTextShapeUtil,
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
