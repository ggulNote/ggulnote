import {
  buildSceneSnapshot,
  type CanvasSceneObject,
  type EditorOperation,
  type PdfSceneObject,
} from "@ggulnote/editor-core";
import { PageSemanticModel } from "@ggulnote/document-core";
import { describe, expect, it } from "vitest";
import {
  buildPageTargetCatalog,
  summarizeEditorOperation,
} from "./page-target-catalog-builder";

const PDF_LINE: PdfSceneObject = {
  id: "pdf:doc:0:line:line-1",
  pageId: "page-1",
  source: "pdf",
  kind: "line",
  bounds: { x: 10, y: 20, width: 220, height: 18 },
  zIndex: 0,
  visible: true,
  locked: false,
  objectRevision: 1,
  sourceObjectId: "line-1",
  text: "세종대왕의 주요 업적",
  readingOrder: 1,
  childWordIds: [],
  paragraphId: "paragraph-1",
};

const EDITABLE_TEXT: CanvasSceneObject = {
  id: "canvas:page-1:text:note-1",
  pageId: "page-1",
  source: "canvas",
  kind: "text",
  bounds: { x: 40, y: 100, width: 180, height: 50 },
  zIndex: 1,
  visible: true,
  locked: false,
  objectRevision: 2,
  text: "복습 메모",
  style: { fontSize: 14 },
  createdAt: 100,
  updatedAt: 120,
};

const OTHER_PAGE_TEXT: CanvasSceneObject = {
  ...EDITABLE_TEXT,
  id: "canvas:page-2:text:note-2",
  pageId: "page-2",
};

const SEMANTIC_MODEL = new PageSemanticModel({
  schemaVersion: 1,
  extractorVersion: "test",
  documentId: "doc-1",
  pageId: "page-1",
  pageNumber: 1,
  sourceSignature: "test-signature",
  semanticSource: "legacy-semantic-fallback",
  readingOrder: ["sentence-1"],
  words: [],
  unassignedWords: [],
  lines: [],
  layoutRegions: [],
  layoutBlocks: [],
  columns: [],
  sentences: [{
    id: "sentence-1",
    type: "SENTENCE",
    pageId: "page-1",
    text: "AI의 문제점을 설명하는 문장",
    normalizedText: "AI의 문제점을 설명하는 문장",
    bounds: { x: 0.1, y: 0.2, width: 0.4, height: 0.05 },
    fragments: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.05 }],
    readingOrder: 2,
    confidence: 1,
    orientation: { angle: 0, writingMode: "horizontal" },
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    wordIds: [],
    lineIds: [],
    paragraphId: "paragraph-1",
    startWordId: "word-1",
    endWordId: "word-2",
  }],
  paragraphs: [],
  createdAt: 1,
  sourceItemCount: 0,
  processingDurationMs: 0,
});

describe("buildPageTargetCatalog", () => {
  it("maps real PDF and Ggulnote objects with source permissions and page filtering", () => {
    const scene = buildSceneSnapshot({
      mode: "pdf",
      page: { id: "page-1", index: 0, width: 600, height: 800 },
      sceneRevision: 7,
      pdfObjects: [PDF_LINE],
      canvasObjects: [EDITABLE_TEXT, OTHER_PAGE_TEXT],
    });
    const operation = {
      operationId: "op-1",
      documentId: "doc-1",
      pageId: "page-1",
      annotationId: "note-1",
      type: "UPDATE_ANNOTATION",
      payload: {},
      createdAt: 200,
    } satisfies EditorOperation;
    const recentOperation = summarizeEditorOperation(operation, scene);

    const catalog = buildPageTargetCatalog({
      scene,
      semanticModel: SEMANTIC_MODEL,
      recentOperations: [recentOperation],
    });

    expect(catalog).toMatchObject({ pageId: "page-1", sceneRevision: 7 });
    expect(catalog.candidates).toHaveLength(3);
    expect(catalog.candidates.find((candidate) => candidate.source === "pdf"))
      .toMatchObject({
        type: "line",
        text: "세종대왕의 주요 업적",
        editable: false,
        annotatable: true,
        semanticUnit: "line",
      });
    expect(catalog.candidates.find((candidate) => candidate.source === "ggulnote"))
      .toMatchObject({
        type: "text",
        text: "복습 메모",
        editable: true,
        annotatable: true,
        operationId: "op-1",
      });
    expect(catalog.candidates.find((candidate) => candidate.type === "sentence"))
      .toMatchObject({
        source: "pdf",
        text: "AI의 문제점을 설명하는 문장",
        editable: false,
        annotatable: true,
        semanticUnit: "sentence",
        bounds: { x: 60, y: 160, width: 240, height: 40 },
      });
    expect(catalog.candidates.some((candidate) => candidate.pageId === "page-2"))
      .toBe(false);
    expect(recentOperation.targetSceneObjectId).toBe(EDITABLE_TEXT.id);
  });
});
