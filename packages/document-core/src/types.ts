import type { NormalizedPoint, NormalizedRect, DocumentId, PageId } from "@ggulnote/shared-types";

export type TextDirection = "ltr" | "rtl" | "ttb";

export type SemanticObjectType = "WORD" | "LINE" | "SENTENCE" | "PARAGRAPH";

export interface SemanticObjectBase {
  id: string;
  type: SemanticObjectType;
  pageId: PageId;
  text: string;
  normalizedText: string;
  bounds: NormalizedRect;
  readingOrder: number;
  confidence: number;
}

export interface SemanticWord extends SemanticObjectBase {
  type: "WORD";
  sourceItemIds: string[];
  lineId: string;
  direction: TextDirection;
  fontName?: string;
  fontSize?: number;
  startsWithPunctuation: boolean;
  endsWithPunctuation: boolean;
}

export interface SemanticLine extends SemanticObjectBase {
  type: "LINE";
  wordIds: string[];
  paragraphId: string | null;
  baseline: number;
  direction: TextDirection;
  averageFontSize?: number;
  columnIndex: number;
}

export interface SemanticSentence extends SemanticObjectBase {
  type: "SENTENCE";
  wordIds: string[];
  lineIds: string[];
  paragraphId: string | null;
  startWordId: string;
  endWordId: string;
}

export interface SemanticParagraph extends SemanticObjectBase {
  type: "PARAGRAPH";
  lineIds: string[];
  sentenceIds: string[];
  columnIndex: number;
  averageFontSize?: number;
}

export interface SemanticCandidate {
  id: string;
  type: SemanticObjectType;
  pageId: PageId;
  text: string;
  bounds: NormalizedRect;
  containsPoint: boolean;
  distance: number;
  overlapRatio: number;
  readingOrder: number;
  confidence: number;
}

export interface SemanticQueryOptions {
  types?: SemanticObjectType[];
  limit?: number;
  maxDistance?: number;
  minimumOverlapRatio?: number;
}

export interface PageTextItemInput {
  id: string;
  text: string;
  bounds: NormalizedRect;
  sourceIndex: number;
  fontName?: string;
  fontSize?: number;
  direction?: TextDirection;
}

export interface BuildPageInput {
  documentId: DocumentId;
  pageId: PageId;
  pageNumber: number;
  textItems: PageTextItemInput[];
  extractorVersion?: string;
  schemaVersion?: number;
}

export interface PageSemanticModelData {
  schemaVersion: number;
  extractorVersion: string;
  documentId: DocumentId;
  pageId: PageId;
  pageNumber: number;
  words: SemanticWord[];
  lines: SemanticLine[];
  sentences: SemanticSentence[];
  paragraphs: SemanticParagraph[];
  createdAt: number;
  sourceItemCount: number;
  processingDurationMs: number;
}

export interface SerializedSemanticPage extends PageSemanticModelData {}

export interface SemanticModelQueryResult {
  wordCount: number;
  lineCount: number;
  sentenceCount: number;
  paragraphCount: number;
  columnCount: number;
  sourceItemCount: number;
  processingDurationMs: number;
}

export interface SemanticModelQuery {
  getWord(id: string): SemanticWord | null;
  getLine(id: string): SemanticLine | null;
  getSentence(id: string): SemanticSentence | null;
  getParagraph(id: string): SemanticParagraph | null;
  getAllByReadingOrder(): SemanticObjectBase[];
  getSummary(): SemanticModelQueryResult;
  findAtPoint(point: NormalizedPoint, options?: SemanticQueryOptions): SemanticCandidate[];
  findNearest(point: NormalizedPoint, options?: SemanticQueryOptions): SemanticCandidate[];
  findInRect(rect: NormalizedRect, options?: SemanticQueryOptions): SemanticCandidate[];
}

export interface SemanticBuildResult extends PageSemanticModelData, SemanticModelQuery {}
