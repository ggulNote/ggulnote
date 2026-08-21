import type {
  LayoutRegion,
  PageSemanticModel,
  SemanticLine,
  SemanticParagraph,
  SemanticSentence,
  SemanticWord,
} from "@ggulnote/document-core";
import type { PageId, Rect } from "@ggulnote/shared-types";
import {
  clampRectToPage,
  normalizedToCanonicalRect,
} from "./coordinate";
import type {
  ImageSceneObject,
  LineSceneObject,
  PdfRegionSceneObject,
  ParagraphSceneObject,
  PdfSceneObject,
  TableSceneObject,
  WordSceneObject,
} from "./types";

export interface PdfSceneAdapterInput {
  documentId: string;
  pageId: PageId;
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  semanticModel: PageSemanticModel;
  includeTables?: boolean;
  includeImages?: boolean;
  includePdfRegions?: boolean;
}

export interface PdfSceneAdapterOutput {
  objects: PdfSceneObject[];
}

export const buildPdfSceneObjects = (input: PdfSceneAdapterInput): PdfSceneAdapterOutput => {
  const pageBounds = clampRectToPage(
    {
      x: 0,
      y: 0,
      width: sanitizeDimension(input.pageWidth),
      height: sanitizeDimension(input.pageHeight),
    },
    {
      width: sanitizeDimension(input.pageWidth),
      height: sanitizeDimension(input.pageHeight),
    },
  );

  const semanticItems = input.semanticModel.getAllByReadingOrder();
  const sentenceById = new Map(semanticItems.flatMap((item) =>
    item.type === "SENTENCE" ? [[item.id, item] as const] : []));
  const includeTables = input.includeTables ?? true;
  const includeImages = input.includeImages ?? true;
  const includePdfRegions = input.includePdfRegions ?? true;
  const objects: PdfSceneObject[] = [];

  for (const item of semanticItems) {
    if (item.type === "PARAGRAPH") {
      objects.push(paragraphToSceneObject(input, item, pageBounds, sentenceById));
      continue;
    }

    if (item.type === "LINE") {
      objects.push(lineToSceneObject(input, item, pageBounds));
      continue;
    }

    if (item.type === "WORD") {
      objects.push(wordToSceneObject(input, item, pageBounds));
    }
  }

  for (const region of input.semanticModel.getLayoutRegions()) {
    if (region.layoutType === "table" && includeTables) {
      objects.push(tableRegionToSceneObject(input, region, pageBounds));
      continue;
    }

    if ((region.layoutType === "picture" || region.layoutType === "formula") && includeImages) {
      objects.push(imageRegionToSceneObject(input, region, pageBounds));
      continue;
    }

    if (includePdfRegions) {
      objects.push(regionToSceneObject(input, region, pageBounds));
    }
  }

  return { objects };
};

const paragraphToSceneObject = (
  input: PdfSceneAdapterInput,
  item: SemanticParagraph,
  pageBounds: { width: number; height: number },
  sentenceById: ReadonlyMap<string, SemanticSentence>,
): ParagraphSceneObject => {
  return {
    id: pdfObjectId(input.documentId, input.pageIndex, "paragraph", item.id),
    pageId: input.pageId,
    source: "pdf",
    kind: "paragraph",
    bounds: toCanonicalBounds(item.bounds, pageBounds),
    zIndex: 0,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: item.id,
    text: canonicalParagraphText(item, sentenceById),
    readingOrder: item.readingOrder,
    childLineIds: item.lineIds.map((lineId) => pdfObjectId(input.documentId, input.pageIndex, "line", lineId)),
    regionId: item.regionId,
    createdAt: undefined,
    updatedAt: undefined,
  };
};

function canonicalParagraphText(
  paragraph: SemanticParagraph,
  sentenceById: ReadonlyMap<string, SemanticSentence>,
): string {
  const sentenceText = paragraph.sentenceIds
    .map((sentenceId) => sentenceById.get(sentenceId)?.text)
    .filter((text): text is string => text !== undefined)
    .map(normalizeCanonicalText)
    .filter((text) => text.length > 0)
    .join(" ");
  return sentenceText || normalizeCanonicalText(paragraph.normalizedText || paragraph.text);
}

function normalizeCanonicalText(value: string): string {
  return value.normalize("NFKC").replace(/\u00a0/gu, " ").replace(/\s+/gu, " ").trim();
}

const lineToSceneObject = (
  input: PdfSceneAdapterInput,
  item: SemanticLine,
  pageBounds: { width: number; height: number },
): LineSceneObject => {
  return {
    id: pdfObjectId(input.documentId, input.pageIndex, "line", item.id),
    pageId: input.pageId,
    source: "pdf",
    kind: "line",
    bounds: toCanonicalBounds(item.bounds, pageBounds),
    zIndex: 0,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: item.id,
    text: item.text,
    readingOrder: item.readingOrder,
    childWordIds: item.wordIds.map((wordId) => pdfObjectId(input.documentId, input.pageIndex, "word", wordId)),
    paragraphId: item.paragraphId,
    baseline: Number.isFinite(item.baseline) ? item.baseline : undefined,
    createdAt: undefined,
    updatedAt: undefined,
  };
};

const wordToSceneObject = (
  input: PdfSceneAdapterInput,
  item: SemanticWord,
  pageBounds: { width: number; height: number },
): WordSceneObject => {
  const charOffsetStart = item.sourceRanges.length > 0 ? item.sourceRanges[0]?.startOffset ?? 0 : 0;
  const charOffsetEnd = item.sourceRanges.length > 0
    ? item.sourceRanges[item.sourceRanges.length - 1]?.endOffset ?? charOffsetStart
    : charOffsetStart;

  return {
    id: pdfObjectId(input.documentId, input.pageIndex, "word", item.id),
    pageId: input.pageId,
    source: "pdf",
    kind: "word",
    bounds: toCanonicalBounds(item.bounds, pageBounds),
    zIndex: 0,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: item.id,
    text: item.text,
    readingOrder: item.readingOrder,
    lineId: pdfObjectId(input.documentId, input.pageIndex, "line", item.lineId),
    charOffsetStart,
    charOffsetEnd,
    createdAt: undefined,
    updatedAt: undefined,
  };
};

const tableRegionToSceneObject = (
  input: PdfSceneAdapterInput,
  region: LayoutRegion,
  pageBounds: { width: number; height: number },
): TableSceneObject => {
  return {
    id: pdfObjectId(input.documentId, input.pageIndex, "table", region.id),
    pageId: input.pageId,
    source: "pdf",
    kind: "table",
    bounds: toCanonicalBounds(region.bounds, pageBounds),
    zIndex: 0,
    visible: true,
    locked: false,
    objectRevision: 1,
    rows: 0,
    columns: 0,
    cells: [],
    rowHeights: [],
    columnWidths: [],
    createdAt: undefined,
    updatedAt: undefined,
  };
};

const imageRegionToSceneObject = (
  input: PdfSceneAdapterInput,
  region: LayoutRegion,
  pageBounds: { width: number; height: number },
): ImageSceneObject => {
  const imageId = pdfObjectId(input.documentId, input.pageIndex, "image", region.id);

  return {
    id: imageId,
    pageId: input.pageId,
    source: "pdf",
    kind: "image",
    bounds: toCanonicalBounds(region.bounds, pageBounds),
    zIndex: 0,
    visible: true,
    locked: false,
    objectRevision: 1,
    sourceObjectId: region.id,
    imageId,
    imageSource: region.sourceDetection?.label ?? region.layoutType,
    createdAt: undefined,
    updatedAt: undefined,
  };
};

const regionToSceneObject = (
  input: PdfSceneAdapterInput,
  region: LayoutRegion,
  pageBounds: { width: number; height: number },
): PdfRegionSceneObject => {
  const baseBounds = toCanonicalBounds(region.bounds, pageBounds);
  return {
    id: pdfObjectId(input.documentId, input.pageIndex, "pdf-region", region.id),
    pageId: input.pageId,
    source: "pdf",
    kind: "pdf-region",
    bounds: baseBounds,
    zIndex: 0,
    visible: true,
    locked: false,
    objectRevision: 1,
    regionId: region.id,
    regionType: region.layoutType,
    regionBounds: baseBounds,
    relatedSemanticObjectIds: [...region.textContent?.paragraphIds ?? [], ...region.textContent?.lineIds ?? [], ...region.textContent?.wordIds ?? []],
    pageIndex: input.pageIndex,
    confidence: region.confidence,
    sourceRef: region.source,
    createdAt: undefined,
    updatedAt: undefined,
  };
};

const toCanonicalBounds = (
  normalized: Rect,
  pageBounds: { width: number; height: number },
): Rect => {
  const canonical = normalizedToCanonicalRect(normalized, pageBounds);
  return clampRectToPage(canonical, pageBounds);
};

const pdfObjectId = (documentId: string, pageIndex: number, kind: string, sourceId: string): string => {
  return `pdf:${sanitizeId(documentId)}:${pageIndex}:${kind}:${sanitizeId(sourceId)}`;
};

const sanitizeId = (value: string): string => (value.trim().length > 0 ? value.trim().replace(/[:\s]+/gu, "-") : "item");

const sanitizeDimension = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);
