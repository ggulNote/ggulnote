import { describe, expect, it } from "vitest";
import type { PageSemanticModel } from "@ggulnote/document-core";
import {
  buildCanvasSceneObjects,
  buildCompositeRenderSnapshot,
  buildOccupancyMap,
  buildPdfSceneObjects,
  buildPlacementCandidates,
  buildSceneContext,
  buildSceneSnapshot,
  CanvasObjectStore,
  createCapabilityRegistry,
  validatePlacementRequest,
} from "../src";
import type {
  CanvasSceneObject,
  OccupancyPolicy,
  PlacementRequest,
  SceneObject,
  ScenePage,
  SceneObjectPlacementPolicy,
  SceneSnapshot,
} from "../src";

const PAGE_ID = "page-1";
const DOCUMENT_ID = "doc-scene";
const PAGE: ScenePage = {
  id: PAGE_ID,
  index: 0,
  width: 320,
  height: 420,
};

const makeSemanticModel = (): PageSemanticModel => {
  const paragraph = {
    id: "paragraph-1",
    type: "PARAGRAPH" as const,
    pageId: PAGE_ID,
    text: "안녕하세요 테스트 문단",
    normalizedText: "안녕하세요 테스트 문단",
    bounds: { x: 0.05, y: 0.05, width: 0.9, height: 0.08 },
    readingOrder: 1,
    confidence: 1,
    orientation: { angle: 0, writingMode: "horizontal" as const },
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    sourceItemIds: ["w-1", "w-2", "w-3"],
    lineIds: ["line-1"],
    sentenceIds: ["sentence-1"],
    fragments: [{ x: 0.05, y: 0.05, width: 0.9, height: 0.08 }],
    averageFontSize: 12,
  } as const;

  const line = {
    id: "line-1",
    type: "LINE" as const,
    pageId: PAGE_ID,
    text: "안녕하세요 테스트 문단",
    normalizedText: "안녕하세요 테스트 문단",
    bounds: { x: 0.05, y: 0.05, width: 0.9, height: 0.03 },
    readingOrder: 2,
    confidence: 1,
    orientation: { angle: 0, writingMode: "horizontal" as const },
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    wordIds: ["word-1", "word-2", "word-3"],
    paragraphId: paragraph.id,
    baseline: 0,
    sourceItemIds: ["i1", "i2", "i3"],
    direction: "ltr" as const,
    startsWithPunctuation: false,
    endsWithPunctuation: false,
    hasEOL: true,
    averageFontSize: 12,
    columnIndex: 0,
    axis: { advanceX: 1, advanceY: 0, normalX: 0, normalY: 1 },
    horizontalGaps: [],
    fragments: [
      { x: 0.05, y: 0.05, width: 0.9, height: 0.03 },
    ],
  } as const;

  const word1 = {
    id: "word-1",
    type: "WORD" as const,
    pageId: PAGE_ID,
    text: "안녕하세요",
    normalizedText: "안녕하세요",
    bounds: { x: 0.05, y: 0.05, width: 0.34, height: 0.03 },
    readingOrder: 3,
    confidence: 1,
    orientation: { angle: 0, writingMode: "horizontal" as const },
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    lineId: line.id,
    sourceItemIds: ["si1"],
    sourceRanges: [{ sourceTextItemId: "si1", startOffset: 0, endOffset: 5 }],
    direction: "ltr" as const,
    fontName: "system",
    fontSize: 12,
    startsWithPunctuation: false,
    endsWithPunctuation: false,
    hasEOL: false,
    axis: { advanceX: 0.5, advanceY: 0, normalX: 0, normalY: 1 },
    quad: { points: [
      { x: 0.05, y: 0.05 },
      { x: 0.39, y: 0.05 },
      { x: 0.39, y: 0.08 },
      { x: 0.05, y: 0.08 },
    ] },
    fragments: [{ x: 0.05, y: 0.05, width: 0.34, height: 0.03 }],
  } as const;

  const word2 = {
    ...word1,
    id: "word-2",
    text: "테스트",
    normalizedText: "테스트",
    bounds: { x: 0.41, y: 0.05, width: 0.24, height: 0.03 },
    readingOrder: 4,
    sourceRanges: [{ sourceTextItemId: "si2", startOffset: 6, endOffset: 8 }],
    sourceItemIds: ["si2"],
    fragments: [{ x: 0.41, y: 0.05, width: 0.24, height: 0.03 }],
    quad: {
      points: [
        { x: 0.41, y: 0.05 },
        { x: 0.65, y: 0.05 },
        { x: 0.65, y: 0.08 },
        { x: 0.41, y: 0.08 },
      ],
    },
  } as const;

  const word3 = {
    ...word1,
    id: "word-3",
    text: "문단",
    normalizedText: "문단",
    bounds: { x: 0.67, y: 0.05, width: 0.15, height: 0.03 },
    readingOrder: 5,
    sourceRanges: [{ sourceTextItemId: "si3", startOffset: 9, endOffset: 11 }],
    sourceItemIds: ["si3"],
    fragments: [{ x: 0.67, y: 0.05, width: 0.15, height: 0.03 }],
    quad: {
      points: [
        { x: 0.67, y: 0.05 },
        { x: 0.82, y: 0.05 },
        { x: 0.82, y: 0.08 },
        { x: 0.67, y: 0.08 },
      ],
    },
  } as const;

  const tableRegion = {
    id: "region-table-1",
    pageId: PAGE_ID,
    bounds: { x: 0.05, y: 0.5, width: 0.45, height: 0.1 },
    orientation: { angle: 0, writingMode: "horizontal" as const },
    blockIds: [],
    columnIds: [],
    readingOrder: 10,
    layoutType: "table" as const,
    confidence: 0.95,
    source: "yolo" as const,
    sourceDetection: {
      detectionId: "det-1",
      label: "table",
      bounds: { x: 0.05, y: 0.5, width: 0.45, height: 0.1 },
    },
    textContent: {
      text: "",
      paragraphIds: [],
      lineIds: [],
      wordIds: [],
      source: "pdf-text" as const,
    },
    mediaContent: undefined,
    relatedRegionIds: [],
    relations: [],
  } as const;

  const imageRegion = {
    ...tableRegion,
    id: "region-image-1",
    bounds: { x: 0.55, y: 0.5, width: 0.35, height: 0.1 },
    layoutType: "picture" as const,
    source: "yolo" as const,
    confidence: 0.9,
    textContent: {
      text: "",
      paragraphIds: [],
      lineIds: [],
      wordIds: [],
      source: "ocr" as const,
    },
    sourceDetection: {
      detectionId: "det-2",
      label: "picture",
      bounds: { x: 0.55, y: 0.5, width: 0.35, height: 0.1 },
    },
  } as const;

  return {
    getAllByReadingOrder: () => [paragraph, line, word1, word2, word3] as never,
    getLayoutRegions: () => [tableRegion, imageRegion] as never,
  } as unknown as PageSemanticModel;
};

const createCanvasStore = (): CanvasObjectStore => {
  const ids: string[] = ["a", "b", "c", "d", "e", "f", "g"];
  let index = 0;
  return new CanvasObjectStore({
    idGenerator: () => ids[index++] ?? `gen-${index}`,
    now: () => 1_700_000_000_000,
  });
};

describe("Scene Core: scene identity and namespaces", () => {
  it("assigns distinct PDF and Canvas ID namespaces", () => {
    const pdf = buildPdfSceneObjects({
      documentId: DOCUMENT_ID,
      pageId: PAGE_ID,
      pageIndex: 0,
      pageWidth: PAGE.width,
      pageHeight: PAGE.height,
      semanticModel: makeSemanticModel(),
    }).objects;

    const store = createCanvasStore();
    const text = store.createObject({
      kind: "text",
      pageId: PAGE_ID,
      bounds: { x: 20, y: 20, width: 40, height: 12 },
      zIndex: 1,
      visible: true,
      locked: false,
      text: "note",
      style: { fontSize: 16 },
    });

    expect(pdf[0]?.id.startsWith("pdf:")).toBe(true);
    expect(text.id.startsWith("canvas:")).toBe(true);
    expect(pdf.find((entry) => entry.id === text.id)).toBeUndefined();
  });

  it("preserves stable IDs for same PDF semantic input", () => {
    const model = makeSemanticModel();
    const first = buildPdfSceneObjects({
      documentId: DOCUMENT_ID,
      pageId: PAGE_ID,
      pageIndex: 0,
      pageWidth: PAGE.width,
      pageHeight: PAGE.height,
      semanticModel: model,
    }).objects.map((entry) => entry.id);

    const second = buildPdfSceneObjects({
      documentId: DOCUMENT_ID,
      pageId: PAGE_ID,
      pageIndex: 0,
      pageWidth: PAGE.width,
      pageHeight: PAGE.height,
      semanticModel: model,
    }).objects.map((entry) => entry.id);

    expect(first).toEqual(second);
  });
});

describe("Scene Core: CanvasObjectStore", () => {
  it("supports create/update/move/resize/remove and revision increments", () => {
    const store = createCanvasStore();
    const revision0 = store.getSceneRevision();

    const text = store.createObject({
      kind: "text",
      pageId: PAGE_ID,
      bounds: { x: 10, y: 10, width: 120, height: 20 },
      zIndex: 1,
      visible: true,
      locked: false,
      text: "memo",
      style: { fontSize: 12 },
    });

    expect(store.getSceneRevision()).toBe(revision0 + 1);
    expect(text.objectRevision).toBe(1);

    const noChange = store.updateObject(text.id, { text: "memo" });
    expect(noChange.objectRevision).toBe(1);
    expect(store.getSceneRevision()).toBe(revision0 + 1);

    const moved = store.moveObject(text.id, { x: 5, y: 8 });
    expect(moved.bounds).toEqual({ x: 15, y: 18, width: 120, height: 20 });
    expect(moved.objectRevision).toBe(2);
    expect(store.getSceneRevision()).toBe(revision0 + 2);

    const resized = store.resizeObject(text.id, { x: 15, y: 18, width: 200, height: 50 });
    expect(resized.objectRevision).toBe(3);
    expect(store.getSceneRevision()).toBe(revision0 + 3);

    const hidden = store.setVisibility(text.id, false);
    expect(hidden.visible).toBe(false);
    expect(hidden.objectRevision).toBe(4);

    const locked = store.setLocked(text.id, true);
    expect(locked.locked).toBe(true);
    expect(locked.objectRevision).toBe(5);

    const reordered = store.reorderObject(text.id, 7);
    expect(reordered.zIndex).toBe(7);
    expect(reordered.objectRevision).toBe(6);

    store.removeObject(text.id);
    expect(store.getPageObjects(PAGE_ID)).toHaveLength(0);
    expect(store.getSceneRevision()).toBe(revision0 + 7);
  });

  it("returns deterministic ordering by z-index then id", () => {
    const store = createCanvasStore();

    store.createObject({
      id: "canvas:page-1:shape:2",
      kind: "shape",
      pageId: PAGE_ID,
      bounds: { x: 0, y: 10, width: 10, height: 10 },
      zIndex: 3,
      visible: true,
      locked: false,
      shapeType: "rectangle",
      geometry: { kind: "rectangle", x: 0, y: 10, width: 10, height: 10 },
      style: {},
    });

    store.createObject({
      id: "canvas:page-1:shape:1",
      kind: "shape",
      pageId: PAGE_ID,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      zIndex: 3,
      visible: true,
      locked: false,
      shapeType: "rectangle",
      geometry: { kind: "rectangle", x: 0, y: 0, width: 10, height: 10 },
      style: {},
    });

    const objects = store.getPageObjects(PAGE_ID);
    expect(objects[0]?.id).toBe("canvas:page-1:shape:1");
    expect(objects[1]?.id).toBe("canvas:page-1:shape:2");
  });
});

describe("Scene Core: Canvas Scene Adapter", () => {
  it("includes hidden objects and drops deleted objects", () => {
    const store = createCanvasStore();

    const hidden = store.createObject({
      id: "hidden-text",
      kind: "text",
      pageId: PAGE_ID,
      bounds: { x: 10, y: 10, width: 10, height: 10 },
      zIndex: 1,
      visible: false,
      locked: false,
      text: "hidden",
      style: { fontSize: 12 },
    });

    const visible = store.createObject({
      id: "visible-text",
      kind: "text",
      pageId: PAGE_ID,
      bounds: { x: 20, y: 20, width: 10, height: 10 },
      zIndex: 2,
      visible: true,
      locked: false,
      text: "visible",
      style: { fontSize: 12 },
    });

    const initial = buildCanvasSceneObjects({
      pageId: PAGE_ID,
      pageBounds: { x: 0, y: 0, width: 200, height: 200 },
      store,
    });

    expect(initial.objects.some((entry) => entry.id === hidden.id)).toBe(true);
    expect(initial.objects.some((entry) => entry.id === visible.id)).toBe(true);
    expect((initial.objects.find((entry) => entry.id === hidden.id) as SceneObject).visible).toBe(false);

    store.removeObject(hidden.id);
    const afterDelete = buildCanvasSceneObjects({
      pageId: PAGE_ID,
      pageBounds: { x: 0, y: 0, width: 200, height: 200 },
      store,
    });

    expect(afterDelete.objects.some((entry) => entry.id === hidden.id)).toBe(false);
    expect(afterDelete.objects.some((entry) => entry.id === visible.id)).toBe(true);
  });

  it("recomputes group bounds from child bounds", () => {
    const store = createCanvasStore();

    const c1 = store.createObject({
      kind: "text",
      pageId: PAGE_ID,
      bounds: { x: 20, y: 20, width: 24, height: 10 },
      zIndex: 1,
      visible: true,
      locked: false,
      text: "a",
      style: { fontSize: 12 },
    });

    const c2 = store.createObject({
      kind: "text",
      pageId: PAGE_ID,
      bounds: { x: 60, y: 50, width: 10, height: 10 },
      zIndex: 2,
      visible: true,
      locked: false,
      text: "b",
      style: { fontSize: 12 },
    });

    const group = store.createObject({
      kind: "group",
      pageId: PAGE_ID,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      zIndex: 3,
      visible: true,
      locked: false,
      childIds: [c1.id, c2.id],
    });

    const out = buildCanvasSceneObjects({
      pageId: PAGE_ID,
      pageBounds: { x: 0, y: 0, width: 200, height: 200 },
      store,
    });

    const groupObject = out.objects.find((entry) => entry.id === group.id) as SceneObject;
    expect(groupObject?.bounds).toEqual({ x: 20, y: 20, width: 50, height: 40 });
  });
});

describe("Scene Core: PDF Scene Adapter", () => {
  it("builds paragraph, line, word, table, and image objects", () => {
    const model = makeSemanticModel();
    const objects = buildPdfSceneObjects({
      documentId: DOCUMENT_ID,
      pageId: PAGE_ID,
      pageIndex: 0,
      pageWidth: PAGE.width,
      pageHeight: PAGE.height,
      semanticModel: model,
    }).objects;

    const paragraph = objects.find((entry) => entry.kind === "paragraph");
    const line = objects.find((entry) => entry.kind === "line");
    const word = objects.find((entry) => entry.kind === "word");
    const table = objects.find((entry) => entry.kind === "table");
    const image = objects.find((entry) => entry.kind === "image");

    expect(paragraph).toBeTruthy();
    expect(line).toBeTruthy();
    expect(word).toBeTruthy();
    expect(table).toBeTruthy();
    expect(image).toBeTruthy();
    expect((image as SceneObject).id.startsWith("pdf:")).toBe(true);

    if (line?.kind === "line") {
      expect(line.childWordIds.length).toBeGreaterThan(0);
    }

    if (word?.kind === "word") {
      expect((word as SceneObject).source).toBe("pdf");
    }
  });

  it("projects reconstructed canonical paragraph text while retaining word geometry objects", () => {
    const baseModel = makeSemanticModel();
    const items = baseModel.getAllByReadingOrder();
    const sourceParagraph = items.find((item) => item.type === "PARAGRAPH");
    if (sourceParagraph?.type !== "PARAGRAPH") throw new Error("Expected paragraph fixture.");
    const rawParagraph = {
      ...sourceParagraph,
      text: "render- ing HTML into visual webpages",
      normalizedText: "render- ing HTML into visual webpages",
      sentenceIds: ["sentence-canonical"],
    };
    const canonicalSentence = {
      ...sourceParagraph,
      id: "sentence-canonical",
      type: "SENTENCE" as const,
      text: "rendering HTML into visual webpages",
      normalizedText: "rendering HTML into visual webpages",
      paragraphId: sourceParagraph.id,
      wordIds: ["word-1", "word-2", "word-3"],
      lineIds: ["line-1"],
      startWordId: "word-1",
      endWordId: "word-3",
    };
    const semanticModel = {
      getAllByReadingOrder: () => [
        rawParagraph,
        canonicalSentence,
        ...items.filter((item) => item.type !== "PARAGRAPH"),
      ],
      getLayoutRegions: () => [],
    } as unknown as PageSemanticModel;

    const objects = buildPdfSceneObjects({
      documentId: DOCUMENT_ID,
      pageId: PAGE_ID,
      pageIndex: 0,
      pageWidth: PAGE.width,
      pageHeight: PAGE.height,
      semanticModel,
    }).objects;

    expect(objects.find((object) => object.kind === "paragraph")).toMatchObject({
      text: "rendering HTML into visual webpages",
    });
    expect(objects.filter((object) => object.kind === "word")).toHaveLength(3);
  });

  it("keeps original semantic ID namespace stable", () => {
    const model = makeSemanticModel();
    const first = buildPdfSceneObjects({
      documentId: DOCUMENT_ID,
      pageId: PAGE_ID,
      pageIndex: 0,
      pageWidth: PAGE.width,
      pageHeight: PAGE.height,
      semanticModel: model,
    }).objects;

    const second = buildPdfSceneObjects({
      documentId: DOCUMENT_ID,
      pageId: PAGE_ID,
      pageIndex: 0,
      pageWidth: PAGE.width,
      pageHeight: PAGE.height,
      semanticModel: model,
    }).objects;

    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
  });
});

describe("Scene Core: SceneSnapshot", () => {
  it("merges PDF and canvas objects for pdf mode", () => {
    const pdfObjects = buildPdfSceneObjects({
      documentId: DOCUMENT_ID,
      pageId: PAGE_ID,
      pageIndex: 0,
      pageWidth: PAGE.width,
      pageHeight: PAGE.height,
      semanticModel: makeSemanticModel(),
    }).objects;

    const canvasStore = createCanvasStore();
    const text = canvasStore.createObject({
      kind: "text",
      pageId: PAGE_ID,
      bounds: { x: 160, y: 200, width: 30, height: 12 },
      zIndex: 2,
      visible: true,
      locked: false,
      text: "canvas text",
      style: { fontSize: 12 },
    });

    const snapshot = buildSceneSnapshot({
      mode: "pdf",
      page: PAGE,
      sceneRevision: 10,
      pdfObjects,
      canvasObjects: buildCanvasSceneObjects({
        pageId: PAGE_ID,
        pageBounds: { x: 0, y: 0, width: PAGE.width, height: PAGE.height },
        store: canvasStore,
      }).objects as CanvasSceneObject[],
    });

    expect(snapshot.objects.length).toBe(pdfObjects.length + 1);
    expect(snapshot.objectById[text.id]).toBeTruthy();
    expect(snapshot.objectById[pdfObjects[0]!.id]).toBeTruthy();
    expect(snapshot.renderOrder).toEqual(snapshot.objects.map((entry) => entry.id));
    const sorted = [...snapshot.objects].sort((left, right) => {
      if (left.zIndex === right.zIndex) {
        return left.id.localeCompare(right.id);
      }
      return left.zIndex - right.zIndex;
    });
    expect(snapshot.renderOrder).toEqual(sorted.map((entry) => entry.id));
  });

  it("blank mode includes only canvas objects", () => {
    const canvasStore = createCanvasStore();
    canvasStore.createObject({
      kind: "math",
      pageId: PAGE_ID,
      bounds: { x: 10, y: 10, width: 100, height: 30 },
      zIndex: 1,
      visible: true,
      locked: false,
      latex: "x+1",
      mathJson: { type: "add" },
    });

    const snapshot = buildSceneSnapshot({
      mode: "blank",
      page: PAGE,
      sceneRevision: 3,
      canvasObjects: buildCanvasSceneObjects({
        pageId: PAGE_ID,
        pageBounds: { x: 0, y: 0, width: PAGE.width, height: PAGE.height },
        store: canvasStore,
      }).objects as CanvasSceneObject[],
    });

    expect(snapshot.objects.every((entry) => entry.source === "canvas")).toBe(true);
  });
});

describe("Scene Core: Occupancy", () => {
  const basePagePolicy: OccupancyPolicy = {
    includeInvisible: false,
    includeAnnotations: true,
    annotationBlockingTypes: ["box"],
    padding: 4,
    minimumBlockingSize: { width: 2, height: 2 },
  };

  const paragraph: SceneObject = {
    id: "pdf:doc:0:paragraph:p1",
    source: "pdf",
    kind: "paragraph",
    pageId: PAGE_ID,
    bounds: { x: 0, y: 0, width: 80, height: 20 },
    zIndex: 1,
    visible: true,
    locked: false,
    objectRevision: 1,
    text: "p",
    readingOrder: 1,
    childLineIds: [],
    regionId: "r",
    sourceObjectId: "s",
  };

  const highlight: SceneObject = {
    id: "canvas:page-1:annotation:a1",
    source: "canvas",
    kind: "annotation",
    pageId: PAGE_ID,
    bounds: { x: 100, y: 100, width: 20, height: 20 },
    zIndex: 2,
    visible: true,
    locked: false,
    objectRevision: 1,
    annotationType: "highlight",
    targetObjectIds: [paragraph.id],
    style: {},
  };

  it("treats paragraph as blocking and default highlight policy as non-blocking", () => {
    const map = buildOccupancyMap({
      sceneRevision: 11,
      pageBounds: { x: 0, y: 0, width: PAGE.width, height: PAGE.height },
      objects: [paragraph, highlight],
      policy: basePagePolicy,
    });

    const paragraphRow = map.objects.find((entry) => entry.objectId === paragraph.id);
    const annotationRow = map.objects.find((entry) => entry.objectId === highlight.id);

    expect(paragraphRow?.blocking).toBe(true);
    expect(annotationRow?.blocking).toBe(false);
    expect(paragraphRow?.bounds.width).toBeGreaterThan(80);
  });

  it("allows annotation box blocking via policy", () => {
    const map = buildOccupancyMap({
      sceneRevision: 12,
      pageBounds: { x: 0, y: 0, width: PAGE.width, height: PAGE.height },
      objects: [highlight],
      policy: {
        ...basePagePolicy,
        annotationBlockingTypes: ["highlight", "box"],
      },
    });

    expect(map.objects[0]?.blocking).toBe(true);
  });
});

describe("Scene Core: Placement", () => {
  const placementPolicy: SceneObjectPlacementPolicy = {
    minimumCandidateWidth: 8,
    minimumCandidateHeight: 8,
    allowOutOfPage: false,
    minimumCollisionArea: 0,
    scoreWeightArea: 1,
    scoreWeightFocusDistance: 0.35,
    scoreWeightEdgeDistance: 0.25,
    scoreWeightWhitespace: 0.4,
  };

  const baseObject: SceneObject = {
    id: "canvas:page-1:text:t1",
    source: "canvas",
    kind: "text",
    pageId: PAGE_ID,
    bounds: { x: 80, y: 80, width: 100, height: 30 },
    zIndex: 1,
    visible: true,
    locked: false,
    objectRevision: 1,
    text: "base",
    style: { fontSize: 14 },
  };

  it("builds deterministic candidates and focus relations", () => {
    const occupancy = buildOccupancyMap({
      sceneRevision: 1,
      pageBounds: { x: 0, y: 0, width: PAGE.width, height: PAGE.height },
      objects: [baseObject],
      policy: {
        includeInvisible: false,
        includeAnnotations: true,
        annotationBlockingTypes: ["box"],
        padding: 2,
        minimumBlockingSize: { width: 1, height: 1 },
      },
    });

    const first = buildPlacementCandidates({
      sceneRevision: 20,
      page: PAGE,
      objects: [baseObject],
      occupancy,
      focus: { objectId: baseObject.id },
      maxCandidates: 5,
      minimumWidth: 12,
      minimumHeight: 12,
      minimumCollisionArea: 0,
    });

    const second = buildPlacementCandidates({
      sceneRevision: 20,
      page: PAGE,
      objects: [baseObject],
      occupancy,
      focus: { objectId: baseObject.id },
      maxCandidates: 5,
      minimumWidth: 12,
      minimumHeight: 12,
      minimumCollisionArea: 0,
    });

    expect(first.candidates.length).toBeGreaterThan(0);
    expect(first.candidates.map((entry) => entry.id)).toEqual(second.candidates.map((entry) => entry.id));
    expect(first.candidates.some((entry) => entry.relation !== "PAGE_FREE_SPACE")).toBe(true);
    expect(first.candidates[0]?.nearbyObjectIds).toEqual(expect.any(Array));
  });

  it("respects candidate upper bound and minimum size", () => {
    const occupancy = buildOccupancyMap({
      sceneRevision: 2,
      pageBounds: { x: 0, y: 0, width: 100, height: 100 },
      objects: [],
      policy: {
        includeInvisible: false,
        includeAnnotations: true,
        annotationBlockingTypes: ["box"],
        padding: 0,
        minimumBlockingSize: { width: 1, height: 1 },
      },
    });

    const many = buildPlacementCandidates({
      sceneRevision: 21,
      page: { ...PAGE, width: 100, height: 100 },
      objects: [],
      occupancy,
      maxCandidates: 2,
      minimumWidth: 80,
      minimumHeight: 80,
    });

    const all = buildPlacementCandidates({
      sceneRevision: 21,
      page: { ...PAGE, width: 100, height: 100 },
      objects: [],
      occupancy,
      minimumWidth: 10,
      minimumHeight: 10,
    });

    expect(many.candidates.length).toBeLessThanOrEqual(all.candidates.length);
  });
});

describe("Scene Core: Placement Validation", () => {
  const policy: SceneObjectPlacementPolicy = {
    minimumCandidateWidth: 8,
    minimumCandidateHeight: 8,
    allowOutOfPage: false,
    minimumCollisionArea: 0,
    scoreWeightArea: 1,
    scoreWeightFocusDistance: 0.35,
    scoreWeightEdgeDistance: 0.25,
    scoreWeightWhitespace: 0.4,
  };

  const baseScene: SceneSnapshot = {
    sceneRevision: 33,
    mode: "pdf",
    page: PAGE,
    objects: [
      {
        id: "canvas:page-1:text:a",
        source: "canvas",
        kind: "text",
        pageId: PAGE_ID,
        bounds: { x: 10, y: 10, width: 30, height: 20 },
        zIndex: 1,
        visible: true,
        locked: false,
        objectRevision: 1,
        text: "base",
        style: { fontSize: 12 },
      },
    ],
    objectById: {
      "canvas:page-1:text:a": {
        id: "canvas:page-1:text:a",
        source: "canvas",
        kind: "text",
        pageId: PAGE_ID,
        bounds: { x: 10, y: 10, width: 30, height: 20 },
        zIndex: 1,
        visible: true,
        locked: false,
        objectRevision: 1,
        text: "base",
        style: { fontSize: 12 },
      },
    },
    renderOrder: ["canvas:page-1:text:a"],
    generatedAt: 1,
  };

  const occupancy = buildOccupancyMap({
    sceneRevision: 33,
    pageBounds: { x: 0, y: 0, width: PAGE.width, height: PAGE.height },
    objects: baseScene.objects,
    policy: {
      includeInvisible: false,
      includeAnnotations: true,
      annotationBlockingTypes: ["box"],
      padding: 0,
      minimumBlockingSize: { width: 1, height: 1 },
    },
  });

  const candidates = buildPlacementCandidates({
    sceneRevision: 33,
    page: PAGE,
    objects: baseScene.objects,
    occupancy,
    minimumWidth: 8,
    minimumHeight: 8,
    minimumCollisionArea: 0,
  }).candidates;

  it("accepts valid fixed placement", () => {
    const request: PlacementRequest = {
      sceneRevision: 33,
      candidateId: candidates[0]!.id,
      alignment: "TOP_LEFT",
      sizePolicy: "FIXED",
      requestedSize: { width: 20, height: 10 },
    };

    const result = validatePlacementRequest({
      request,
      scene: baseScene,
      candidates,
      policy,
    });

    expect(result.valid).toBe(true);
  });

  it("rejects revision mismatch", () => {
    const request: PlacementRequest = {
      sceneRevision: 34,
      candidateId: candidates[0]!.id,
      alignment: "TOP_LEFT",
      sizePolicy: "FIT_CONTENT",
    };

    const result = validatePlacementRequest({
      request,
      scene: baseScene,
      candidates,
      policy,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("SCENE_REVISION_MISMATCH");
    }
  });

  it("rejects invalid/out of page placement", () => {
    const request: PlacementRequest = {
      sceneRevision: 33,
      candidateId: candidates[0]!.id,
      alignment: "TOP_LEFT",
      sizePolicy: "FIXED",
      requestedSize: { width: 999, height: 999 },
    };

    const result = validatePlacementRequest({
      request,
      scene: baseScene,
      candidates,
      policy,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("OUT_OF_PAGE");
    }
  });

  it("rejects small request by policy minimum", () => {
    const request: PlacementRequest = {
      sceneRevision: 33,
      candidateId: candidates[0]!.id,
      alignment: "TOP_LEFT",
      sizePolicy: "FIXED",
      requestedSize: { width: 1, height: 1 },
    };

    const strict = {
      ...policy,
      minimumCandidateWidth: 50,
      minimumCandidateHeight: 50,
    };

    const result = validatePlacementRequest({
      request,
      scene: baseScene,
      candidates,
      policy: strict,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("INSUFFICIENT_SPACE");
    }
  });
});

describe("Scene Core: Scene Context and Capability Registry", () => {
  it("builds occupancy and placement candidates for current page", () => {
    const context = buildSceneContext({
      sceneRevision: 11,
      mode: "blank",
      page: PAGE,
      objects: [
        {
          id: "canvas:page-1:text:t",
          source: "canvas",
          kind: "text",
          pageId: PAGE_ID,
          bounds: { x: 20, y: 20, width: 40, height: 16 },
          zIndex: 1,
          visible: true,
          locked: false,
          objectRevision: 1,
          text: "focus",
          style: { fontSize: 12 },
        },
      ],
      occupancyPolicy: {
        includeInvisible: false,
        includeAnnotations: true,
        annotationBlockingTypes: ["box"],
        padding: 1,
        minimumBlockingSize: { width: 2, height: 2 },
      },
      placementMaxCandidates: 10,
      placementMinimumWidth: 8,
      placementMinimumHeight: 8,
    });

    expect(context.occupancyMap.objects.length).toBeGreaterThan(0);
    expect(context.placementCandidates.length).toBeGreaterThan(0);
  });

  it("creates independent capability registries", () => {
    const registry1 = createCapabilityRegistry();
    const registry2 = createCapabilityRegistry();

    const noop = {
      id: "text" as const,
      estimateFootprint: () => ({ width: 1, height: 1 }),
      validatePlacement: () => ({ valid: false, reason: "INVALID_SIZE" as const }),
      compile: () => ({}),
    };

    registry1.register(noop);
    expect(registry1.get("text")).toBeDefined();
    expect(registry2.get("text")).toBeUndefined();

    registry1.unregister("text");
    expect(registry1.get("text")).toBeUndefined();
  });

  it("rejects duplicate registry registration", () => {
    const registry = createCapabilityRegistry();

    const cap = {
      id: "math" as const,
      estimateFootprint: () => ({ width: 2, height: 1 }),
      validatePlacement: () => ({ valid: false, reason: "INVALID_SIZE" as const }),
      compile: () => ({}),
    };

    registry.register(cap);
    expect(() => registry.register(cap)).toThrow("Duplicate capability id");
  });
});

describe("Scene Core: Composite Snapshot", () => {
  it("marks stale=false when revision unchanged", async () => {
    const result = await buildCompositeRenderSnapshot({
      pageId: PAGE_ID,
      page: PAGE,
      sceneRevision: 7,
      renderImage: async () => "data:image/svg+xml;utf8,<svg></svg>",
      getCurrentSceneRevision: () => 7,
    });

    expect(result.snapshot?.stale).toBe(false);
    expect(result.snapshot?.sceneRevision).toBe(7);
  });

  it("marks stale=true when revision changed during render", async () => {
    const result = await buildCompositeRenderSnapshot({
      pageId: PAGE_ID,
      page: PAGE,
      sceneRevision: 7,
      renderImage: async () => "data:image/svg+xml;utf8,<svg></svg>",
      getCurrentSceneRevision: () => 9,
    });

    expect(result.snapshot?.stale).toBe(true);
  });
});
