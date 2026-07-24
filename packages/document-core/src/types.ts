import type { DocumentId, NormalizedPoint, NormalizedRect, PageId } from "@ggulnote/shared-types";

export type TextDirection = "ltr" | "rtl" | "ttb";
export type TextWritingMode = "horizontal" | "vertical" | "rotated";

export interface TextOrientation {
  angle: number;
  writingMode: TextWritingMode;
}

export interface LocalTextAxis {
  advanceX: number;
  advanceY: number;
  normalX: number;
  normalY: number;
}

export interface TextQuad {
  points: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];
}

export interface WordSourceRange {
  sourceTextItemId: string;
  startOffset: number;
  endOffset: number;
}

export interface SemanticGeometry {
  bounds: NormalizedRect;
  fragments: NormalizedRect[];
}

export type SemanticObjectType = "WORD" | "LINE" | "SENTENCE" | "PARAGRAPH";
export type SemanticCandidateType = SemanticObjectType | "LAYOUT_REGION";
export type LayoutBlockType =
  | "heading"
  | "body"
  | "sidebar"
  | "caption"
  | "list"
  | "metadata"
  | "unknown";

export interface SemanticObjectBase {
  id: string;
  type: SemanticObjectType;
  pageId: PageId;
  text: string;
  normalizedText: string;
  bounds: NormalizedRect;
  readingOrder: number;
  confidence: number;
  orientation: TextOrientation;
  regionId: string;
  blockId: string;
  columnId: string;
}

export interface SemanticWord extends SemanticObjectBase {
  type: "WORD";
  sourceItemIds: string[];
  sourceRanges: WordSourceRange[];
  lineId: string;
  direction: TextDirection;
  fontName?: string;
  fontSize?: number;
  startsWithPunctuation: boolean;
  endsWithPunctuation: boolean;
  hasEOL: boolean;
  axis: LocalTextAxis;
  quad: TextQuad;
}

export interface SemanticLine extends SemanticObjectBase {
  type: "LINE";
  wordIds: string[];
  paragraphId: string | null;
  baseline: number;
  direction: TextDirection;
  averageFontSize?: number;
  columnIndex: number;
  axis: LocalTextAxis;
  horizontalGaps: number[];
}

export interface SemanticSentence extends SemanticObjectBase, SemanticGeometry {
  type: "SENTENCE";
  wordIds: string[];
  lineIds: string[];
  paragraphId: string;
  startWordId: string;
  endWordId: string;
}

export interface SemanticParagraph extends SemanticObjectBase, SemanticGeometry {
  type: "PARAGRAPH";
  lineIds: string[];
  sentenceIds: string[];
  columnIndex: number;
  averageFontSize?: number;
}

export type SemanticObject = SemanticWord | SemanticLine | SemanticSentence | SemanticParagraph;

export type LayoutRegionType =
  | "text"
  | "title"
  | "section-header"
  | "list-item"
  | "caption"
  | "footnote"
  | "page-header"
  | "page-footer"
  | "table"
  | "picture"
  | "formula"
  | "unknown";

export type PageSemanticSource = "yolo-region" | "legacy-semantic-fallback";
export type RegionTextSource = "pdf-text" | "ocr";
export type LayoutRegionSource = "yolo" | "legacy";
export type LayoutRegionRelationType = "caption" | "section-header";

export interface DetectedLayoutRegionInput {
  id: string;
  label: string;
  classId?: number;
  layoutType?: LayoutRegionType;
  bounds: NormalizedRect;
  confidence: number;
  modelId?: string;
}

export interface LayoutSourceDetection {
  detectionId: string;
  modelId?: string;
  classId?: number;
  label: string;
  bounds: NormalizedRect;
}

export interface RegionTextContent {
  text: string;
  paragraphIds: string[];
  lineIds: string[];
  wordIds: string[];
  source: RegionTextSource;
}

export interface RegionMediaContent {
  cropBounds: NormalizedRect;
  embeddedWordIds: string[];
}

export interface LayoutRegionRelation {
  type: LayoutRegionRelationType;
  targetRegionId: string;
  distance: number;
}

export interface LayoutRegion {
  id: string;
  pageId: PageId;
  bounds: NormalizedRect;
  orientation: TextOrientation;
  blockIds: string[];
  columnIds: string[];
  readingOrder: number;
  layoutType: LayoutRegionType;
  confidence: number;
  source: LayoutRegionSource;
  sourceDetection?: LayoutSourceDetection;
  textContent?: RegionTextContent;
  mediaContent?: RegionMediaContent;
  relatedRegionIds: string[];
  relations: LayoutRegionRelation[];
}

export interface LayoutColumn {
  id: string;
  pageId: PageId;
  regionId: string;
  bounds: NormalizedRect;
  orientation: TextOrientation;
  blockIds: string[];
  lineIds: string[];
  columnIndex: number;
  readingOrder: number;
}

export interface LayoutBlock {
  id: string;
  pageId: PageId;
  regionId: string;
  type: LayoutBlockType;
  orientation: TextOrientation;
  bounds: NormalizedRect;
  lineIds: string[];
  columnId: string;
  readingOrder: number;
}

export interface SemanticCandidate {
  id: string;
  type: SemanticCandidateType;
  layoutType?: LayoutRegionType;
  pageId: PageId;
  text: string;
  bounds: NormalizedRect;
  fragments: NormalizedRect[];
  containsPoint: boolean;
  directHit: boolean;
  distance: number;
  overlapRatio: number;
  fragmentOverlapRatio: number;
  readingOrder: number;
  confidence: number;
  regionId: string;
  blockId: string;
  columnId: string;
}

export interface SemanticQueryOptions {
  types?: readonly SemanticCandidateType[];
  layoutTypes?: readonly LayoutRegionType[];
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
  hasEOL?: boolean;
  transform?: [number, number, number, number, number, number];
  pdfWidth?: number;
  pdfHeight?: number;
  orientation?: TextOrientation;
  axis?: LocalTextAxis;
  quad?: TextQuad;
}

export interface BuildPageInput {
  documentId: DocumentId;
  pageId: PageId;
  pageNumber: number;
  textItems: PageTextItemInput[];
  layoutDetections?: DetectedLayoutRegionInput[];
  layoutModelId?: string;
  layoutStrategy?: PageSemanticSource;
  minimumLayoutConfidence?: number;
  minimumWordAssignmentRatio?: number;
  extractorVersion?: string;
  schemaVersion?: number;
}

export interface PageSemanticModelData {
  schemaVersion: number;
  extractorVersion: string;
  documentId: DocumentId;
  pageId: PageId;
  pageNumber: number;
  sourceSignature: string;
  semanticSource: PageSemanticSource;
  readingOrder: string[];
  words: SemanticWord[];
  unassignedWords: SemanticWord[];
  lines: SemanticLine[];
  layoutRegions: LayoutRegion[];
  layoutBlocks: LayoutBlock[];
  columns: LayoutColumn[];
  sentences: SemanticSentence[];
  paragraphs: SemanticParagraph[];
  createdAt: number;
  sourceItemCount: number;
  processingDurationMs: number;
}

export type SerializedSemanticPage = PageSemanticModelData;

export interface SemanticModelQueryResult {
  wordCount: number;
  lineCount: number;
  sentenceCount: number;
  paragraphCount: number;
  regionCount: number;
  blockCount: number;
  columnCount: number;
  sourceItemCount: number;
  processingDurationMs: number;
  unassignedWordCount: number;
  semanticSource: PageSemanticSource;
}

export interface SemanticTextPath {
  region: LayoutRegion | null;
  line: SemanticLine | null;
  word: SemanticWord | null;
}

export interface SemanticModelQuery {
  getWord(id: string): SemanticWord | null;
  getLine(id: string): SemanticLine | null;
  getSentence(id: string): SemanticSentence | null;
  getParagraph(id: string): SemanticParagraph | null;
  getLayoutRegion(id: string): LayoutRegion | null;
  getLayoutRegions(): readonly LayoutRegion[];
  getRegionReadingOrder(): readonly string[];
  getUnassignedWords(): readonly SemanticWord[];
  getSemanticSource(): PageSemanticSource;
  getLayoutBlocks(): readonly LayoutBlock[];
  getColumns(): readonly LayoutColumn[];
  getAllByReadingOrder(): SemanticObject[];
  getSummary(): SemanticModelQueryResult;
  findRegionAtPoint(point: NormalizedPoint): LayoutRegion | null;
  findTextPathAtPoint(point: NormalizedPoint): SemanticTextPath;
  findAtPoint(point: NormalizedPoint, options?: SemanticQueryOptions): SemanticCandidate[];
  findNearest(point: NormalizedPoint, options?: SemanticQueryOptions): SemanticCandidate[];
  findInRect(rect: NormalizedRect, options?: SemanticQueryOptions): SemanticCandidate[];
}

export interface SemanticBuildResult extends PageSemanticModelData, SemanticModelQuery {}
