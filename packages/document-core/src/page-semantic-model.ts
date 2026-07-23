import type { NormalizedPoint, NormalizedRect } from "@ggulnote/shared-types";
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
  LayoutBlock,
  LayoutColumn,
  LayoutRegion,
  PageSemanticModelData,
  SemanticCandidate,
  SemanticLine,
  SemanticModelQuery,
  SemanticModelQueryResult,
  SemanticObject,
  SemanticObjectType,
  SemanticParagraph,
  SemanticQueryOptions,
  SemanticSentence,
  SemanticWord,
} from "./types";

const DEFAULT_QUERY_LIMIT = 10;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const isRect = (value: unknown): value is NormalizedRect => {
  return isRecord(value)
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.width)
    && isFiniteNumber(value.height)
    && value.width > 0
    && value.height > 0;
};

const isObjectRecord = (value: unknown, type: SemanticObjectType): boolean => {
  return isRecord(value)
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
};

const isLayoutRecord = (value: unknown): boolean => {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.pageId === "string"
    && isRect(value.bounds)
    && isFiniteNumber(value.readingOrder);
};

const isModelData = (value: unknown): value is PageSemanticModelData => {
  if (!isRecord(value)) {
    return false;
  }

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
    && value.sentences.every((entry) =>
      isObjectRecord(entry, "SENTENCE")
      && isRecord(entry)
      && Array.isArray(entry.fragments)
      && entry.fragments.every(isRect))
    && Array.isArray(value.paragraphs)
    && value.paragraphs.every((entry) =>
      isObjectRecord(entry, "PARAGRAPH")
      && isRecord(entry)
      && Array.isArray(entry.fragments)
      && entry.fragments.every(isRect))
    && Array.isArray(value.layoutRegions)
    && value.layoutRegions.every(isLayoutRecord)
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
});

const matchesType = (
  types: readonly SemanticObjectType[] | undefined,
  type: SemanticObjectType,
): boolean => !types || types.length === 0 || types.includes(type);

const resolveLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_QUERY_LIMIT;
  }

  return Math.max(1, Math.floor(limit));
};

const getFragments = (item: SemanticObject): NormalizedRect[] => {
  if (item.type === "SENTENCE" || item.type === "PARAGRAPH") {
    return item.fragments.length > 0
      ? item.fragments.map(cloneRect)
      : [cloneRect(item.bounds)];
  }

  return [cloneRect(item.bounds)];
};

const getContainingTypeRank = (type: SemanticObjectType): number => {
  if (type === "SENTENCE") return 0;
  if (type === "PARAGRAPH") return 1;
  if (type === "LINE") return 2;
  return 3;
};

const createCandidate = (
  item: SemanticObject,
  fragments: NormalizedRect[],
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
  fragments,
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
});

const sortCandidates = (
  left: SemanticCandidate,
  right: SemanticCandidate,
): number => {
  if (left.directHit !== right.directHit) {
    return left.directHit ? -1 : 1;
  }

  if (left.directHit && right.directHit) {
    const typeDelta = getContainingTypeRank(left.type) - getContainingTypeRank(right.type);
    if (typeDelta !== 0) return typeDelta;
  }

  if (left.distance !== right.distance) {
    return left.distance - right.distance;
  }

  if (left.fragmentOverlapRatio !== right.fragmentOverlapRatio) {
    return right.fragmentOverlapRatio - left.fragmentOverlapRatio;
  }

  const typeDelta = getContainingTypeRank(left.type) - getContainingTypeRank(right.type);
  return typeDelta !== 0 ? typeDelta : left.readingOrder - right.readingOrder;
};

export class PageSemanticModel implements SemanticModelQuery {
  private readonly wordMap: Map<string, SemanticWord>;
  private readonly lineMap: Map<string, SemanticLine>;
  private readonly sentenceMap: Map<string, SemanticSentence>;
  private readonly paragraphMap: Map<string, SemanticParagraph>;

  public constructor(private readonly data: PageSemanticModelData) {
    this.wordMap = new Map(data.words.map((item) => [item.id, item]));
    this.lineMap = new Map(data.lines.map((item) => [item.id, item]));
    this.sentenceMap = new Map(data.sentences.map((item) => [item.id, item]));
    this.paragraphMap = new Map(data.paragraphs.map((item) => [item.id, item]));
  }

  public static fromSerialized(serialized: unknown): PageSemanticModel {
    if (!isModelData(serialized)) {
      throw new Error("Unsupported or invalid semantic model cache");
    }

    return new PageSemanticModel(cloneData(serialized));
  }

  public getWord(id: string): SemanticWord | null {
    return this.wordMap.get(id) ?? null;
  }

  public getLine(id: string): SemanticLine | null {
    return this.lineMap.get(id) ?? null;
  }

  public getSentence(id: string): SemanticSentence | null {
    return this.sentenceMap.get(id) ?? null;
  }

  public getParagraph(id: string): SemanticParagraph | null {
    return this.paragraphMap.get(id) ?? null;
  }

  public getLayoutRegions(): readonly LayoutRegion[] {
    return this.data.layoutRegions;
  }

  public getLayoutBlocks(): readonly LayoutBlock[] {
    return this.data.layoutBlocks;
  }

  public getColumns(): readonly LayoutColumn[] {
    return this.data.columns;
  }

  public getAllByReadingOrder(): SemanticObject[] {
    return [
      ...this.wordMap.values(),
      ...this.lineMap.values(),
      ...this.sentenceMap.values(),
      ...this.paragraphMap.values(),
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
      sourceItemCount: this.data.sourceItemCount,
      processingDurationMs: this.data.processingDurationMs,
    };
  }

  public findAtPoint(
    point: NormalizedPoint,
    options: SemanticQueryOptions = {},
  ): SemanticCandidate[] {
    const minimumOverlap = options.minimumOverlapRatio ?? 0;
    const candidates: SemanticCandidate[] = [];

    for (const item of this.getAllByReadingOrder()) {
      if (!matchesType(options.types, item.type) || !containsPoint(item.bounds, point)) {
        continue;
      }

      const fragments = getFragments(item);
      if (!containsPointInRects(fragments, point)) {
        continue;
      }

      const fragmentOverlap = 1;
      if (fragmentOverlap < minimumOverlap) {
        continue;
      }

      candidates.push(createCandidate(item, fragments, true, 0, 1, fragmentOverlap));
    }

    return candidates.sort(sortCandidates).slice(0, resolveLimit(options.limit));
  }

  public findNearest(
    point: NormalizedPoint,
    options: SemanticQueryOptions = {},
  ): SemanticCandidate[] {
    const maximumDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
    const candidates: SemanticCandidate[] = [];

    for (const item of this.getAllByReadingOrder()) {
      if (!matchesType(options.types, item.type)) {
        continue;
      }

      const fragments = getFragments(item);
      const directHit = containsPointInRects(fragments, point);
      const distance = distancePointToRects(point, fragments);
      if (distance > maximumDistance) {
        continue;
      }

      candidates.push(createCandidate(
        item,
        fragments,
        directHit,
        distance,
        directHit ? 1 : 0,
        directHit ? 1 : 0,
      ));
    }

    return candidates.sort(sortCandidates).slice(0, resolveLimit(options.limit));
  }

  public findInRect(
    rect: NormalizedRect,
    options: SemanticQueryOptions = {},
  ): SemanticCandidate[] {
    const minimumOverlap = options.minimumOverlapRatio ?? 0;
    const candidates: SemanticCandidate[] = [];

    for (const item of this.getAllByReadingOrder()) {
      if (
        !matchesType(options.types, item.type)
        || intersectionArea(rect, item.bounds) <= 0
      ) {
        continue;
      }

      const fragments = getFragments(item);
      const fragmentOverlap = overlapRatioWithRects(rect, fragments);
      if (fragmentOverlap <= 0 || fragmentOverlap < minimumOverlap) {
        continue;
      }

      const envelopeOverlap = overlapRatio(rect, item.bounds);
      candidates.push(createCandidate(
        item,
        fragments,
        true,
        0,
        envelopeOverlap,
        fragmentOverlap,
      ));
    }

    return candidates
      .sort((left, right) => {
        if (left.fragmentOverlapRatio !== right.fragmentOverlapRatio) {
          return right.fragmentOverlapRatio - left.fragmentOverlapRatio;
        }
        return sortCandidates(left, right);
      })
      .slice(0, resolveLimit(options.limit));
  }

  public toSerialized(): PageSemanticModelData {
    return cloneData(this.data);
  }
}

export default PageSemanticModel;
