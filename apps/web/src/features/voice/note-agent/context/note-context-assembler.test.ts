import {
  buildSceneSnapshot,
  describeSceneObject,
  type GraphSceneObject,
  type ParagraphSceneObject,
  type SceneObject,
  type TextSceneObject,
  type WordSceneObject,
} from "@ggulnote/editor-core";
import { describe, expect, it, vi } from "vitest";
import type { CompletedVoiceTurn } from "../../domain";
import { ExistingWorldResolver, type FrozenWorldContext, type UnifiedObjectWorld } from "../world";
import type { NoteToolContext } from "../tools";
import { NoteContextAssembler } from "./note-context-assembler";

const OBJECT_ID = "persistent-object-secret";
const PART_ID = "persistent-curve-secret";

const graph: GraphSceneObject = {
  id: OBJECT_ID,
  pageId: "page-1",
  source: "canvas",
  sourceObjectId: "graph-1",
  kind: "graph",
  bounds: { x: 10, y: 20, width: 200, height: 120 },
  renderBounds: { x: 9, y: 19, width: 202, height: 122 },
  zIndex: 1,
  visible: true,
  locked: false,
  objectRevision: 1,
  createdAt: 10,
  updatedAt: 20,
  createdByTurnId: "turn-create",
  creationOrder: 3,
  expressions: [{ id: PART_ID, expression: "x^2" }],
  viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
  showAxes: true,
  showGrid: true,
};

const scene = buildSceneSnapshot({
  mode: "blank",
  page: { id: "page-1", index: 0, width: 600, height: 800 },
  sceneRevision: 7,
  canvasObjects: [graph],
});

function world(): UnifiedObjectWorld {
  const recent = Array.from({ length: 5 }, (_, index) => ({
    operationId: `operation-${index + 1}`,
    sourceTurnId: `turn-${index + 1}`,
    toolId: "graph.create",
    operation: "create",
    inputRefs: [],
    outputRefs: [{ kind: "OBJECT" as const, objectId: OBJECT_ID }],
    createdAt: 100 - index,
    undoGroupId: `undo-${index + 1}`,
  }));
  return {
    getSnapshot: (pageId, revision) =>
      pageId === "page-1" && revision === 7 ? scene : undefined,
    getObject: (objectId) => objectId === OBJECT_ID ? graph : undefined,
    getObjectMetadata: (objectId) =>
      objectId === OBJECT_ID ? describeSceneObject(graph, { documentId: "doc-1" }) : undefined,
    listPageObjects: (pageId) => pageId === "page-1" ? [graph] : [],
    searchIndex: () => [],
    getRecentOperations: () => recent,
    getRecentOperationOutputs: () => [{ kind: "OBJECT", objectId: OBJECT_ID }],
  };
}

function frozenWorld(): FrozenWorldContext {
  return {
    documentId: "doc-1",
    pageId: "page-1",
    sceneRevision: 7,
    frozenVoiceContext: {
      pageId: "page-1",
      sceneMode: "blank",
      sceneRevision: 7,
      focusSource: "selection",
      focusStale: false,
      capturedAt: 2,
    },
    catalog: {
      documentId: "doc-1",
      pageId: "page-1",
      sceneRevision: 7,
      candidates: [],
    },
    recentOperations: [],
    selection: { kind: "OBJECT", objectId: OBJECT_ID },
  };
}

function turn(): CompletedVoiceTurn {
  return {
    id: "turn-voice",
    providerId: "fake",
    providerSessionId: "session",
    language: "ko-KR",
    requestedAt: 1,
    startedAt: 2,
    completedAt: 4,
    state: "completed",
    rawTranscript: "  그래프를 선택해 줘  ",
    finalSegments: [{ id: "segment-1", index: 0, text: "그래프를 선택해 줘" }],
    frozenContext: frozenWorld().frozenVoiceContext,
    focusSnapshot: {
      source: "selection",
      capturedAt: 2,
      pageId: "page-1",
      sceneRevision: 7,
      objectId: OBJECT_ID,
      stale: false,
    },
    scene: {
      sceneRevisionAtSpeechStart: 7,
      pageIdAtSpeechStart: "page-1",
      currentSceneRevisionAtCompletion: 7,
      sceneChangedDuringTurn: false,
      pageChangedDuringTurn: false,
    },
    metrics: { interimUpdateCount: 0, finalSegmentCount: 1, providerRestartCount: 0 },
  };
}

function harness() {
  const objectWorld = world();
  const toolContext: NoteToolContext = {
    mode: "SHADOW",
    turnId: "turn-voice",
    frozenWorld: frozenWorld(),
    world: objectWorld,
    resolver: new ExistingWorldResolver({ world: objectWorld }),
    getCurrentSceneRevision: () => 7,
  };
  const loadActions = vi.fn(async () => [{
    id: "graph.inspect" as const,
    kind: "QUERY" as const,
    description: "Inspect a graph.",
    examples: ["첫 번째 그래프를 보여 줘"],
    input: { target: "EntitySelector" },
  }]);
  return {
    assembler: new NoteContextAssembler({ actionLoader: { loadActions } }),
    loadActions,
    objectWorld,
    toolContext,
  };
}

describe("NoteContextAssembler", () => {
  it("assembles always-on parts once in deterministic priority order", async () => {
    const { assembler, loadActions, objectWorld, toolContext } = harness();
    const result = await assembler.assemble({
      turn: turn(),
      documentId: "doc-1",
      frozenWorld: frozenWorld(),
      world: objectWorld,
      toolContext,
    });

    expect(result.parts.map((part) => part.id)).toEqual([
      "user-turn",
      "frozen-context",
      "object-catalog",
      "selection-focus",
      "recent-operations",
    ]);
    expect(loadActions).toHaveBeenCalledOnce();
    expect(result.decisionInput.turn.rawFinalTranscript).toBe("그래프를 선택해 줘");
    expect(result.decisionInput.availableTools).toHaveLength(1);
    expect(result.decisionInput.objectCatalog).toEqual({
      objects: [{
        handle: "O1",
        source: "tldraw",
        kind: "graph",
        summary: "x^2",
        bounds: {
          x: 10 / 600,
          y: 20 / 800,
          width: 200 / 600,
          height: 120 / 800,
        },
        capabilities: [
          "anchorable",
          "deletable",
          "editable",
          "movable",
          "partAddressable",
          "resizable",
        ],
        selected: true,
        focused: false,
        recent: true,
        parts: [{ kind: "curve", summary: "x^2" }],
      }],
      truncated: false,
    });
    expect(JSON.stringify(result.decisionInput)).not.toContain(OBJECT_ID);
    expect(JSON.stringify(result.decisionInput)).not.toContain(PART_ID);
    const recent = result.parts.find((part) => part.id === "recent-operations")?.content;
    expect(recent).toHaveLength(3);
    expect(result.parts.some((part) => part.id === "candidates")).toBe(false);
    expect(result.parts.some((part) => part.id === "screenshot-crop")).toBe(false);
  });

  it("keeps persistent object and part ids in a request-local handle map", async () => {
    const { assembler, objectWorld, toolContext } = harness();
    const result = await assembler.assemble({
      turn: turn(),
      documentId: "doc-1",
      frozenWorld: frozenWorld(),
      world: objectWorld,
      toolContext,
      detailHandles: ["selection"],
      candidates: [{
        handle: "candidate:C1",
        ref: { kind: "OBJECT", objectId: OBJECT_ID },
        kind: "graph",
        source: "USER_CANVAS",
        contentSummary: "x^2",
        bounds: graph.bounds,
        evidenceSummary: "same page and nearest",
      }],
      screenshotCrop: {
        handle: "crop:ambiguity-1",
        mimeType: "image/png",
        width: 240,
        height: 160,
        candidateHandles: ["candidate:S1"],
      },
    });

    expect(result.parts.map((part) => part.id)).toEqual([
      "user-turn",
      "frozen-context",
      "object-catalog",
      "selection-focus",
      "recent-operations",
      "object-detail",
      "candidates",
      "screenshot-crop",
    ]);
    expect(JSON.stringify(result.parts)).not.toContain(OBJECT_ID);
    expect(JSON.stringify(result.parts)).not.toContain(PART_ID);
    expect(JSON.stringify(result.decisionInput)).not.toContain(OBJECT_ID);
    expect(result.handles.resolve("selection")).toEqual({
      kind: "OBJECT",
      objectId: OBJECT_ID,
    });
    expect(result.handles.resolve("selection:part:1")).toMatchObject({
      kind: "OBJECT_PART",
      objectId: OBJECT_ID,
      partId: PART_ID,
    });
    expect(result.handles.resolve("candidate:C1")).toEqual({
      kind: "OBJECT",
      objectId: OBJECT_ID,
    });
  });

  it("creates a fresh request-local catalog handle map for every request", async () => {
    const { assembler, objectWorld, toolContext } = harness();
    const first = await assembler.assemble({
      turn: turn(), documentId: "doc-1", frozenWorld: frozenWorld(),
      world: objectWorld, toolContext,
    });
    const second = await assembler.assemble({
      turn: turn(), documentId: "doc-1", frozenWorld: frozenWorld(),
      world: objectWorld, toolContext,
    });

    expect(first.handles).not.toBe(second.handles);
    expect(first.handles.resolve("O1")).toEqual({ kind: "OBJECT", objectId: OBJECT_ID });
    expect(second.handles.resolve("O1")).toEqual({ kind: "OBJECT", objectId: OBJECT_ID });
  });

  it("includes every current-page user object but omits raw PDF words", async () => {
    const canvasObjects: TextSceneObject[] = Array.from({ length: 9 }, (_, index) => ({
      id: `canvas-secret-${index + 1}`,
      pageId: "page-mixed",
      source: "canvas",
      sourceObjectId: `shape-secret-${index + 1}`,
      kind: "text",
      bounds: { x: index * 20, y: 40, width: 100, height: 30 },
      zIndex: index,
      visible: true,
      locked: false,
      objectRevision: 1,
      text: `user text ${index + 1}`,
      style: { fontSize: 18 },
      createdAt: index + 1,
      updatedAt: index + 1,
    }));
    const paragraph: ParagraphSceneObject = {
      id: "pdf-paragraph-secret",
      pageId: "page-mixed",
      source: "pdf",
      sourceObjectId: "paragraph-internal-secret",
      kind: "paragraph",
      bounds: { x: 20, y: 200, width: 400, height: 80 },
      zIndex: 20,
      visible: true,
      locked: true,
      objectRevision: 1,
      text: "bounded paragraph",
      readingOrder: 1,
      childLineIds: ["line-secret"],
      regionId: "region-secret",
    };
    const word: WordSceneObject = {
      id: "pdf-word-secret",
      pageId: "page-mixed",
      source: "pdf",
      sourceObjectId: "word-internal-secret",
      kind: "word",
      bounds: { x: 20, y: 200, width: 60, height: 20 },
      zIndex: 21,
      visible: true,
      locked: true,
      objectRevision: 1,
      text: "raw-word-must-not-appear",
      readingOrder: 1,
      lineId: "line-secret",
      charOffsetStart: 0,
      charOffsetEnd: 7,
    };
    const objects: readonly SceneObject[] = [...canvasObjects, paragraph, word];
    const mixedScene = buildSceneSnapshot({
      mode: "pdf",
      page: { id: "page-mixed", index: 0, width: 600, height: 800 },
      sceneRevision: 11,
      pdfObjects: [paragraph, word],
      canvasObjects,
    });
    const mixedWorld: UnifiedObjectWorld = {
      getSnapshot: (pageId, revision) =>
        pageId === "page-mixed" && revision === 11 ? mixedScene : undefined,
      getObject: (objectId) => objects.find((object) => object.id === objectId),
      getObjectMetadata: (objectId) => {
        const object = objects.find((candidate) => candidate.id === objectId);
        return object === undefined ? undefined : describeSceneObject(object, { documentId: "doc-mixed" });
      },
      listPageObjects: () => objects,
      searchIndex: () => [],
      getRecentOperations: () => [],
      getRecentOperationOutputs: () => [],
    };
    const mixedFrozen: FrozenWorldContext = {
      documentId: "doc-mixed",
      pageId: "page-mixed",
      sceneRevision: 11,
      frozenVoiceContext: {
        pageId: "page-mixed",
        sceneMode: "pdf",
        sceneRevision: 11,
        focusSource: "none",
        focusStale: false,
        capturedAt: 2,
      },
      catalog: {
        documentId: "doc-mixed",
        pageId: "page-mixed",
        sceneRevision: 11,
        candidates: [],
      },
      recentOperations: [],
    };
    const mixedToolContext: NoteToolContext = {
      mode: "SHADOW",
      turnId: "turn-voice",
      frozenWorld: mixedFrozen,
      world: mixedWorld,
      resolver: new ExistingWorldResolver({ world: mixedWorld }),
      getCurrentSceneRevision: () => 11,
    };
    const assembler = new NoteContextAssembler({
      actionLoader: { loadActions: async () => [] },
    });
    const result = await assembler.assemble({
      turn: turn(),
      documentId: "doc-mixed",
      frozenWorld: mixedFrozen,
      world: mixedWorld,
      toolContext: mixedToolContext,
    });

    expect(result.decisionInput.objectCatalog.objects).toHaveLength(10);
    expect(result.decisionInput.objectCatalog.objects.filter((object) => object.source === "tldraw"))
      .toHaveLength(9);
    expect(result.decisionInput.objectCatalog.objects.at(-1)).toMatchObject({
      handle: "O10",
      source: "pdf",
      kind: "paragraph",
      summary: "bounded paragraph",
    });
    expect(JSON.stringify(result.decisionInput.objectCatalog)).not.toContain("raw-word-must-not-appear");
    expect(JSON.stringify(result.decisionInput.objectCatalog)).not.toContain("secret");
    expect(result.decisionInput.objectCatalog.truncated).toBe(false);
  });

  it("rejects action schemas that consume the configured context budget", async () => {
    const { objectWorld, toolContext } = harness();
    const assembler = new NoteContextAssembler({
      tokenBudget: 10,
      actionLoader: {
        loadActions: async () => [{
          id: "graph.inspect",
          kind: "QUERY",
          description: "A deliberately oversized action description.",
          input: { target: "EntitySelector" },
        }],
      },
    });
    await expect(assembler.assemble({
      turn: turn(),
      documentId: "doc-1",
      frozenWorld: frozenWorld(),
      world: objectWorld,
      toolContext,
    })).rejects.toThrow(/action schemas exceed context token budget/u);
  });
});
