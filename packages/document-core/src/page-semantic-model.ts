import type { NormalizedPoint, NormalizedRect } from "@ggulnote/shared-types";
import { SEMANTIC_EXTRACTOR_VERSION, SEMANTIC_SCHEMA_VERSION } from "./constants";
import {
  area,
  containsPoint,
  containsPointInRects,
  distancePointToRect,
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
  SemanticCandidateType,
  SemanticLine,
  SemanticModelQuery,
  SemanticModelQueryResult,
  SemanticObject,
  SemanticObjectType,
  SemanticParagraph,
  SemanticQueryOptions,
  SemanticSentence,
  SemanticTextPath,
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

const isLayoutRegionRecord = (value: unknown): boolean => {
  return isLayoutRecord(value)
    && isRecord(value)
    && typeof value.layoutType === "string"
    && isFiniteNumber(value.confidence)
    && (value.source === "yolo" || value.source === "legacy")
    && Array.isArray(value.relatedRegionIds)
    && value.relatedRegionIds.every((entry) => typeof entry === "string")
    && Array.isArray(value.relations)
    && value.relations.every((entry) => isRecord(entry)
      && (entry.type === "caption" || entry.type === "section-header")
      && typeof entry.targetRegionId === "string"
      && isFiniteNumber(entry.distance));
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
    && (value.semanticSource === "yolo-region" || value.semanticSource === "legacy-semantic-fallback")
    && Array.isArray(value.readingOrder)
    && value.readingOrder.every((entry) => typeof entry === "string")
    && Array.isArray(value.words)
    && value.words.every((entry) => isObjectRecord(entry, "WORD"))
    && Array.isArray(value.unassignedWords)
    && value.unassignedWords.every((entry) => isObjectRecord(entry, "WORD"))
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

const cloneWord = (word: SemanticWord): SemanticWord => ({
  ...word,
  bounds: cloneRect(word.bounds),
  orientation: { ...word.orientation },
  sourceItemIds: [...word.sourceItemIds],
  sourceRanges: word.sourceRanges.map((range) => ({ ...range })),
  axis: { ...word.axis },
  quad: {
    points: word.quad.points.map((point) => ({ ...point })) as SemanticWord["quad"]["points"],
  },
});

const cloneData = (data: PageSemanticModelData): PageSemanticModelData => ({
  ...data,
  readingOrder: [...data.readingOrder],
  words: data.words.map(cloneWord),
  unassignedWords: data.unassignedWords.map(cloneWord),
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
    sourceDetection: region.sourceDetection ? {
      ...region.sourceDetection,
      bounds: cloneRect(region.sourceDetection.bounds),
    } : undefined,
    textContent: region.textContent ? {
      ...region.textContent,
      paragraphIds: [...region.textContent.paragraphIds],
      lineIds: [...region.textContent.lineIds],
      wordIds: [...region.textContent.wordIds],
    } : undefined,
    mediaContent: region.mediaContent ? {
      cropBounds: cloneRect(region.mediaContent.cropBounds),
      embeddedWordIds: [...region.mediaContent.embeddedWordIds],
    } : undefined,
    relatedRegionIds: [...region.relatedRegionIds],
    relations: region.relations.map((relation) => ({ ...relation })),
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
  types: readonly SemanticCandidateType[] | undefined,
  type: SemanticCandidateType,
): boolean => !types || types.length === 0 || types.includes(type);

const matchesLayoutType = (
  types: SemanticQueryOptions["layoutTypes"],
  region: LayoutRegion,
): boolean => !types || types.length === 0 || types.includes(region.layoutType);

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

const getContainingTypeRank = (type: SemanticCandidateType): number => {
  if (type === "SENTENCE") return 0;
  if (type === "PARAGRAPH") return 1;
  if (type === "LINE") return 2;
  if (type === "WORD") return 3;
  return 4;
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

const createRegionCandidate = (
  region: LayoutRegion,
  text: string,
  directHit: boolean,
  distance: number,
  envelopeOverlap: number,
): SemanticCandidate => ({
  id: region.id,
  type: "LAYOUT_REGION",
  layoutType: region.layoutType,
  pageId: region.pageId,
  text,
  bounds: cloneRect(region.bounds),
  fragments: [cloneRect(region.bounds)],
  containsPoint: directHit,
  directHit,
  distance,
  overlapRatio: envelopeOverlap,
  fragmentOverlapRatio: envelopeOverlap,
  readingOrder: region.readingOrder,
  confidence: region.confidence,
  regionId: region.id,
  blockId: "",
  columnId: "",
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
  private readonly regionMap: Map<string, LayoutRegion>;

  public constructor(private readonly data: PageSemanticModelData) {
    this.wordMap = new Map([...data.words, ...data.unassignedWords].map((item) => [item.id, item]));
    this.lineMap = new Map(data.lines.map((item) => [item.id, item]));
    this.sentenceMap = new Map(data.sentences.map((item) => [item.id, item]));
    this.paragraphMap = new Map(data.paragraphs.map((item) => [item.id, item]));
    this.regionMap = new Map(data.layoutRegions.map((item) => [item.id, item]));
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

  public getLayoutRegion(id: string): LayoutRegion | null {
    return this.regionMap.get(id) ?? null;
  }

  public getLayoutRegions(): readonly LayoutRegion[] {
    return this.data.layoutRegions;
  }

  public getRegionReadingOrder(): readonly string[] {
    return this.data.readingOrder;
  }

  public getUnassignedWords(): readonly SemanticWord[] {
    return this.data.unassignedWords;
  }

  public getSemanticSource(): PageSemanticModelData["semanticSource"] {
    return this.data.semanticSource;
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
      unassignedWordCount: this.data.unassignedWords.length,
      semanticSource: this.data.semanticSource,
    };
  }

  public findRegionAtPoint(point: NormalizedPoint): LayoutRegion | null {
    return [...this.data.layoutRegions]
      .filter((region) => containsPoint(region.bounds, point))
      .sort((left, right) => {
        const areaDelta = area(left.bounds) - area(right.bounds);
        if (Math.abs(areaDelta) > Number.EPSILON) return areaDelta;
        if (left.confidence !== right.confidence) return right.confidence - left.confidence;
        return left.readingOrder - right.readingOrder;
      })[0] ?? null;
  }

  public findTextPathAtPoint(point: NormalizedPoint): SemanticTextPath {
    const region = this.findRegionAtPoint(point);
    if (!region) {
      const word = [...this.wordMap.values()]
        .filter((candidate) => containsPoint(candidate.bounds, point))
        .sort((left, right) => area(left.bounds) - area(right.bounds))[0] ?? null;
      return { region: null, line: null, word };
    }
    const lines = [...this.lineMap.values()].filter((line) => line.regionId === region.id);
    const line = lines.filter((candidate) => containsPoint(candidate.bounds, point))
      .sort((left, right) => area(left.bounds) - area(right.bounds))[0]
      ?? lines.sort((left, right) => distancePointToRect(point, left.bounds) - distancePointToRect(point, right.bounds))[0]
      ?? null;
    const words = [...this.wordMap.values()].filter((word) =>
      word.regionId === region.id && (!line || word.lineId === line.id));
    const word = words.filter((candidate) => containsPoint(candidate.bounds, point))
      .sort((left, right) => area(left.bounds) - area(right.bounds))[0]
      ?? words.sort((left, right) => distancePointToRect(point, left.bounds) - distancePointToRect(point, right.bounds))[0]
      ?? null;
    return { region, line, word };
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

    if (matchesType(options.types, "LAYOUT_REGION")) {
      for (const region of this.data.layoutRegions) {
        if (!matchesLayoutType(options.layoutTypes, region) || !containsPoint(region.bounds, point)) {
          continue;
        }

        candidates.push(createRegionCandidate(region, this.getRegionCandidateText(region), true, 0, 1));
      }
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

    if (matchesType(options.types, "LAYOUT_REGION")) {
      for (const region of this.data.layoutRegions) {
        if (!matchesLayoutType(options.layoutTypes, region)) {
          continue;
        }

        const directHit = containsPoint(region.bounds, point);
        const distance = distancePointToRect(point, region.bounds);
        if (distance > maximumDistance) {
          continue;
        }

        candidates.push(createRegionCandidate(
          region,
          this.getRegionCandidateText(region),
          directHit,
          distance,
          directHit ? 1 : 0,
        ));
      }
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

    if (matchesType(options.types, "LAYOUT_REGION")) {
      for (const region of this.data.layoutRegions) {
        if (!matchesLayoutType(options.layoutTypes, region) || intersectionArea(rect, region.bounds) <= 0) {
          continue;
        }

        const regionOverlap = overlapRatio(rect, region.bounds);
        if (regionOverlap < minimumOverlap) {
          continue;
        }

        candidates.push(createRegionCandidate(
          region,
          this.getRegionCandidateText(region),
          true,
          0,
          regionOverlap,
        ));
      }
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

  private getRegionCandidateText(region: LayoutRegion): string {
    if (region.textContent?.text) {
      return region.textContent.text;
    }

    const embeddedText = region.mediaContent?.embeddedWordIds
      .map((wordId) => this.wordMap.get(wordId)?.text ?? "")
      .filter((text) => text.length > 0)
      .join(" ");
    return embeddedText || region.sourceDetection?.label || region.layoutType;
  }

  public toSerialized(): PageSemanticModelData {
    return cloneData(this.data);
  }
}

export default PageSemanticModel;
