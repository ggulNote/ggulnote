import type { NormalizedPoint, NormalizedRect } from "@ggulnote/shared-types";
import type {
  PageSemanticModelData,
  SemanticCandidate,
  SemanticLine,
  SemanticModelQuery,
  SemanticModelQueryResult,
  SemanticObjectBase,
  SemanticObjectType,
  SemanticParagraph,
  SemanticSentence,
  SemanticWord,
} from "./types";
import { containsPoint, distancePointToRect, overlapRatio, sortByReadingPoint } from "./geometry";

const DEFAULT_QUERY_LIMIT = 10;

const matchesType = (types: readonly SemanticObjectType[] | undefined, type: SemanticObjectType): boolean => {
  if (!types || types.length === 0) {
    return true;
  }

  return types.includes(type);
};

const resolveLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_QUERY_LIMIT;
  }

  const next = Math.floor(limit);
  return next > 0 ? next : DEFAULT_QUERY_LIMIT;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const toNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const toText = (value: unknown): string => (typeof value === "string" ? value : "");
const toArray = <T>(value: unknown, fallback: T[] = []): T[] => (Array.isArray(value) ? (value as T[]) : fallback);

const cloneArrayOfObjects = <T>(value: T[]): T[] => value.map((item) => ({ ...item }));

const toRect = (value: unknown): NormalizedRect => {
  if (!isRecord(value)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return {
    x: toNumber(value.x),
    y: toNumber(value.y),
    width: toNumber(value.width),
    height: toNumber(value.height),
  };
};

const toObjectBase = (value: unknown): SemanticObjectBase | null => {
  if (!isRecord(value)) {
    return null;
  }

  const type = toText(value.type) as SemanticObjectType;
  if (type !== "WORD" && type !== "LINE" && type !== "SENTENCE" && type !== "PARAGRAPH") {
    return null;
  }

  return {
    id: toText(value.id),
    type,
    pageId: toText(value.pageId),
    text: toText(value.text),
    normalizedText: toText(value.normalizedText),
    bounds: toRect(value.bounds),
    readingOrder: toNumber(value.readingOrder),
    confidence: toNumber(value.confidence),
  };
};

const toWord = (value: unknown): SemanticWord | null => {
  const base = toObjectBase(value);
  if (!base) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    ...base,
    type: "WORD",
    sourceItemIds: toArray<string>(record.sourceItemIds, []),
    lineId: toText(record.lineId),
    direction: (toText(record.direction) as SemanticLine["direction"]) || "ltr",
    fontName: toText(record.fontName) || undefined,
    fontSize: record.fontSize as number | undefined,
    startsWithPunctuation: Boolean(record.startsWithPunctuation),
    endsWithPunctuation: Boolean(record.endsWithPunctuation),
  };
};

const toLine = (value: unknown): SemanticLine | null => {
  const base = toObjectBase(value);
  if (!base) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    ...base,
    type: "LINE",
    wordIds: toArray<string>(record.wordIds, []),
    paragraphId: (record.paragraphId as string | null) ?? null,
    baseline: toNumber(record.baseline),
    direction: (toText(record.direction) as SemanticLine["direction"]) || "ltr",
    averageFontSize: typeof record.averageFontSize === "number" ? record.averageFontSize : undefined,
    columnIndex: toNumber(record.columnIndex),
  };
};

const toSentence = (value: unknown): SemanticSentence | null => {
  const base = toObjectBase(value);
  if (!base) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    ...base,
    type: "SENTENCE",
    wordIds: toArray<string>(record.wordIds, []),
    lineIds: toArray<string>(record.lineIds, []),
    paragraphId: (record.paragraphId as string | null) ?? null,
    startWordId: toText(record.startWordId),
    endWordId: toText(record.endWordId),
  };
};

const toParagraph = (value: unknown): SemanticParagraph | null => {
  const base = toObjectBase(value);
  if (!base) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    ...base,
    type: "PARAGRAPH",
    lineIds: toArray<string>(record.lineIds, []),
    sentenceIds: toArray<string>(record.sentenceIds, []),
    columnIndex: toNumber(record.columnIndex),
    averageFontSize: typeof record.averageFontSize === "number" ? record.averageFontSize : undefined,
  };
};

const emptyData = (): PageSemanticModelData => ({
  schemaVersion: 1,
  extractorVersion: "1",
  documentId: "",
  pageId: "",
  pageNumber: 0,
  words: [],
  lines: [],
  sentences: [],
  paragraphs: [],
  createdAt: Date.now(),
  sourceItemCount: 0,
  processingDurationMs: 0,
});

const toCandidate = (item: SemanticObjectBase, point: NormalizedPoint): SemanticCandidate => {
  const distance = distancePointToRect(point, item.bounds);
  return {
    id: item.id,
    type: item.type,
    pageId: item.pageId,
    text: item.text,
    bounds: item.bounds,
    containsPoint: containsPoint(item.bounds, point),
    distance,
    overlapRatio: containsPoint(item.bounds, point) ? 1 : 0,
    readingOrder: item.readingOrder,
    confidence: item.confidence,
  };
};

const getContainingTypeRank = (type: SemanticObjectType): number => {
  if (type === "SENTENCE") {
    return 0;
  }

  if (type === "PARAGRAPH") {
    return 1;
  }

  if (type === "LINE") {
    return 2;
  }

  if (type === "WORD") {
    return 3;
  }

  return 4;
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
    if (!isRecord(serialized)) {
      return new PageSemanticModel(emptyData());
    }

    const normalized: PageSemanticModelData = {
      schemaVersion: toNumber(serialized.schemaVersion) || 1,
      extractorVersion: toText(serialized.extractorVersion) || "1",
      documentId: toText(serialized.documentId),
      pageId: toText(serialized.pageId),
      pageNumber: toNumber(serialized.pageNumber),
      words: toArray<SemanticWord>(serialized.words, [])
        .map((entry) => toWord(entry))
        .filter((entry): entry is SemanticWord => entry !== null),
      lines: toArray<SemanticLine>(serialized.lines, [])
        .map((entry) => toLine(entry))
        .filter((entry): entry is SemanticLine => entry !== null),
      sentences: toArray<SemanticSentence>(serialized.sentences, [])
        .map((entry) => toSentence(entry))
        .filter((entry): entry is SemanticSentence => entry !== null),
      paragraphs: toArray<SemanticParagraph>(serialized.paragraphs, [])
        .map((entry) => toParagraph(entry))
        .filter((entry): entry is SemanticParagraph => entry !== null),
      createdAt: toNumber(serialized.createdAt) || Date.now(),
      sourceItemCount: Math.max(0, toNumber(serialized.sourceItemCount)),
      processingDurationMs: Math.max(0, toNumber(serialized.processingDurationMs)),
    };

    return new PageSemanticModel(normalized);
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

  public getAllByReadingOrder(): SemanticObjectBase[] {
    const all: SemanticObjectBase[] = [
      ...this.wordMap.values(),
      ...this.lineMap.values(),
      ...this.sentenceMap.values(),
      ...this.paragraphMap.values(),
    ];

    return all.sort((left, right) => {
      const order = sortByReadingPoint(left, right);
      if (order !== 0) {
        return order;
      }

      return left.type.localeCompare(right.type);
    });
  }

  public getSummary(): SemanticModelQueryResult {
    const columnCount = new Set(this.data.lines.map((line) => line.columnIndex)).size;

    return {
      wordCount: this.data.words.length,
      lineCount: this.data.lines.length,
      sentenceCount: this.data.sentences.length,
      paragraphCount: this.data.paragraphs.length,
      columnCount,
      sourceItemCount: this.data.sourceItemCount,
      processingDurationMs: this.data.processingDurationMs,
    };
  }

  public findAtPoint(point: NormalizedPoint, options: { types?: readonly SemanticObjectType[]; limit?: number; maxDistance?: number; minimumOverlapRatio?: number } = {}): SemanticCandidate[] {
    const distanceLimit = options.maxDistance ?? Number.POSITIVE_INFINITY;
    const minDistance = Number.isFinite(distanceLimit) ? distanceLimit : Number.POSITIVE_INFINITY;
    const minOverlap = options.minimumOverlapRatio ?? 0;
    const limit = resolveLimit(options.limit);

    const candidates: SemanticCandidate[] = [];

    for (const item of this.getAllByReadingOrder()) {
      if (!matchesType(options.types, item.type)) {
        continue;
      }

      const distance = distancePointToRect(point, item.bounds);
      if (distance > minDistance) {
        continue;
      }

      const hit = containsPoint(item.bounds, point);
      const overlap = hit ? 1 : overlapRatio(item.bounds, { ...item.bounds, x: point.x, y: point.y, width: 0, height: 0 });

      if (overlap < minOverlap) {
        continue;
      }

      candidates.push({
        id: item.id,
        type: item.type,
        pageId: item.pageId,
        text: item.text,
        bounds: item.bounds,
        containsPoint: hit,
        distance,
        overlapRatio: overlap,
        readingOrder: item.readingOrder,
        confidence: item.confidence,
      });
    }

    candidates.sort((left, right) => {
      if (left.containsPoint && right.containsPoint) {
        const leftTypeRank = getContainingTypeRank(left.type);
        const rightTypeRank = getContainingTypeRank(right.type);

        if (leftTypeRank !== rightTypeRank) {
          return leftTypeRank - rightTypeRank;
        }
      }

      if (left.containsPoint !== right.containsPoint) {
        return left.containsPoint ? -1 : 1;
      }

      if (!left.containsPoint && !right.containsPoint) {
        const leftTypeRank = getContainingTypeRank(left.type);
        const rightTypeRank = getContainingTypeRank(right.type);
        if (leftTypeRank !== rightTypeRank) {
          return leftTypeRank - rightTypeRank;
        }
      }

      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      if (left.overlapRatio !== right.overlapRatio) {
        return right.overlapRatio - left.overlapRatio;
      }

      return left.readingOrder - right.readingOrder;
    });

    return candidates.slice(0, limit);
  }

  public findNearest(point: NormalizedPoint, options: { types?: readonly SemanticObjectType[]; limit?: number; maxDistance?: number; minimumOverlapRatio?: number } = {}): SemanticCandidate[] {
    return this.findAtPoint(point, options);
  }

  public findInRect(rect: NormalizedRect, options: { types?: readonly SemanticObjectType[]; limit?: number; minimumOverlapRatio?: number } = {}): SemanticCandidate[] {
    const limit = resolveLimit(options.limit);
    const minOverlap = options.minimumOverlapRatio ?? 0;

    const candidates: SemanticCandidate[] = [];

    for (const item of this.getAllByReadingOrder()) {
      if (!matchesType(options.types, item.type)) {
        continue;
      }

      const overlap = overlapRatio(rect, item.bounds);
      if (overlap < minOverlap) {
        continue;
      }

      const center = {
        x: item.bounds.x + item.bounds.width * 0.5,
        y: item.bounds.y + item.bounds.height * 0.5,
      };

      candidates.push({
        id: item.id,
        type: item.type,
        pageId: item.pageId,
        text: item.text,
        bounds: item.bounds,
        containsPoint: containsPoint(item.bounds, center),
        distance: distancePointToRect(center, item.bounds),
        overlapRatio: overlap,
        readingOrder: item.readingOrder,
        confidence: item.confidence,
      });
    }

    candidates.sort((left, right) => {
      if (left.overlapRatio !== right.overlapRatio) {
        return right.overlapRatio - left.overlapRatio;
      }

      return left.readingOrder - right.readingOrder;
    });

    return candidates.slice(0, limit);
  }

  public toSerialized(): PageSemanticModelData {
    return {
      schemaVersion: this.data.schemaVersion,
      extractorVersion: this.data.extractorVersion,
      documentId: this.data.documentId,
      pageId: this.data.pageId,
      pageNumber: this.data.pageNumber,
      words: cloneArrayOfObjects(this.data.words),
      lines: cloneArrayOfObjects(this.data.lines),
      sentences: cloneArrayOfObjects(this.data.sentences),
      paragraphs: cloneArrayOfObjects(this.data.paragraphs),
      createdAt: this.data.createdAt,
      sourceItemCount: this.data.sourceItemCount,
      processingDurationMs: this.data.processingDurationMs,
    };
  }
}

export default PageSemanticModel;
