import type { NormalizedPoint, NormalizedRect, PageId } from "@ggulnote/shared-types";
import { SEMANTIC_EXTRACTOR_VERSION, SEMANTIC_SCHEMA_VERSION } from "./constants";
import {
  containsPoint,
  containsPointInRects,
  distancePointToRects,
  intersectionArea,
  overlapRatio,
  overlapRatioWithRects,
  sortByReadingPoint,
} from "./geometry";
import type {
  FormFieldRow,
  LayoutBlock,
  LayoutColumn,
  LayoutRegion,
  LayoutRegionType,
  PageSemanticModelData,
  RegionEvidenceSource,
  SemanticCandidate,
  SemanticLine,
  SemanticModelQuery,
  SemanticModelQueryResult,
  SemanticObject,
  SemanticObjectType,
  SemanticParagraph,
  SemanticQueryObjectType,
  SemanticQueryOptions,
  SemanticSentence,
  SemanticTable,
  SemanticWord,
} from "./types";

const DEFAULT_QUERY_LIMIT = 10;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isRect = (value: unknown): value is NormalizedRect =>
  isRecord(value)
  && isFiniteNumber(value.x)
  && isFiniteNumber(value.y)
  && isFiniteNumber(value.width)
  && isFiniteNumber(value.height)
  && value.width > 0
  && value.height > 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isObjectRecord = (value: unknown, type: SemanticObjectType): boolean =>
  isRecord(value)
  && value.type === type
  && typeof value.id === "string"
  && typeof value.pageId === "string"
  && typeof value.text === "string"
  && isRect(value.bounds)
  && isFiniteNumber(value.readingOrder)
  && isRecord(value.orientation)
  && isFiniteNumber(value.orientation.angle)
  && typeof value.regionId === "string"
  && typeof value.blockId === "string"
  && typeof value.columnId === "string";

const isLayoutRecord = (value: unknown): boolean =>
  isRecord(value)
  && typeof value.id === "string"
  && typeof value.pageId === "string"
  && isRect(value.bounds)
  && isFiniteNumber(value.readingOrder);

const isRegionType = (value: unknown): value is LayoutRegionType =>
  value === "heading"
  || value === "prose"
  || value === "form"
  || value === "table"
  || value === "footer"
  || value === "metadata"
  || value === "unknown";

const isRegionSource = (value: unknown): value is RegionEvidenceSource =>
  value === "geometry" || value === "pdf-vector" || value === "vision";

const hasFragments = (value: unknown): boolean =>
  isRecord(value)
  && Array.isArray(value.fragments)
  && value.fragments.every(isRect);

const isLayoutRegionRecord = (value: unknown): boolean =>
  isLayoutRecord(value)
  && isRecord(value)
  && isRegionType(value.type)
  && isRegionSource(value.source)
  && isFiniteNumber(value.confidence)
  && isStringArray(value.lineFragmentIds)
  && isStringArray(value.lineIds)
  && isStringArray(value.blockIds)
  && isStringArray(value.columnIds);

const isModelData = (value: unknown): value is PageSemanticModelData => {
  if (!isRecord(value)) return false;

  return value.schemaVersion === SEMANTIC_SCHEMA_VERSION
    && value.extractorVersion === SEMANTIC_EXTRACTOR_VERSION
    && typeof value.documentId === "string"
    && typeof value.pageId === "string"
    && isFiniteNumber(value.pageNumber)
    && typeof value.sourceSignature === "string"
    && Array.isArray(value.words)
    && value.words.every((entry) => isObjectRecord(entry, "WORD"))
    && Array.isArray(value.lines)
    && value.lines.every((entry) => isObjectRecord(entry, "LINE"))
    && Array.isArray(value.sentences)
    && value.sentences.every((entry) => isObjectRecord(entry, "SENTENCE") && hasFragments(entry))
    && Array.isArray(value.paragraphs)
    && value.paragraphs.every((entry) => isObjectRecord(entry, "PARAGRAPH") && hasFragments(entry))
    && Array.isArray(value.formFields)
    && value.formFields.every((entry) =>
      isObjectRecord(entry, "FORM_FIELD")
      && hasFragments(entry)
      && isRecord(entry)
      && isStringArray(entry.wordIds)
      && isStringArray(entry.lineIds)
      && isStringArray(entry.markerWordIds)
      && isStringArray(entry.labelWordIds)
      && isStringArray(entry.valueWordIds))
    && Array.isArray(value.tables)
    && value.tables.every((entry) =>
      isObjectRecord(entry, "TABLE")
      && hasFragments(entry)
      && isRecord(entry)
      && isStringArray(entry.wordIds)
      && isStringArray(entry.lineIds))
    && Array.isArray(value.layoutRegions)
    && value.layoutRegions.every(isLayoutRegionRecord)
    && Array.isArray(value.layoutBlocks)
    && value.layoutBlocks.every(isLayoutRecord)
    && Array.isArray(value.columns)
    && value.columns.every(isLayoutRecord)
    && isFiniteNumber(value.createdAt)
    && isFiniteNumber(value.sourceItemCount)
    && isFiniteNumber(value.processingDurationMs);
};

const cloneRect = (rect: NormalizedRect): NormalizedRect => ({ ...rect });

const cloneData = (data: PageSemanticModelData): PageSemanticModelData => ({
  ...data,
  words: data.words.map((word) => ({
    ...word,
    bounds: cloneRect(word.bounds),
    orientation: { ...word.orientation },
    sourceItemIds: [...word.sourceItemIds],
    sourceRanges: word.sourceRanges.map((range) => ({ ...range })),
    axis: { ...word.axis },
    quad: {
      points: word.quad.points.map((point) => ({ ...point })) as SemanticWord["quad"]["points"],
    },
  })),
  lines: data.lines.map((line) => ({
    ...line,
    bounds: cloneRect(line.bounds),
    orientation: { ...line.orientation },
    wordIds: [...line.wordIds],
    axis: { ...line.axis },
    horizontalGaps: [...line.horizontalGaps],
  })),
  layoutRegions: data.layoutRegions.map((region) => ({
    ...region,
    bounds: cloneRect(region.bounds),
    orientation: { ...region.orientation },
    lineFragmentIds: [...region.lineFragmentIds],
    lineIds: [...region.lineIds],
    blockIds: [...region.blockIds],
    columnIds: [...region.columnIds],
  })),
  layoutBlocks: data.layoutBlocks.map((block) => ({
    ...block,
    bounds: cloneRect(block.bounds),
    orientation: { ...block.orientation },
    lineIds: [...block.lineIds],
  })),
  columns: data.columns.map((column) => ({
    ...column,
    bounds: cloneRect(column.bounds),
    orientation: { ...column.orientation },
    blockIds: [...column.blockIds],
    lineIds: [...column.lineIds],
  })),
  sentences: data.sentences.map((sentence) => ({
    ...sentence,
    bounds: cloneRect(sentence.bounds),
    fragments: sentence.fragments.map(cloneRect),
    orientation: { ...sentence.orientation },
    wordIds: [...sentence.wordIds],
    lineIds: [...sentence.lineIds],
  })),
  paragraphs: data.paragraphs.map((paragraph) => ({
    ...paragraph,
    bounds: cloneRect(paragraph.bounds),
    fragments: paragraph.fragments.map(cloneRect),
    orientation: { ...paragraph.orientation },
    lineIds: [...paragraph.lineIds],
    sentenceIds: [...paragraph.sentenceIds],
  })),
  formFields: data.formFields.map((field) => ({
    ...field,
    bounds: cloneRect(field.bounds),
    fragments: field.fragments.map(cloneRect),
    orientation: { ...field.orientation },
    wordIds: [...field.wordIds],
    lineIds: [...field.lineIds],
    markerWordIds: [...field.markerWordIds],
    labelWordIds: [...field.labelWordIds],
    valueWordIds: [...field.valueWordIds],
  })),
  tables: data.tables.map((table) => ({
    ...table,
    bounds: cloneRect(table.bounds),
    fragments: table.fragments.map(cloneRect),
    orientation: { ...table.orientation },
    wordIds: [...table.wordIds],
    lineIds: [...table.lineIds],
  })),
});

const matchesType = (
  types: readonly SemanticQueryObjectType[] | undefined,
  type: SemanticQueryObjectType,
): boolean => !types || types.length === 0 || types.includes(type);

const resolveLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_QUERY_LIMIT;
  return Math.max(1, Math.floor(limit));
};

const getFragments = (item: SemanticObject): NormalizedRect[] => {
  if (
    item.type === "SENTENCE"
    || item.type === "PARAGRAPH"
    || item.type === "FORM_FIELD"
    || item.type === "TABLE"
  ) {
    return item.fragments.length > 0 ? item.fragments.map(cloneRect) : [cloneRect(item.bounds)];
  }
  return [cloneRect(item.bounds)];
};

interface QueryItem {
  id: string;
  type: SemanticQueryObjectType;
  pageId: PageId;
  text: string;
  bounds: NormalizedRect;
  fragments: NormalizedRect[];
  readingOrder: number;
  confidence: number;
  regionId: string;
  blockId: string;
  columnId: string;
  regionType?: LayoutRegionType;
  source?: RegionEvidenceSource;
}

const createCandidate = (
  item: QueryItem,
  directHit: boolean,
  distance: number,
  envelopeOverlap: number,
  fragmentOverlap: number,
): SemanticCandidate => ({
  id: item.id,
  type: item.type,
  pageId: item.pageId,
  text: item.text,
  bounds: cloneRect(item.bounds),
  fragments: item.fragments.map(cloneRect),
  containsPoint: directHit,
  directHit,
  distance,
  overlapRatio: envelopeOverlap,
  fragmentOverlapRatio: fragmentOverlap,
  readingOrder: item.readingOrder,
  confidence: item.confidence,
  regionId: item.regionId,
  blockId: item.blockId,
  columnId: item.columnId,
  regionType: item.regionType,
  source: item.source,
});

const defaultTypeRank = (type: SemanticQueryObjectType): number => {
  if (type === "SENTENCE") return 0;
  if (type === "PARAGRAPH") return 1;
  if (type === "LINE") return 2;
  if (type === "WORD") return 3;
  if (type === "FORM_FIELD" || type === "TABLE") return 4;
  return 5;
};

const structuredTypeRank = (type: SemanticQueryObjectType): number => {
  if (type === "WORD") return 0;
  if (type === "FORM_FIELD" || type === "TABLE") return 1;
  if (type === "REGION") return 2;
  if (type === "LINE") return 3;
  if (type === "SENTENCE") return 4;
  return 5;
};

const sortCandidateList = (candidates: SemanticCandidate[]): SemanticCandidate[] => {
  const structured = candidates.some((candidate) =>
    candidate.type === "FORM_FIELD" || candidate.type === "TABLE");
  return candidates.sort((left, right) => {
    if (left.directHit !== right.directHit) return left.directHit ? -1 : 1;
    if (left.directHit && right.directHit) {
      const rank = structured
        ? structuredTypeRank(left.type) - structuredTypeRank(right.type)
        : defaultTypeRank(left.type) - defaultTypeRank(right.type);
      if (rank !== 0) return rank;
    }
    if (left.distance !== right.distance) return left.distance - right.distance;
    if (left.fragmentOverlapRatio !== right.fragmentOverlapRatio) {
      return right.fragmentOverlapRatio - left.fragmentOverlapRatio;
    }
    const rank = structured
      ? structuredTypeRank(left.type) - structuredTypeRank(right.type)
      : defaultTypeRank(left.type) - defaultTypeRank(right.type);
    return rank !== 0 ? rank : left.readingOrder - right.readingOrder;
  });
};

export class PageSemanticModel implements SemanticModelQuery {
  private readonly wordMap: Map<string, SemanticWord>;
  private readonly lineMap: Map<string, SemanticLine>;
  private readonly sentenceMap: Map<string, SemanticSentence>;
  private readonly paragraphMap: Map<string, SemanticParagraph>;
  private readonly formFieldMap: Map<string, FormFieldRow>;
  private readonly tableMap: Map<string, SemanticTable>;
  private readonly regionMap: Map<string, LayoutRegion>;

  public constructor(private readonly data: PageSemanticModelData) {
    this.wordMap = new Map(data.words.map((item) => [item.id, item]));
    this.lineMap = new Map(data.lines.map((item) => [item.id, item]));
    this.sentenceMap = new Map(data.sentences.map((item) => [item.id, item]));
    this.paragraphMap = new Map(data.paragraphs.map((item) => [item.id, item]));
    this.formFieldMap = new Map(data.formFields.map((item) => [item.id, item]));
    this.tableMap = new Map(data.tables.map((item) => [item.id, item]));
    this.regionMap = new Map(data.layoutRegions.map((item) => [item.id, item]));
  }

  public static fromSerialized(serialized: unknown): PageSemanticModel {
    if (!isModelData(serialized)) throw new Error("Unsupported or invalid semantic model cache");
    return new PageSemanticModel(cloneData(serialized));
  }

  public getWord(id: string): SemanticWord | null { return this.wordMap.get(id) ?? null; }
  public getLine(id: string): SemanticLine | null { return this.lineMap.get(id) ?? null; }
  public getSentence(id: string): SemanticSentence | null { return this.sentenceMap.get(id) ?? null; }
  public getParagraph(id: string): SemanticParagraph | null { return this.paragraphMap.get(id) ?? null; }
  public getFormField(id: string): FormFieldRow | null { return this.formFieldMap.get(id) ?? null; }
  public getTable(id: string): SemanticTable | null { return this.tableMap.get(id) ?? null; }
  public getLayoutRegion(id: string): LayoutRegion | null { return this.regionMap.get(id) ?? null; }
  public getFormFields(): readonly FormFieldRow[] { return this.data.formFields; }
  public getTables(): readonly SemanticTable[] { return this.data.tables; }
  public getLayoutRegions(): readonly LayoutRegion[] { return this.data.layoutRegions; }
  public getLayoutBlocks(): readonly LayoutBlock[] { return this.data.layoutBlocks; }
  public getColumns(): readonly LayoutColumn[] { return this.data.columns; }

  public getAllByReadingOrder(): SemanticObject[] {
    return [
      ...this.wordMap.values(),
      ...this.lineMap.values(),
      ...this.sentenceMap.values(),
      ...this.paragraphMap.values(),
      ...this.formFieldMap.values(),
      ...this.tableMap.values(),
    ].sort((left, right) => {
      const order = sortByReadingPoint(left, right);
      return order !== 0 ? order : left.type.localeCompare(right.type);
    });
  }

  public getSummary(): SemanticModelQueryResult {
    return {
      wordCount: this.data.words.length,
      lineCount: this.data.lines.length,
      sentenceCount: this.data.sentences.length,
      paragraphCount: this.data.paragraphs.length,
      regionCount: this.data.layoutRegions.length,
      blockCount: this.data.layoutBlocks.length,
      columnCount: this.data.columns.length,
      formFieldCount: this.data.formFields.length,
      tableCount: this.data.tables.length,
      sourceItemCount: this.data.sourceItemCount,
      processingDurationMs: this.data.processingDurationMs,
    };
  }

  private getQueryItems(): QueryItem[] {
    const semanticItems = this.getAllByReadingOrder().map((item): QueryItem => ({
      id: item.id,
      type: item.type,
      pageId: item.pageId,
      text: item.text,
      bounds: cloneRect(item.bounds),
      fragments: getFragments(item),
      readingOrder: item.readingOrder,
      confidence: item.confidence,
      regionId: item.regionId,
      blockId: item.blockId,
      columnId: item.columnId,
      regionType: this.regionMap.get(item.regionId)?.type,
      source: this.regionMap.get(item.regionId)?.source,
    }));
    const regionItems = this.data.layoutRegions.map((region): QueryItem => ({
      id: region.id,
      type: "REGION",
      pageId: region.pageId,
      text: region.type,
      bounds: cloneRect(region.bounds),
      fragments: [cloneRect(region.bounds)],
      readingOrder: region.readingOrder,
      confidence: region.confidence,
      regionId: region.id,
      blockId: "",
      columnId: "",
      regionType: region.type,
      source: region.source,
    }));
    return [...semanticItems, ...regionItems];
  }

  public findAtPoint(point: NormalizedPoint, options: SemanticQueryOptions = {}): SemanticCandidate[] {
    const minimumOverlap = options.minimumOverlapRatio ?? 0;
    const candidates: SemanticCandidate[] = [];
    for (const item of this.getQueryItems()) {
      if (!matchesType(options.types, item.type) || !containsPoint(item.bounds, point)) continue;
      if (!containsPointInRects(item.fragments, point) || 1 < minimumOverlap) continue;
      candidates.push(createCandidate(item, true, 0, 1, 1));
    }
    return sortCandidateList(candidates).slice(0, resolveLimit(options.limit));
  }

  public findNearest(point: NormalizedPoint, options: SemanticQueryOptions = {}): SemanticCandidate[] {
    const maximumDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
    const candidates: SemanticCandidate[] = [];
    for (const item of this.getQueryItems()) {
      if (!matchesType(options.types, item.type)) continue;
      const directHit = containsPointInRects(item.fragments, point);
      const distance = distancePointToRects(point, item.fragments);
      if (distance > maximumDistance) continue;
      candidates.push(createCandidate(item, directHit, distance, directHit ? 1 : 0, directHit ? 1 : 0));
    }
    return sortCandidateList(candidates).slice(0, resolveLimit(options.limit));
  }

  public findInRect(rect: NormalizedRect, options: SemanticQueryOptions = {}): SemanticCandidate[] {
    const minimumOverlap = options.minimumOverlapRatio ?? 0;
    const candidates: SemanticCandidate[] = [];
    for (const item of this.getQueryItems()) {
      if (!matchesType(options.types, item.type) || intersectionArea(rect, item.bounds) <= 0) continue;
      const fragmentOverlap = overlapRatioWithRects(rect, item.fragments);
      if (fragmentOverlap <= 0 || fragmentOverlap < minimumOverlap) continue;
      candidates.push(createCandidate(
        item,
        true,
        0,
        overlapRatio(rect, item.bounds),
        fragmentOverlap,
      ));
    }
    return sortCandidateList(candidates)
      .sort((left, right) => right.fragmentOverlapRatio - left.fragmentOverlapRatio)
      .slice(0, resolveLimit(options.limit));
  }

  public toSerialized(): PageSemanticModelData { return cloneData(this.data); }
}

export default PageSemanticModel;