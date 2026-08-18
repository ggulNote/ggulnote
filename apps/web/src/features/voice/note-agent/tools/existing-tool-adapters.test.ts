import {
  buildSceneSnapshot,
  describeSceneObject,
  type ParagraphSceneObject,
  type PdfSceneObject,
  type TextSceneObject,
  type WordSceneObject,
} from "@ggulnote/editor-core";
import { PageSemanticModel, type PageSemanticModelData } from "@ggulnote/document-core";
import { describe, expect, it, vi } from "vitest";
import type { FrozenVoiceTurnContext, PageTargetCatalog } from "../../domain";
import {
  NoteObjectHandleMap,
} from "../context";
import {
  ExistingWorldResolver,
  RebuildableObjectIndex,
  type FrozenWorldContext,
  type UnifiedObjectWorld,
} from "../world";
import { createExistingNoteToolRegistry } from "./existing-tool-adapters";
import type { NoteToolContext } from "./note-tool-registry";

const PDF: ParagraphSceneObject = {
  id: "pdf-paragraph",
  pageId: "page-1",
  source: "pdf",
  kind: "paragraph",
  bounds: { x: 20, y: 20, width: 300, height: 80 },
  renderBounds: { x: 19, y: 19, width: 302, height: 82 },
  zIndex: 0,
  visible: true,
  locked: true,
  objectRevision: 1,
  sourceObjectId: "paragraph-1",
  text: "PDF immutable text",
  readingOrder: 1,
  childLineIds: [],
  regionId: "region-1",
};

const USER_TEXT: TextSceneObject = {
  id: "canvas-text",
  pageId: "page-1",
  source: "canvas",
  kind: "text",
  bounds: { x: 20, y: 150, width: 160, height: 40 },
  zIndex: 1,
  visible: true,
  locked: false,
  objectRevision: 1,
  sourceObjectId: "text-1",
  text: "내가 쓴 안녕하세요",
  style: { fontSize: 14 },
  createdAt: 10,
  updatedAt: 10,
  creationOrder: 1,
};

function context(options: {
  readonly pdfObjects?: readonly PdfSceneObject[];
  readonly semanticModel?: PageSemanticModel;
} = {}): NoteToolContext {
  const scene = buildSceneSnapshot({
    mode: "pdf",
    page: { id: "page-1", index: 0, width: 600, height: 800 },
    sceneRevision: 7,
    pdfObjects: options.pdfObjects ?? [PDF],
    canvasObjects: [USER_TEXT],
  });
  const index = new RebuildableObjectIndex();
  index.rebuild("doc-1", scene);
  const world: UnifiedObjectWorld = {
    getSnapshot: (pageId, revision) =>
      pageId === "page-1" && revision === 7 ? scene : undefined,
    getObject: (id) => scene.objectById[id],
    getObjectMetadata: (id) => {
      const object = scene.objectById[id];
      return object === undefined ? undefined : describeSceneObject(object, { documentId: "doc-1" });
    },
    listPageObjects: () => scene.objects,
    searchIndex: (query) => index.search(query),
    getRecentOperationOutputs: () => [],
  };
  const frozenVoiceContext: FrozenVoiceTurnContext = {
    pageId: "page-1",
    sceneMode: "pdf",
    sceneRevision: 7,
    focusSource: "none",
    focusStale: false,
    capturedAt: 1,
  };
  const catalog: PageTargetCatalog = {
    documentId: "doc-1",
    pageId: "page-1",
    sceneRevision: 7,
    candidates: [],
    ...(options.semanticModel === undefined ? {} : { semanticModel: options.semanticModel }),
  };
  const frozenWorld: FrozenWorldContext = {
    documentId: "doc-1",
    pageId: "page-1",
    sceneRevision: 7,
    frozenVoiceContext,
    catalog,
    recentOperations: [],
  };
  return {
    mode: "SHADOW",
    turnId: "turn-1",
    frozenWorld,
    world,
    resolver: new ExistingWorldResolver({ world }),
    getCurrentSceneRevision: () => 7,
  };
}

describe("existing NoteTool adapters", () => {
  it("registers only supported adapters and gates placement-dependent create", () => {
    const registry = createExistingNoteToolRegistry();
    expect(registry.get("text.create")).toBeDefined();
    expect(registry.get("text.replace")).toBeDefined();
    expect(registry.get("annotation.apply")).toBeDefined();
    expect(registry.get("navigation.next_page")).toBeDefined();
    expect(registry.get("navigation.previous_page")).toBeDefined();
    expect(registry.get("history.undo")).toBeDefined();
    expect(registry.get("object.delete")).toBeUndefined();
    expect(registry.get("annotation.apply")?.description)
      .toContain("ground across all supplied object text first");
    expect(registry.compactSchemas(context()).map((tool) => tool.id))
      .not.toContain("text.create");
  });

  it("allows editable user text but refuses immutable PDF replacement", async () => {
    const registry = createExistingNoteToolRegistry();
    const tool = registry.get("text.replace");
    if (tool === undefined) throw new Error("Expected text.replace adapter.");
    const toolContext = context();
    const userInput = tool.inputSchema.parse({
      target: { source: "USER_CREATED", content: { text: "안녕하세요" } },
      text: "수정됨",
    });
    await expect(tool.prepare(userInput, toolContext)).resolves
      .toMatchObject({ status: "READY", operations: [{ kind: "EXISTING_EDITOR_OPERATION" }] });
    const pdfInput = tool.inputSchema.parse({
      target: { source: "PDF_BASE", content: { text: "PDF immutable text" } },
      text: "수정 시도",
    });
    await expect(tool.prepare(pdfInput, toolContext)).resolves.toEqual({
      status: "NOT_ALLOWED",
      reasonCode: "TARGET_NOT_EDITABLE",
    });
  });

  it("resolves a model-selected user object handle without primary/fuzzy resolution", async () => {
    const registry = createExistingNoteToolRegistry();
    const tool = registry.get("text.replace");
    if (tool === undefined) throw new Error("Expected text.replace adapter.");
    const base = context();
    const primaryResolve = vi.spyOn(base.resolver, "resolve");
    const handles = new NoteObjectHandleMap();
    handles.register("O1", { kind: "OBJECT", objectId: USER_TEXT.id });
    const input = tool.inputSchema.parse({
      target: { object: "O1", part: null },
      text: "수정됨",
    });

    await expect(tool.prepare(input, { ...base, handles })).resolves.toMatchObject({
      status: "READY",
      operations: [{
        kind: "EXISTING_EDITOR_OPERATION",
        data: {
          tldrawOperation: {
            kind: "REPLACE_TEXT",
            objectId: USER_TEXT.sourceObjectId,
            text: "수정됨",
          },
        },
      }],
    });
    expect(primaryResolve).not.toHaveBeenCalled();
  });

  it("returns INVALID_HANDLE and zero prepared operations for an unknown handle", async () => {
    const registry = createExistingNoteToolRegistry();
    const tool = registry.get("text.replace");
    if (tool === undefined) throw new Error("Expected text.replace adapter.");
    const base = context();
    const primaryResolve = vi.spyOn(base.resolver, "resolve");
    const input = tool.inputSchema.parse({
      target: { object: "O99", part: null },
      text: "수정 시도",
    });

    await expect(tool.prepare(input, {
      ...base,
      handles: new NoteObjectHandleMap(),
    })).resolves.toEqual({ status: "FAILED", reasonCode: "INVALID_HANDLE" });
    expect(primaryResolve).not.toHaveBeenCalled();
  });

  it.each([
    ["UNDERLINE", "underline"],
    ["HIGHLIGHT", "highlight"],
  ] as const)("aligns a selected PDF text range for %s inside that paragraph only", async (
    annotationType,
    preparedAnnotationType,
  ) => {
    const selectedParagraph: ParagraphSceneObject = {
      ...PDF,
      text: `${"canonical context ".repeat(14)}rendering HTML into visual webpages`,
    };
    expect(selectedParagraph.text.indexOf("rendering HTML")).toBeGreaterThan(160);
    const otherParagraph: ParagraphSceneObject = {
      ...PDF,
      id: "pdf-paragraph-2",
      sourceObjectId: "paragraph-2",
      bounds: { x: 20, y: 420, width: 300, height: 80 },
      renderBounds: { x: 19, y: 419, width: 302, height: 82 },
      readingOrder: 2,
    };
    const base = context({
      pdfObjects: [selectedParagraph, ...duplicatePdfSceneWords(), otherParagraph],
      semanticModel: duplicatePdfRangeModel(),
    });
    const primaryResolve = vi.spyOn(base.resolver, "resolve");
    const handles = new NoteObjectHandleMap();
    handles.register("O21", { kind: "OBJECT", objectId: PDF.id });
    const tool = createExistingNoteToolRegistry().get("annotation.apply");
    if (tool === undefined) throw new Error("Expected annotation.apply adapter.");
    const input = tool.inputSchema.parse({
      target: {
        object: "O21",
        part: {
          kind: "text_range",
          index: null,
          row: null,
          column: null,
          text: null,
          startText: "rendering HTML",
          endText: "visual webpages",
        },
      },
      annotationType,
    });

    const result = await tool.prepare(input, { ...base, handles });
    expect(result).toMatchObject({
      status: "READY",
      operations: [{
        data: {
          tldrawOperation: {
            kind: "CREATE_ANNOTATION",
            annotationType: preparedAnnotationType,
            targetObjectIds: [PDF.id],
          },
        },
      }],
    });
    if (result.status !== "READY") throw new Error("Expected prepared PDF annotation.");
    const operation = result.operations[0]?.data as {
      readonly tldrawOperation?: { readonly rects?: readonly { readonly y: number }[] };
    };
    expect(operation.tldrawOperation?.rects).not.toHaveLength(0);
    expect(operation.tldrawOperation?.rects?.every((rect) => rect.y < 200)).toBe(true);
    expect(primaryResolve).not.toHaveBeenCalled();
  });

  it("keeps whole-object PDF annotation available with part null", async () => {
    const base = context();
    const handles = new NoteObjectHandleMap();
    handles.register("O12", { kind: "OBJECT", objectId: PDF.id });
    const tool = createExistingNoteToolRegistry().get("annotation.apply");
    if (tool === undefined) throw new Error("Expected annotation.apply adapter.");

    const result = await tool.prepare(tool.inputSchema.parse({
      target: { object: "O12", part: null },
      annotationType: "UNDERLINE",
      color: null,
    }), { ...base, handles });

    expect(result).toMatchObject({
      status: "READY",
      operations: [{
        data: {
          tldrawOperation: {
            kind: "CREATE_ANNOTATION",
            annotationType: "underline",
            rects: [PDF.renderBounds],
          },
        },
      }],
    });
  });

  it("does not fall back to whole-object annotation when text-range anchors fail", async () => {
    const base = context({
      pdfObjects: [PDF, ...duplicatePdfSceneWords()],
      semanticModel: duplicatePdfRangeModel(),
    });
    const handles = new NoteObjectHandleMap();
    handles.register("O12", { kind: "OBJECT", objectId: PDF.id });
    const tool = createExistingNoteToolRegistry().get("annotation.apply");
    if (tool === undefined) throw new Error("Expected annotation.apply adapter.");

    const result = await tool.prepare(tool.inputSchema.parse({
      target: {
        object: "O12",
        part: {
          kind: "text_range",
          index: null,
          row: null,
          column: null,
          text: null,
          startText: "missing start anchor",
          endText: "missing end anchor",
        },
      },
      annotationType: "UNDERLINE",
      color: null,
    }), { ...base, handles });

    expect(result.status).not.toBe("READY");
  });
});

function duplicatePdfRangeModel(): PageSemanticModel {
  const firstWords = [
    semanticWord("word-0", "context".repeat(24), "line-1", 1, 0.02, 0.04),
    semanticWord("word-1", "rendering", "line-1", 2, 0.12, 0.04),
    semanticWord("word-2", "HTML", "line-1", 3, 0.22, 0.04),
    semanticWord("word-3", "into", "line-1", 4, 0.30, 0.04),
    semanticWord("word-4", "visual", "line-1", 5, 0.38, 0.04),
    semanticWord("word-5", "webpages", "line-1", 6, 0.47, 0.04),
  ];
  const secondWords = [
    semanticWord("word-6", "rendering", "line-2", 7, 0.12, 0.54),
    semanticWord("word-7", "HTML", "line-2", 8, 0.22, 0.54),
    semanticWord("word-8", "into", "line-2", 9, 0.30, 0.54),
    semanticWord("word-9", "visual", "line-2", 10, 0.38, 0.54),
    semanticWord("word-10", "webpages", "line-2", 11, 0.47, 0.54),
  ];
  const words = [...firstWords, ...secondWords];
  return new PageSemanticModel({
    schemaVersion: 1,
    extractorVersion: "selected-pdf-range-test",
    documentId: "doc-1",
    pageId: "page-1",
    pageNumber: 1,
    sourceSignature: "selected-pdf-range-test",
    semanticSource: "legacy-semantic-fallback",
    readingOrder: words.map((word) => word.id),
    words,
    unassignedWords: [],
    lines: [
      semanticLine("line-1", "paragraph-1", firstWords.map((word) => word.id), 1, 0.04),
      semanticLine("line-2", "paragraph-2", secondWords.map((word) => word.id), 2, 0.54),
    ],
    layoutRegions: [],
    layoutBlocks: [],
    columns: [],
    sentences: [],
    paragraphs: [
      semanticParagraph("paragraph-1", "line-1", 1, 0.04),
      semanticParagraph("paragraph-2", "line-2", 2, 0.54),
    ],
    createdAt: 1,
    sourceItemCount: 6,
    processingDurationMs: 0,
  });
}

function duplicatePdfSceneWords(): readonly WordSceneObject[] {
  return [
    pdfWord("word-0", "context".repeat(24), "line-1", 1, 12, 32),
    pdfWord("word-1", "rendering", "line-1", 2, 72, 32),
    pdfWord("word-2", "HTML", "line-1", 3, 132, 32),
    pdfWord("word-3", "into", "line-1", 4, 192, 32),
    pdfWord("word-4", "visual", "line-1", 5, 252, 32),
    pdfWord("word-5", "webpages", "line-1", 6, 312, 32),
    pdfWord("word-6", "rendering", "line-2", 7, 72, 432),
    pdfWord("word-7", "HTML", "line-2", 8, 132, 432),
    pdfWord("word-8", "into", "line-2", 9, 192, 432),
    pdfWord("word-9", "visual", "line-2", 10, 252, 432),
    pdfWord("word-10", "webpages", "line-2", 11, 312, 432),
  ];
}

function pdfWord(
  sourceObjectId: string,
  text: string,
  lineId: string,
  readingOrder: number,
  x: number,
  y: number,
): WordSceneObject {
  return {
    id: `pdf-${sourceObjectId}`,
    pageId: "page-1",
    source: "pdf",
    kind: "word",
    bounds: { x, y, width: 54, height: 24 },
    zIndex: readingOrder,
    visible: true,
    locked: true,
    objectRevision: 1,
    sourceObjectId,
    text,
    readingOrder,
    lineId,
    charOffsetStart: 0,
    charOffsetEnd: text.length,
  };
}

function semanticWord(
  id: string,
  text: string,
  lineId: string,
  readingOrder: number,
  x: number,
  y: number,
): PageSemanticModelData["words"][number] {
  return {
    id,
    type: "WORD",
    pageId: "page-1",
    text,
    normalizedText: text.toLocaleLowerCase("en-US"),
    bounds: { x, y, width: 0.09, height: 0.03 },
    readingOrder,
    confidence: 1,
    orientation: { angle: 0, writingMode: "horizontal" },
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    sourceItemIds: [`source-${id}`],
    sourceRanges: [{ sourceTextItemId: `source-${id}`, startOffset: 0, endOffset: text.length }],
    lineId,
    direction: "ltr",
    startsWithPunctuation: false,
    endsWithPunctuation: false,
    hasEOL: text === "webpages",
    axis: { advanceX: 8, advanceY: 0, normalX: 0, normalY: 1 },
    quad: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
  };
}

function semanticLine(
  id: string,
  paragraphId: string,
  wordIds: readonly string[],
  readingOrder: number,
  y: number,
): PageSemanticModelData["lines"][number] {
  return {
    id,
    type: "LINE",
    pageId: "page-1",
    text: "Vision capability browsers",
    normalizedText: "vision capability browsers",
    bounds: { x: 0.04, y, width: 0.38, height: 0.03 },
    readingOrder,
    confidence: 1,
    orientation: { angle: 0, writingMode: "horizontal" },
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    wordIds: [...wordIds],
    paragraphId,
    baseline: y + 0.03,
    direction: "ltr",
    columnIndex: 0,
    axis: { advanceX: 8, advanceY: 0, normalX: 0, normalY: 1 },
    horizontalGaps: [],
  };
}

function semanticParagraph(
  id: string,
  lineId: string,
  readingOrder: number,
  y: number,
): PageSemanticModelData["paragraphs"][number] {
  return {
    id,
    type: "PARAGRAPH",
    pageId: "page-1",
    text: "Vision capability browsers",
    normalizedText: "vision capability browsers",
    bounds: { x: 0.03, y: y - 0.01, width: 0.4, height: 0.05 },
    readingOrder,
    confidence: 1,
    orientation: { angle: 0, writingMode: "horizontal" },
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    lineIds: [lineId],
    sentenceIds: [],
    columnIndex: 0,
    averageFontSize: 12,
    fragments: [{ x: 0.03, y: y - 0.01, width: 0.4, height: 0.05 }],
  };
}
