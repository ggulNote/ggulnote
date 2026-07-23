import {
  LINE_BASELINE_TOLERANCE_RATIO,
  LINE_GAP_HEIGHT_RATIO,
  ORIENTATION_ANGLE_TOLERANCE,
  PARAGRAPH_GAP_MULTIPLIER,
  SEMANTIC_EXTRACTOR_VERSION,
  SEMANTIC_SCHEMA_VERSION,
} from "./constants";
import {
  boundsFromPoints,
  clampRect,
  horizontalOverlapRatio,
  isValidBounds,
  unionBounds,
  xCenter,
  yCenter,
} from "./geometry";
import { PageSemanticModel } from "./page-semantic-model";
import { createSentenceSegmenter, type SentenceSegment } from "./segmentation";
import type {
  BuildPageInput,
  LayoutBlock,
  LayoutBlockType,
  LayoutColumn,
  LayoutRegion,
  LocalTextAxis,
  PageSemanticModelData,
  PageTextItemInput,
  SemanticLine,
  SemanticObjectType,
  SemanticParagraph,
  SemanticSentence,
  SemanticWord,
  TextDirection,
  TextOrientation,
  TextQuad,
  WordSourceRange,
} from "./types";

const DEFAULT_DIRECTION: TextDirection = "ltr";
const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
const WHITESPACE_PATTERN = /\s/u;
const NON_WHITESPACE_RUN_PATTERN = /\S+/gu;
const PUNCTUATION_ONLY_PATTERN = /^[\p{P}\p{S}]+$/u;
const CLOSE_PUNCTUATION_PATTERN = /^[,.;:!?%)\]}”’。！？]/u;
const OPEN_PUNCTUATION_PATTERN = /[(\[{“‘]$/u;
const SENTENCE_END_PATTERN = /[.!?。！？]/u;
const LOWERCASE_START_PATTERN = /^\p{Ll}/u;
const URL_OR_EMAIL_PATTERN = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,})/iu;
const LIST_MARKER_PATTERN = /^\s*(?:[-*•‣▪◦]|\d{1,3}[.)]|[A-Za-z][.)])(?:\s+|$)/u;
const TREE_GLYPH_PATTERN = /[├└│─┌┬┐┘┤]/u;
const CODE_KEYWORD_PATTERN =
  /^\s*(?:import|export|const|let|var|function|class|interface|type|return|if|else|for|while)\b/u;
const CODE_SYMBOL_PATTERN = /=>|[{};=\[\]]|::/u;
const PATH_OR_MEMBER_PATTERN = /(?:[\p{L}\p{N}_@-]+[.\/\\])+\p{L}[\p{L}\p{N}_@-]*/u;

type Bounds = PageTextItemInput["bounds"];

interface NormalizedTextItem extends PageTextItemInput {
  direction: TextDirection;
  fontSize: number;
  hasEOL: boolean;
  orientation: TextOrientation;
  axis: LocalTextAxis;
  quad: TextQuad;
}

interface WordToken {
  text: string;
  startOffset: number;
  endOffset: number;
}

interface SourceWordCandidate {
  text: string;
  normalizedText: string;
  bounds: Bounds;
  sourceRange: WordSourceRange;
  sourceIndex: number;
  fontName?: string;
  fontSize: number;
  direction: TextDirection;
  hasEOL: boolean;
  orientation: TextOrientation;
  axis: LocalTextAxis;
  quad: TextQuad;
  spaceAdvance: number;
}

interface Projection {
  start: number;
  end: number;
  center: number;
  size: number;
}

interface BaselineDraft {
  words: SourceWordCandidate[];
  orientation: TextOrientation;
  axis: LocalTextAxis;
  baselineCenters: number[];
  crossSizes: number[];
  baselineMedian: number;
  crossSizeMedian: number;
  creationOrder: number;
  firstSourceIndex: number;
}

interface LineDraft {
  words: SourceWordCandidate[];
  bounds: Bounds;
  orientation: TextOrientation;
  axis: LocalTextAxis;
  direction: TextDirection;
  baseline: number;
  horizontalGaps: number[];
  averageFontSize: number;
}

interface BlockDraft {
  lines: LineDraft[];
  bounds: Bounds;
  type: LayoutBlockType;
}

interface ColumnDraft {
  lines: LineDraft[];
  bounds: Bounds;
  blocks: BlockDraft[];
}

interface RegionDraft {
  lines: LineDraft[];
  bounds: Bounds;
  orientation: TextOrientation;
  columns: ColumnDraft[];
}

interface LinePlacement {
  line: LineDraft;
  lineId: string;
  readingOrder: number;
  regionId: string;
  blockId: string;
  columnId: string;
  columnIndex: number;
}

interface ReconstructedParagraph {
  text: string;
  wordRanges: Array<{ word: SemanticWord; start: number; end: number }>;
  lineRanges: Array<{
    lineId: string;
    start: number;
    end: number;
    text: string;
    indent: number;
    listMarker?: string;
  }>;
}

type ParagraphSegmentationMode = "prose" | "list" | "preformatted" | "heading";

interface ColumnSeed {
  lines: LineDraft[];
  starts: number[];
  ends: number[];
  centers: number[];
}

interface GutterCandidate {
  start: number;
  end: number;
  center: number;
  medianWidth: number;
  rowSupport: number;
  supportRatio: number;
  leftSupport: number;
  rightSupport: number;
  verticalCoverage: number;
  score: number;
}

const finitePositive = (value: number | undefined, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
};

const median = (values: readonly number[]): number => {
  const finite = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (finite.length === 0) {
    return 0;
  }

  const center = Math.floor(finite.length / 2);
  return finite.length % 2 === 0
    ? ((finite[center - 1] ?? 0) + (finite[center] ?? 0)) / 2
    : finite[center] ?? 0;
};

const normalizeAngle = (angle: number): number => {
  if (!Number.isFinite(angle)) {
    return 0;
  }

  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  } else if (normalized <= -Math.PI) {
    normalized += Math.PI * 2;
  }

  return Math.abs(normalized) < 1e-10 ? 0 : normalized;
};

const angleDistance = (left: number, right: number): number => {
  return Math.abs(normalizeAngle(left - right));
};

const normalizeVector = (
  x: number,
  y: number,
  fallbackX: number,
  fallbackY: number,
): { x: number; y: number } => {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    return { x: fallbackX, y: fallbackY };
  }

  return { x: x / length, y: y / length };
};

const resolveOrientation = (item: PageTextItemInput): TextOrientation => {
  const transformAngle = item.transform
    ? Math.atan2(item.transform[1], item.transform[0])
    : item.direction === "ttb"
      ? Math.PI / 2
      : 0;
  const angle = normalizeAngle(item.orientation?.angle ?? transformAngle);
  const horizontalDistance = Math.min(angleDistance(angle, 0), angleDistance(angle, Math.PI));
  const writingMode = item.orientation?.writingMode
    ?? (item.direction === "ttb"
      ? "vertical"
      : horizontalDistance <= ORIENTATION_ANGLE_TOLERANCE
        ? "horizontal"
        : "rotated");

  return { angle, writingMode };
};

const resolveAxis = (
  item: PageTextItemInput,
  orientation: TextOrientation,
): LocalTextAxis => {
  const screenAngle = -orientation.angle;
  const fallbackAdvance = { x: Math.cos(screenAngle), y: Math.sin(screenAngle) };
  const advance = item.axis
    ? normalizeVector(item.axis.advanceX, item.axis.advanceY, fallbackAdvance.x, fallbackAdvance.y)
    : fallbackAdvance;
  const fallbackNormal = { x: -advance.y, y: advance.x };
  const normal = item.axis
    ? normalizeVector(item.axis.normalX, item.axis.normalY, fallbackNormal.x, fallbackNormal.y)
    : fallbackNormal;

  return {
    advanceX: advance.x,
    advanceY: advance.y,
    normalX: normal.x,
    normalY: normal.y,
  };
};

const defaultQuad = (bounds: Bounds, axis: LocalTextAxis): TextQuad => {
  const horizontal = Math.abs(axis.advanceX) >= Math.abs(axis.advanceY);
  if (horizontal) {
    return {
      points: axis.advanceX >= 0
        ? [
          { x: bounds.x, y: bounds.y + bounds.height },
          { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
          { x: bounds.x + bounds.width, y: bounds.y },
          { x: bounds.x, y: bounds.y },
        ]
        : [
          { x: bounds.x + bounds.width, y: bounds.y },
          { x: bounds.x, y: bounds.y },
          { x: bounds.x, y: bounds.y + bounds.height },
          { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        ],
    };
  }

  return {
    points: axis.advanceY >= 0
      ? [
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y },
      ]
      : [
        { x: bounds.x, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      ],
  };
};

const resolveQuad = (item: PageTextItemInput, bounds: Bounds, axis: LocalTextAxis): TextQuad => {
  const points = item.quad?.points;
  if (
    points
    && points.length === 4
    && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  ) {
    return {
      points: points.map((point) => ({
        x: Math.min(1, Math.max(0, point.x)),
        y: Math.min(1, Math.max(0, point.y)),
      })) as TextQuad["points"],
    };
  }

  return defaultQuad(bounds, axis);
};

const normalizeText = (text: string): string => text
  .replace(/\u00a0/gu, " ")
  .replace(/\s+/gu, " ")
  .trim();

const normalizeItems = (items: readonly PageTextItemInput[]): NormalizedTextItem[] => {
  return items
    .map((item, index): NormalizedTextItem | null => {
      if (!isValidBounds(item.bounds)) {
        return null;
      }

      const text = normalizeText(item.text);
      const bounds = clampRect(item.bounds);
      if (!text || !isValidBounds(bounds)) {
        return null;
      }

      const orientation = resolveOrientation(item);
      const axis = resolveAxis(item, orientation);
      const crossSize = orientation.writingMode === "horizontal" ? bounds.height : bounds.width;

      return {
        ...item,
        id: item.id || String(index),
        text,
        bounds,
        sourceIndex: Number.isFinite(item.sourceIndex) ? item.sourceIndex : index,
        direction: item.direction === "rtl" || item.direction === "ttb"
          ? item.direction
          : DEFAULT_DIRECTION,
        fontSize: finitePositive(item.fontSize, crossSize),
        hasEOL: item.hasEOL === true,
        orientation,
        axis,
        quad: resolveQuad(item, bounds, axis),
      };
    })
    .filter((item): item is NormalizedTextItem => item !== null)
    .sort((left, right) => left.sourceIndex - right.sourceIndex);
};

const codePointWeight = (character: string): number => {
  if (/\s/u.test(character)) return 0.52;
  if (CJK_PATTERN.test(character)) return 1;
  if (/[ilI1|.,:;!']/u.test(character)) return 0.48;
  if (/[mwMW@%&]/u.test(character)) return 1.35;
  if (/[\p{P}\p{S}]/u.test(character)) return 0.62;
  if (/[A-Z0-9]/u.test(character)) return 0.96;
  return 0.82;
};

const textWeight = (text: string, start = 0, end = text.length): number => {
  return Array.from(text.slice(start, end))
    .reduce((total, character) => total + codePointWeight(character), 0);
};

const segmentCompactText = (text: string): WordToken[] => {
  if (!CJK_PATTERN.test(text) || !("Segmenter" in Intl)) {
    return [{ text, startOffset: 0, endOffset: text.length }];
  }

  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    const result: WordToken[] = [];
    let pendingStart: number | null = null;

    for (const entry of segmenter.segment(text)) {
      const start = entry.index;
      const end = start + entry.segment.length;
      if (!entry.segment || /^\s+$/u.test(entry.segment)) {
        continue;
      }

      if (entry.isWordLike) {
        const tokenStart = pendingStart ?? start;
        result.push({
          text: text.slice(tokenStart, end),
          startOffset: tokenStart,
          endOffset: end,
        });
        pendingStart = null;
      } else {
        const previous = result[result.length - 1];
        if (previous && previous.endOffset === start) {
          previous.text = text.slice(previous.startOffset, end);
          previous.endOffset = end;
        } else {
          pendingStart = pendingStart ?? start;
        }
      }
    }

    if (result.length > 0) {
      if (pendingStart !== null) {
        const previous = result[result.length - 1];
        previous.text = text.slice(previous.startOffset);
        previous.endOffset = text.length;
      }
      return result;
    }
  } catch {
    return [{ text, startOffset: 0, endOffset: text.length }];
  }

  return [{ text, startOffset: 0, endOffset: text.length }];
};

const createWordTokens = (text: string): WordToken[] => {
  if (!text) return [];
  if (!WHITESPACE_PATTERN.test(text)) {
    return segmentCompactText(text).filter((token) => token.text.trim().length > 0);
  }

  return Array.from(text.matchAll(NON_WHITESPACE_RUN_PATTERN), (match) => ({
    text: match[0],
    startOffset: match.index,
    endOffset: match.index + match[0].length,
  }));
};

const interpolatePoint = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  ratio: number,
): { x: number; y: number } => ({
  x: start.x + (end.x - start.x) * ratio,
  y: start.y + (end.y - start.y) * ratio,
});

const sliceQuad = (quad: TextQuad, startRatio: number, endRatio: number): TextQuad => {
  const [origin, advanceEnd, farAdvanceEnd, farOrigin] = quad.points;
  return {
    points: [
      interpolatePoint(origin, advanceEnd, startRatio),
      interpolatePoint(origin, advanceEnd, endRatio),
      interpolatePoint(farOrigin, farAdvanceEnd, endRatio),
      interpolatePoint(farOrigin, farAdvanceEnd, startRatio),
    ],
  };
};

const splitToSourceWords = (item: NormalizedTextItem): SourceWordCandidate[] => {
  const tokens = createWordTokens(item.text);
  const totalWeight = textWeight(item.text);
  if (tokens.length === 0 || totalWeight <= 0) {
    return [];
  }

  const advanceLength = Math.hypot(
    item.quad.points[1].x - item.quad.points[0].x,
    item.quad.points[1].y - item.quad.points[0].y,
  );
  const spaceAdvance = advanceLength * codePointWeight(" ") / totalWeight;

  return tokens
    .map((token, index): SourceWordCandidate | null => {
      const tokenText = token.text.trim();
      if (!tokenText) return null;

      const weightedStart = textWeight(item.text, 0, token.startOffset) / totalWeight;
      const weightedEnd = textWeight(item.text, 0, token.endOffset) / totalWeight;
      const startRatio = item.direction === "rtl" ? 1 - weightedEnd : weightedStart;
      const endRatio = item.direction === "rtl" ? 1 - weightedStart : weightedEnd;
      const quad = sliceQuad(item.quad, startRatio, endRatio);
      const bounds = boundsFromPoints(quad.points);
      if (!bounds || !isValidBounds(bounds)) return null;

      return {
        text: tokenText,
        normalizedText: tokenText,
        bounds: { ...bounds },
        sourceRange: {
          sourceTextItemId: item.id,
          startOffset: token.startOffset,
          endOffset: token.endOffset,
        },
        sourceIndex: item.sourceIndex,
        fontName: item.fontName,
        fontSize: item.fontSize,
        direction: item.direction,
        hasEOL: item.hasEOL && index === tokens.length - 1,
        orientation: { ...item.orientation },
        axis: { ...item.axis },
        quad: {
          points: quad.points.map((point) => ({ ...point })) as TextQuad["points"],
        },
        spaceAdvance,
      };
    })
    .filter((candidate): candidate is SourceWordCandidate => candidate !== null);
};

const rectProjection = (rect: Bounds, axisX: number, axisY: number): Projection => {
  const values = [
    rect.x * axisX + rect.y * axisY,
    (rect.x + rect.width) * axisX + rect.y * axisY,
    (rect.x + rect.width) * axisX + (rect.y + rect.height) * axisY,
    rect.x * axisX + (rect.y + rect.height) * axisY,
  ];
  const start = Math.min(...values);
  const end = Math.max(...values);
  return { start, end, center: (start + end) / 2, size: end - start };
};

const advanceProjection = (rect: Bounds, axis: LocalTextAxis): Projection => {
  return rectProjection(rect, axis.advanceX, axis.advanceY);
};

const normalProjection = (rect: Bounds, axis: LocalTextAxis): Projection => {
  return rectProjection(rect, axis.normalX, axis.normalY);
};

const projectionOverlapRatio = (left: Projection, right: Projection): number => {
  const overlap = Math.min(left.end, right.end) - Math.max(left.start, right.start);
  const minimum = Math.min(left.size, right.size);
  return overlap > 0 && minimum > 0 ? overlap / minimum : 0;
};

const sameOrientation = (left: TextOrientation, right: TextOrientation): boolean => {
  return left.writingMode === right.writingMode
    && angleDistance(left.angle, right.angle) <= ORIENTATION_ANGLE_TOLERANCE;
};

type LineDraftPhase = "provisional" | "final";

const buildLineDrafts = (
  words: SourceWordCandidate[],
  phase: LineDraftPhase = "final",
): LineDraft[] => {
  const baselines: BaselineDraft[] = [];
  const sorted = [...words].sort((left, right) => {
    if (left.orientation.writingMode !== right.orientation.writingMode) {
      return left.orientation.writingMode.localeCompare(right.orientation.writingMode);
    }

    const angleDelta = normalizeAngle(left.orientation.angle) - normalizeAngle(right.orientation.angle);
    if (Math.abs(angleDelta) > ORIENTATION_ANGLE_TOLERANCE) return angleDelta;

    const leftNormal = normalProjection(left.bounds, left.axis);
    const rightNormal = normalProjection(right.bounds, right.axis);
    if (Math.abs(leftNormal.center - rightNormal.center) > Number.EPSILON) {
      return leftNormal.center - rightNormal.center;
    }
    return left.sourceIndex - right.sourceIndex;
  });

  for (const word of sorted) {
    const wordNormal = normalProjection(word.bounds, word.axis);
    let best: BaselineDraft | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestOverlap = Number.NEGATIVE_INFINITY;

    for (const baseline of baselines) {
      if (!sameOrientation(word.orientation, baseline.orientation)) continue;

      const representativeNormal: Projection = {
        start: baseline.baselineMedian - baseline.crossSizeMedian / 2,
        end: baseline.baselineMedian + baseline.crossSizeMedian / 2,
        center: baseline.baselineMedian,
        size: baseline.crossSizeMedian,
      };
      const overlap = projectionOverlapRatio(wordNormal, representativeNormal);
      const distance = Math.abs(wordNormal.center - baseline.baselineMedian);
      const reference = Math.max(Number.EPSILON, wordNormal.size, baseline.crossSizeMedian);
      if (overlap < 0.3 && distance > reference * LINE_BASELINE_TOLERANCE_RATIO) continue;

      const candidateCenters = [...baseline.baselineCenters, wordNormal.center];
      const candidateSizes = [...baseline.crossSizes, wordNormal.size];
      const candidateCrossSize = Math.max(Number.EPSILON, median(candidateSizes));
      const centerSpread = Math.max(...candidateCenters) - Math.min(...candidateCenters);
      if (centerSpread > Math.max(candidateCrossSize, wordNormal.size)) continue;

      const score = distance / reference + (1 - overlap) * 0.2;
      const isBetter = score < bestScore - Number.EPSILON
        || (
          Math.abs(score - bestScore) <= Number.EPSILON
          && (
            distance < bestDistance - Number.EPSILON
            || (
              Math.abs(distance - bestDistance) <= Number.EPSILON
              && (
                overlap > bestOverlap + Number.EPSILON
                || (
                  Math.abs(overlap - bestOverlap) <= Number.EPSILON
                  && (
                    baseline.baselineMedian < (best?.baselineMedian ?? Number.POSITIVE_INFINITY)
                    || (
                      baseline.baselineMedian === best?.baselineMedian
                      && baseline.firstSourceIndex < (best?.firstSourceIndex ?? Number.POSITIVE_INFINITY)
                    )
                  )
                )
              )
            )
          )
        );
      if (isBetter) {
        best = baseline;
        bestScore = score;
        bestDistance = distance;
        bestOverlap = overlap;
      }
    }

    if (!best) {
      baselines.push({
        words: [word],
        orientation: { ...word.orientation },
        axis: { ...word.axis },
        baselineCenters: [wordNormal.center],
        crossSizes: [wordNormal.size],
        baselineMedian: wordNormal.center,
        crossSizeMedian: wordNormal.size,
        creationOrder: baselines.length,
        firstSourceIndex: word.sourceIndex,
      });
    } else {
      best.words.push(word);
      best.baselineCenters.push(wordNormal.center);
      best.crossSizes.push(wordNormal.size);
      best.baselineMedian = median(best.baselineCenters);
      best.crossSizeMedian = Math.max(Number.EPSILON, median(best.crossSizes));
    }
  }

  const lines: LineDraft[] = [];
  for (const baseline of [...baselines].sort((left, right) => {
    const normalDelta = left.baselineMedian - right.baselineMedian;
    if (Math.abs(normalDelta) > Number.EPSILON) return normalDelta;
    const sourceDelta = left.firstSourceIndex - right.firstSourceIndex;
    return sourceDelta !== 0 ? sourceDelta : left.creationOrder - right.creationOrder;
  })) {
    const geometricallyOrdered = [...baseline.words].sort((left, right) => {
      return advanceProjection(left.bounds, baseline.axis).start
        - advanceProjection(right.bounds, baseline.axis).start;
    });
    const crossSize = Math.max(
      Number.EPSILON,
      median(geometricallyOrdered.map((word) => normalProjection(word.bounds, baseline.axis).size)),
    );
    const typicalSpace = median(
      geometricallyOrdered
        .map((word) => word.spaceAdvance)
        .filter((value) => Number.isFinite(value) && value > 0),
    );
    const gapLimit = Math.max(crossSize * LINE_GAP_HEIGHT_RATIO, typicalSpace * LINE_GAP_HEIGHT_RATIO);
    let chunk: SourceWordCandidate[] = [];
    let gaps: number[] = [];

    const flush = (): void => {
      if (chunk.length === 0) return;

      const ordered = [...chunk].sort((left, right) => {
        const delta = advanceProjection(left.bounds, baseline.axis).start
          - advanceProjection(right.bounds, baseline.axis).start;
        return baseline.words[0]?.direction === "rtl" ? -delta : delta;
      });
      const bounds = unionBounds(ordered.map((word) => word.bounds));
      if (bounds) {
        lines.push({
          words: ordered,
          bounds,
          orientation: { ...baseline.orientation },
          axis: { ...baseline.axis },
          direction: ordered[0]?.direction ?? DEFAULT_DIRECTION,
          baseline: baseline.baselineMedian,
          horizontalGaps: [...gaps],
          averageFontSize: median(ordered.map((word) => word.fontSize)),
        });
      }
      chunk = [];
      gaps = [];
    };

    for (const word of geometricallyOrdered) {
      const previous = chunk[chunk.length - 1];
      if (previous) {
        const previousProjection = advanceProjection(previous.bounds, baseline.axis);
        const currentProjection = advanceProjection(word.bounds, baseline.axis);
        const gap = Math.max(0, currentProjection.start - previousProjection.end);
        const sourceBoundary = previous.sourceIndex !== word.sourceIndex;
        const provisionalBoundary = phase === "provisional"
          && sourceBoundary
          && (
            previous.hasEOL
            || gap > Math.max(typicalSpace * 1.5, crossSize * 0.75)
          );
        if (gap > gapLimit || provisionalBoundary) flush();
        else gaps.push(gap);
      }
      chunk.push(word);
    }
    flush();
  }
  return lines;
};
const clusterHorizontalRows = (
  lines: LineDraft[],
  centerToleranceRatio = LINE_BASELINE_TOLERANCE_RATIO,
): LineDraft[][] => {
  const rows: LineDraft[][] = [];
  const sorted = [...lines].sort((left, right) => {
    const yDelta = yCenter(left.bounds) - yCenter(right.bounds);
    return Math.abs(yDelta) > Number.EPSILON ? yDelta : left.bounds.x - right.bounds.x;
  });

  for (const line of sorted) {
    const current = rows[rows.length - 1];
    if (!current) {
      rows.push([line]);
      continue;
    }

    const rowCenter = median(current.map((entry) => yCenter(entry.bounds)));
    const referenceHeight = Math.max(
      line.bounds.height,
      median(current.map((entry) => entry.bounds.height)),
      Number.EPSILON,
    );
    if (Math.abs(yCenter(line.bounds) - rowCenter) <= referenceHeight * centerToleranceRatio) {
      current.push(line);
    } else {
      rows.push([line]);
    }
  }

  for (const row of rows) row.sort((left, right) => left.bounds.x - right.bounds.x);
  return rows;
};

const columnSeedInterval = (seed: ColumnSeed): { start: number; end: number; center: number } => {
  const start = median(seed.starts);
  const end = median(seed.ends);
  return { start, end, center: median(seed.centers) };
};

const createColumnSeeds = (lines: LineDraft[]): ColumnSeed[] => {
  const seeds: ColumnSeed[] = [];
  const sorted = [...lines].sort((left, right) => {
    const xDelta = xCenter(left.bounds) - xCenter(right.bounds);
    if (Math.abs(xDelta) > Number.EPSILON) return xDelta;
    return yCenter(left.bounds) - yCenter(right.bounds);
  });

  for (const line of sorted) {
    let best: ColumnSeed | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const seed of seeds) {
      const interval = columnSeedInterval(seed);
      const representative: Bounds = {
        x: interval.start,
        y: line.bounds.y,
        width: Math.max(Number.EPSILON, interval.end - interval.start),
        height: line.bounds.height,
      };
      const overlap = horizontalOverlapRatio(representative, line.bounds);
      const centerDistance = Math.abs(xCenter(line.bounds) - interval.center);
      const referenceWidth = Math.max(representative.width, line.bounds.width, Number.EPSILON);
      if (overlap < 0.18 && centerDistance > referenceWidth * 0.45) continue;

      const score = centerDistance / referenceWidth + (1 - overlap) * 0.25;
      if (score < bestScore - Number.EPSILON) {
        best = seed;
        bestScore = score;
      }
    }

    if (!best) {
      seeds.push({
        lines: [line],
        starts: [line.bounds.x],
        ends: [line.bounds.x + line.bounds.width],
        centers: [xCenter(line.bounds)],
      });
      continue;
    }

    best.lines.push(line);
    best.starts.push(line.bounds.x);
    best.ends.push(line.bounds.x + line.bounds.width);
    best.centers.push(xCenter(line.bounds));
  }

  return seeds.sort((left, right) =>
    columnSeedInterval(left).center - columnSeedInterval(right).center);
};

const selectRepeatedColumnGutters = (
  seeds: ColumnSeed[],
  lines: LineDraft[],
  typicalHeight: number,
  regionBounds: Bounds,
): GutterCandidate[] => {
  if (seeds.length < 2) return [];

  const rows = clusterHorizontalRows(lines, 1.25);
  const positiveIntraLineGaps = lines.flatMap((line) =>
    line.horizontalGaps.filter((gap) => Number.isFinite(gap) && gap > Number.EPSILON));
  const typicalIntraLineGap = Math.max(
    Number.EPSILON,
    median(positiveIntraLineGaps),
    typicalHeight * 0.25,
  );
  const candidates: GutterCandidate[] = [];

  for (let leftIndex = 0; leftIndex < seeds.length - 1; leftIndex += 1) {
    const left = seeds[leftIndex];
    if (!left) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < seeds.length; rightIndex += 1) {
      const right = seeds[rightIndex];
      if (!right) continue;

      const leftInterval = columnSeedInterval(left);
      const rightInterval = columnSeedInterval(right);
      if (rightInterval.start <= leftInterval.end) continue;

      const targetCenter = (leftInterval.end + rightInterval.start) / 2;
      const rowGaps: Array<{ start: number; end: number; yStart: number; yEnd: number }> = [];
      for (const row of rows) {
        const ordered = [...row].sort((first, second) => first.bounds.x - second.bounds.x);
        for (let index = 1; index < ordered.length; index += 1) {
          const previous = ordered[index - 1];
          const current = ordered[index];
          if (!previous || !current) continue;

          const start = previous.bounds.x + previous.bounds.width;
          const end = current.bounds.x;
          if (start < targetCenter && targetCenter < end) {
            const rowBounds = unionBounds([previous.bounds, current.bounds]);
            if (rowBounds) {
              rowGaps.push({
                start,
                end,
                yStart: rowBounds.y,
                yEnd: rowBounds.y + rowBounds.height,
              });
            }
            break;
          }
        }
      }

      if (rowGaps.length === 0) continue;
      const start = median(rowGaps.map((gap) => gap.start));
      const end = median(rowGaps.map((gap) => gap.end));
      const medianWidth = end - start;
      if (medianWidth <= Number.EPSILON) continue;

      const rowSupport = rowGaps.length;
      const supportRatio = rowSupport / Math.max(1, rows.length);
      const yStart = Math.min(...rowGaps.map((gap) => gap.yStart));
      const yEnd = Math.max(...rowGaps.map((gap) => gap.yEnd));
      const verticalCoverage = Math.max(0, yEnd - yStart)
        / Math.max(Number.EPSILON, regionBounds.height);
      const leftSupport = left.lines.length;
      const rightSupport = right.lines.length;
      const broadGutter = medianWidth >= Math.max(typicalHeight * 3, typicalIntraLineGap * 4)
        && rowSupport >= Math.max(2, Math.ceil(rows.length * 0.12))
        && verticalCoverage >= 0.12;
      const persistentGutter = medianWidth >= Math.max(
        typicalHeight * 1.5,
        typicalIntraLineGap * 2,
      )
        && rowSupport >= Math.max(4, Math.ceil(rows.length * 0.3))
        && supportRatio >= 0.3
        && verticalCoverage >= 0.25
        && leftSupport >= 3
        && rightSupport >= 3;

      if (!broadGutter && !persistentGutter) continue;
      candidates.push({
        start,
        end,
        center: (start + end) / 2,
        medianWidth,
        rowSupport,
        supportRatio,
        leftSupport,
        rightSupport,
        verticalCoverage,
        score: supportRatio * 2
          + verticalCoverage
          + Math.min(4, medianWidth / typicalHeight) * 0.2,
      });
    }
  }

  const selected: GutterCandidate[] = [];
  for (const candidate of [...candidates].sort((left, right) => {
    const scoreDelta = right.score - left.score;
    return Math.abs(scoreDelta) > Number.EPSILON ? scoreDelta : left.center - right.center;
  })) {
    const overlapsSelected = selected.some((existing) => {
      const overlap = Math.min(candidate.end, existing.end)
        - Math.max(candidate.start, existing.start);
      const minimumWidth = Math.min(candidate.medianWidth, existing.medianWidth);
      return overlap > minimumWidth * 0.5
        || Math.abs(candidate.center - existing.center) <= typicalHeight;
    });
    if (!overlapsSelected) selected.push(candidate);
  }

  return selected.sort((left, right) => left.center - right.center);
};

const inferRegionColumns = (
  lines: LineDraft[],
): Array<{ lines: LineDraft[]; bounds: Bounds }> => {
  const bounds = unionBounds(lines.map((line) => line.bounds));
  if (!bounds) return [];

  const typicalHeight = Math.max(
    Number.EPSILON,
    median(lines.map((line) => line.bounds.height)),
  );
  const minimumSupport = lines.length >= 12
    ? Math.max(2, Math.floor(lines.length * 0.08))
    : 2;
  const supportedSeeds = createColumnSeeds(lines)
    .filter((seed) => seed.lines.length >= minimumSupport);
  const selectedGutters = selectRepeatedColumnGutters(
    supportedSeeds,
    lines,
    typicalHeight,
    bounds,
  );
  if (selectedGutters.length === 0) {
    const finalLines = buildLineDrafts(
      lines.flatMap((line) => line.words),
      "final",
    );
    const finalBounds = unionBounds(finalLines.map((line) => line.bounds));
    return finalBounds ? [{ lines: finalLines, bounds: finalBounds }] : [];
  }

  const intervals: Array<{ start: number; end: number }> = [];
  let intervalStart = bounds.x;
  for (const gutter of selectedGutters) {
    if (gutter.start > intervalStart) {
      intervals.push({ start: intervalStart, end: gutter.start });
    }
    intervalStart = Math.max(intervalStart, gutter.end);
  }
  const boundsEnd = bounds.x + bounds.width;
  if (intervalStart < boundsEnd) intervals.push({ start: intervalStart, end: boundsEnd });

  const assignments = intervals.map((interval) => ({ interval, lines: [] as LineDraft[] }));
  const intervalScore = (
    itemBounds: Bounds,
    interval: { start: number; end: number },
  ): number => {
    const intervalWidth = Math.max(Number.EPSILON, interval.end - interval.start);
    const overlap = Math.max(
      0,
      Math.min(itemBounds.x + itemBounds.width, interval.end)
        - Math.max(itemBounds.x, interval.start),
    );
    const overlapRatio = overlap / Math.max(
      Number.EPSILON,
      Math.min(itemBounds.width, intervalWidth),
    );
    const intervalCenter = (interval.start + interval.end) / 2;
    const containsCenter = interval.start <= xCenter(itemBounds)
      && xCenter(itemBounds) <= interval.end;
    const centerDistance = Math.abs(xCenter(itemBounds) - intervalCenter)
      / Math.max(intervalWidth, itemBounds.width);
    return overlapRatio * 2 + (containsCenter ? 1 : 0) - centerDistance * 0.1;
  };

  for (const line of lines) {
    const wordBuckets = intervals.map(() => [] as SourceWordCandidate[]);
    for (const word of line.words) {
      let bestIndex = 0;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < intervals.length; index += 1) {
        const interval = intervals[index];
        if (!interval) continue;
        const score = intervalScore(word.bounds, interval);
        if (score > bestScore + Number.EPSILON) {
          bestIndex = index;
          bestScore = score;
        }
      }
      wordBuckets[bestIndex]?.push(word);
    }

    const occupiedBuckets = wordBuckets
      .map((bucket, index) => ({ bucket, index }))
      .filter(({ bucket }) => bucket.length > 0);
    if (occupiedBuckets.length > 1) {
      for (const { bucket, index } of occupiedBuckets) {
        assignments[index]?.lines.push(...buildLineDrafts(bucket, "final"));
      }
      continue;
    }

    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < intervals.length; index += 1) {
      const interval = intervals[index];
      if (!interval) continue;
      const score = intervalScore(line.bounds, interval);
      if (score > bestScore + Number.EPSILON) {
        bestIndex = index;
        bestScore = score;
      }
    }
    assignments[bestIndex]?.lines.push(line);
  }

  return assignments
    .map(({ lines: assigned }) => {
      const finalLines = buildLineDrafts(
        assigned.flatMap((line) => line.words),
        "final",
      );
      const assignedBounds = unionBounds(finalLines.map((line) => line.bounds));
      return assignedBounds ? { lines: finalLines, bounds: assignedBounds } : null;
    })
    .filter((group): group is { lines: LineDraft[]; bounds: Bounds } => group !== null)
    .sort((left, right) => left.bounds.x - right.bounds.x);
};
const buildHorizontalBands = (lines: LineDraft[]): LineDraft[][] => {
  const rows = clusterHorizontalRows(lines);
  const typicalHeight = Math.max(
    Number.EPSILON,
    median(lines.map((line) => line.bounds.height)),
  );
  const typicalWidth = Math.max(
    Number.EPSILON,
    median(lines.map((line) => line.bounds.width)),
  );
  const pageBounds = unionBounds(lines.map((line) => line.bounds));
  const bands: LineDraft[][] = [];
  let current: LineDraft[] = [];

  const flush = (): void => {
    if (current.length > 0) bands.push(current);
    current = [];
  };

  for (const row of rows) {
    const rowBounds = unionBounds(row.map((line) => line.bounds));
    if (!rowBounds) continue;

    const onlyLine = row.length === 1 ? row[0] : undefined;
    const fullWidthThreshold = Math.max(
      typicalWidth * 1.45,
      (pageBounds?.width ?? 1) * 0.68,
    );
    const isFullWidth = lines.length >= 6
      && onlyLine !== undefined
      && onlyLine.bounds.width >= fullWidthThreshold;

    const previousBounds = unionBounds(current.map((line) => line.bounds));
    const verticalGap = previousBounds
      ? rowBounds.y - (previousBounds.y + previousBounds.height)
      : 0;

    if (isFullWidth) {
      flush();
      bands.push([...row]);
      continue;
    }
    if (verticalGap > typicalHeight * 5) flush();
    current.push(...row);
  }

  flush();
  return bands;
};
const splitColumnBlocks = (
  lines: LineDraft[],
  pageMedianFontSize: number,
  regionIsMultiColumn: boolean,
): BlockDraft[] => {
  const ordered = [...lines].sort((left, right) => {
    const yDelta = yCenter(left.bounds) - yCenter(right.bounds);
    return Math.abs(yDelta) > Number.EPSILON ? yDelta : xCenter(left.bounds) - xCenter(right.bounds);
  });
  const typicalCrossSize = Math.max(
    Number.EPSILON,
    median(ordered.map((line) => line.orientation.writingMode === "horizontal"
      ? line.bounds.height
      : line.bounds.width)),
  );
  const result: BlockDraft[] = [];
  let current: LineDraft[] = [];

  const flush = (): void => {
    const bounds = unionBounds(current.map((line) => line.bounds));
    if (!bounds) {
      current = [];
      return;
    }

    const averageFont = median(current.map((line) => line.averageFontSize));
    const orientation = current[0]?.orientation;
    const type: LayoutBlockType = orientation?.writingMode !== "horizontal"
      ? "sidebar"
      : averageFont > pageMedianFontSize * 1.2
        ? "heading"
        : !regionIsMultiColumn && bounds.y < 0.25
          ? "metadata"
          : "body";
    result.push({ lines: [...current], bounds, type });
    current = [];
  };

  for (const line of ordered) {
    const previous = current[current.length - 1];
    if (previous) {
      const fontRatio = Math.max(previous.averageFontSize, line.averageFontSize)
        / Math.max(Number.EPSILON, Math.min(previous.averageFontSize, line.averageFontSize));
      const previousEnd = previous.orientation.writingMode === "horizontal"
        ? previous.bounds.y + previous.bounds.height
        : advanceProjection(previous.bounds, previous.axis).end;
      const currentStart = line.orientation.writingMode === "horizontal"
        ? line.bounds.y
        : advanceProjection(line.bounds, line.axis).start;
      const gap = Math.max(0, currentStart - previousEnd);
      if (fontRatio > 1.25 || gap > typicalCrossSize * 2.2) flush();
    }
    current.push(line);
  }

  flush();
  return result;
};

const analyzeLayout = (lineDrafts: LineDraft[]): RegionDraft[] => {
  if (lineDrafts.length === 0) return [];

  const pageMedianFontSize = Math.max(
    Number.EPSILON,
    median(lineDrafts.map((line) => line.averageFontSize)),
  );
  const horizontal = lineDrafts.filter((line) => line.orientation.writingMode === "horizontal");
  const rotated = lineDrafts.filter((line) => line.orientation.writingMode !== "horizontal");
  const regions: RegionDraft[] = [];

  if (horizontal.length > 0) {
    for (const lines of buildHorizontalBands(horizontal)) {
      const bounds = unionBounds(lines.map((line) => line.bounds));
      const orientation = lines[0]?.orientation;
      if (!bounds || !orientation) continue;

      const columnGroups = inferRegionColumns(lines);
      const multiColumn = columnGroups.length > 1;
      const finalLines = columnGroups.flatMap((group) => group.lines);
      const finalBounds = unionBounds(finalLines.map((line) => line.bounds));
      if (!finalBounds) continue;
      regions.push({
        lines: finalLines,
        bounds: finalBounds,
        orientation: { ...orientation },
        columns: columnGroups.map((group) => ({
          lines: [...group.lines],
          bounds: group.bounds,
          blocks: splitColumnBlocks(group.lines, pageMedianFontSize, multiColumn),
        })),
      });
    }
  }
  const rotatedGroups = new Map<string, LineDraft[]>();
  for (const line of rotated) {
    const angleBucket = Math.round(normalizeAngle(line.orientation.angle) / ORIENTATION_ANGLE_TOLERANCE);
    const key = line.orientation.writingMode + ":" + String(angleBucket);
    const group = rotatedGroups.get(key) ?? [];
    group.push(line);
    rotatedGroups.set(key, group);
  }

  for (const lines of rotatedGroups.values()) {
    const finalLines = buildLineDrafts(
      lines.flatMap((line) => line.words),
      "final",
    );
    const bounds = unionBounds(finalLines.map((line) => line.bounds));
    const orientation = finalLines[0]?.orientation;
    if (!bounds || !orientation) continue;
    regions.push({
      lines: finalLines,
      bounds,
      orientation: { ...orientation },
      columns: [{
        lines: [...finalLines],
        bounds,
        blocks: splitColumnBlocks(finalLines, pageMedianFontSize, false),
      }],
    });
  }

  return regions.sort((left, right) => {
    const leftRotated = left.orientation.writingMode === "horizontal" ? 0 : 1;
    const rightRotated = right.orientation.writingMode === "horizontal" ? 0 : 1;
    if (leftRotated !== rightRotated) return leftRotated - rightRotated;
    const yDelta = left.bounds.y - right.bounds.y;
    return Math.abs(yDelta) > Number.EPSILON ? yDelta : left.bounds.x - right.bounds.x;
  });
};

const createSemanticId = (
  pageId: string,
  type: SemanticObjectType,
  readingOrder: number,
  extractorVersion: string,
): string => pageId + ":" + type.toLowerCase() + ":" + extractorVersion + ":" + String(readingOrder);

const createLayoutId = (
  pageId: string,
  type: "region" | "column" | "block",
  readingOrder: number,
  extractorVersion: string,
): string => pageId + ":" + type + ":" + extractorVersion + ":" + String(readingOrder);

const joinWordTexts = (words: readonly { normalizedText: string }[]): string => {
  let result = "";
  for (const word of words) {
    const text = word.normalizedText.trim();
    if (!text) continue;

    const previous = result.slice(-1);
    const separator = !result
      || CLOSE_PUNCTUATION_PATTERN.test(text)
      || OPEN_PUNCTUATION_PATTERN.test(previous)
      ? ""
      : " ";
    result += separator + text;
  }
  return result.trim();
};

const materializeLayout = (
  regions: RegionDraft[],
  pageId: string,
  extractorVersion: string,
): {
  placements: LinePlacement[];
  layoutRegions: LayoutRegion[];
  layoutBlocks: LayoutBlock[];
  columns: LayoutColumn[];
} => {
  const placements: LinePlacement[] = [];
  const layoutRegions: LayoutRegion[] = [];
  const layoutBlocks: LayoutBlock[] = [];
  const columns: LayoutColumn[] = [];
  let lineOrder = 0;
  let blockOrder = 0;
  let columnOrder = 0;

  for (let regionOrder = 0; regionOrder < regions.length; regionOrder += 1) {
    const region = regions[regionOrder];
    if (!region) continue;

    const regionId = createLayoutId(pageId, "region", regionOrder, extractorVersion);
    const regionBlockIds: string[] = [];
    const regionColumnIds: string[] = [];

    for (const column of region.columns) {
      const columnId = createLayoutId(pageId, "column", columnOrder, extractorVersion);
      const columnBlockIds: string[] = [];
      const columnLineIds: string[] = [];
      regionColumnIds.push(columnId);

      for (const block of column.blocks) {
        const blockId = createLayoutId(pageId, "block", blockOrder, extractorVersion);
        const blockLineIds: string[] = [];
        regionBlockIds.push(blockId);
        columnBlockIds.push(blockId);

        for (const line of block.lines) {
          const lineId = createSemanticId(pageId, "LINE", lineOrder, extractorVersion);
          placements.push({
            line,
            lineId,
            readingOrder: lineOrder,
            regionId,
            blockId,
            columnId,
            columnIndex: columnOrder,
          });
          blockLineIds.push(lineId);
          columnLineIds.push(lineId);
          lineOrder += 1;
        }

        layoutBlocks.push({
          id: blockId,
          pageId,
          regionId,
          type: block.type,
          orientation: { ...region.orientation },
          bounds: { ...block.bounds },
          lineIds: blockLineIds,
          columnId,
          readingOrder: blockOrder,
        });
        blockOrder += 1;
      }

      columns.push({
        id: columnId,
        pageId,
        regionId,
        bounds: { ...column.bounds },
        orientation: { ...region.orientation },
        blockIds: columnBlockIds,
        lineIds: columnLineIds,
        columnIndex: columnOrder,
        readingOrder: columnOrder,
      });
      columnOrder += 1;
    }

    layoutRegions.push({
      id: regionId,
      pageId,
      bounds: { ...region.bounds },
      orientation: { ...region.orientation },
      blockIds: regionBlockIds,
      columnIds: regionColumnIds,
      readingOrder: regionOrder,
    });
  }

  return { placements, layoutRegions, layoutBlocks, columns };
};

const buildWordsAndLines = (
  placements: LinePlacement[],
  pageId: string,
  extractorVersion: string,
): { words: SemanticWord[]; lines: SemanticLine[] } => {
  const words: SemanticWord[] = [];
  const lines: SemanticLine[] = [];
  let wordOrder = 0;

  for (const placement of placements) {
    const wordIds: string[] = [];
    for (const candidate of placement.line.words) {
      const wordId = createSemanticId(pageId, "WORD", wordOrder, extractorVersion);
      words.push({
        id: wordId,
        type: "WORD",
        pageId,
        text: candidate.text,
        normalizedText: candidate.normalizedText,
        bounds: { ...candidate.bounds },
        readingOrder: wordOrder,
        confidence: 0.82,
        orientation: { ...candidate.orientation },
        regionId: placement.regionId,
        blockId: placement.blockId,
        columnId: placement.columnId,
        sourceItemIds: [candidate.sourceRange.sourceTextItemId],
        sourceRanges: [{ ...candidate.sourceRange }],
        lineId: placement.lineId,
        direction: candidate.direction,
        fontName: candidate.fontName,
        fontSize: candidate.fontSize,
        startsWithPunctuation: PUNCTUATION_ONLY_PATTERN.test(candidate.normalizedText)
          || /^[\p{P}\p{S}]/u.test(candidate.normalizedText),
        endsWithPunctuation: /[\p{P}\p{S}]$/u.test(candidate.normalizedText),
        hasEOL: candidate.hasEOL,
        axis: { ...candidate.axis },
        quad: {
          points: candidate.quad.points.map((point) => ({ ...point })) as TextQuad["points"],
        },
      });
      wordIds.push(wordId);
      wordOrder += 1;
    }

    const text = joinWordTexts(placement.line.words);
    lines.push({
      id: placement.lineId,
      type: "LINE",
      pageId,
      text,
      normalizedText: text,
      bounds: { ...placement.line.bounds },
      readingOrder: placement.readingOrder,
      confidence: 0.84,
      orientation: { ...placement.line.orientation },
      regionId: placement.regionId,
      blockId: placement.blockId,
      columnId: placement.columnId,
      wordIds,
      paragraphId: null,
      baseline: placement.line.baseline,
      direction: placement.line.direction,
      averageFontSize: placement.line.averageFontSize,
      columnIndex: placement.columnIndex,
      axis: { ...placement.line.axis },
      horizontalGaps: [...placement.line.horizontalGaps],
    });
  }
  return { words, lines };
};

const lineGap = (previous: SemanticLine, current: SemanticLine): number => {
  if (previous.orientation.writingMode === "horizontal") {
    return current.bounds.y - (previous.bounds.y + previous.bounds.height);
  }

  const previousProjection = advanceProjection(previous.bounds, previous.axis);
  const currentProjection = advanceProjection(current.bounds, current.axis);
  return currentProjection.start - previousProjection.end;
};
const listMarker = (text: string): string | undefined => {
  return text.match(LIST_MARKER_PATTERN)?.[0]?.trim();
};

const buildParagraphs = (
  lines: SemanticLine[],
  blocks: LayoutBlock[],
  pageId: string,
  extractorVersion: string,
): SemanticParagraph[] => {
  const lineMap = new Map(lines.map((line) => [line.id, line]));
  const paragraphs: SemanticParagraph[] = [];
  let paragraphOrder = 0;

  for (const block of [...blocks].sort((left, right) => left.readingOrder - right.readingOrder)) {
    const blockLines = block.lineIds
      .map((lineId) => lineMap.get(lineId))
      .filter((line): line is SemanticLine => line !== undefined)
      .sort((left, right) => left.readingOrder - right.readingOrder);
    if (blockLines.length === 0) continue;

    const typicalCross = Math.max(
      Number.EPSILON,
      median(blockLines.map((line) => line.orientation.writingMode === "horizontal"
        ? line.bounds.height
        : line.bounds.width)),
    );
    const positiveGaps = blockLines
      .slice(1)
      .map((line, index) => {
        const previous = blockLines[index];
        return previous ? lineGap(previous, line) : 0;
      })
      .filter((gap) => gap > 0);
    const gapThreshold = Math.max(
      typicalCross * 1.4,
      median(positiveGaps) * PARAGRAPH_GAP_MULTIPLIER,
    );
    let current: SemanticLine[] = [];

    const flush = (): void => {
      const bounds = unionBounds(current.map((line) => line.bounds));
      const first = current[0];
      if (!bounds || !first) {
        current = [];
        return;
      }

      const paragraphId = createSemanticId(pageId, "PARAGRAPH", paragraphOrder, extractorVersion);
      const text = current.map((line) => line.normalizedText).join(" ").trim();
      const paragraph: SemanticParagraph = {
        id: paragraphId,
        type: "PARAGRAPH",
        pageId,
        text,
        normalizedText: text,
        bounds,
        fragments: current.map((line) => ({ ...line.bounds })),
        readingOrder: paragraphOrder,
        confidence: 0.82,
        orientation: { ...first.orientation },
        regionId: first.regionId,
        blockId: first.blockId,
        columnId: first.columnId,
        lineIds: current.map((line) => line.id),
        sentenceIds: [],
        columnIndex: first.columnIndex,
        averageFontSize: median(current
          .map((line) => line.averageFontSize ?? 0)
          .filter((value) => value > 0)),
      };

      for (const line of current) line.paragraphId = paragraphId;
      paragraphs.push(paragraph);
      paragraphOrder += 1;
      current = [];
    };

    for (const line of blockLines) {
      const previous = current[current.length - 1];
      if (previous && listMarker(line.normalizedText)) flush();
      if (previous) {
        const gap = lineGap(previous, line);
        const indentDelta = line.orientation.writingMode === "horizontal"
          ? Math.abs(line.bounds.x - previous.bounds.x)
          : Math.abs(line.bounds.y - previous.bounds.y);
        const fontRatio = Math.max(
          line.averageFontSize ?? typicalCross,
          previous.averageFontSize ?? typicalCross,
        ) / Math.max(
          Number.EPSILON,
          Math.min(line.averageFontSize ?? typicalCross, previous.averageFontSize ?? typicalCross),
        );
        const indentBoundary = indentDelta > typicalCross * 1.5
          && SENTENCE_END_PATTERN.test(previous.normalizedText.slice(-1));
        if (gap > gapThreshold || fontRatio > 1.22 || indentBoundary) flush();
      }
      current.push(line);
    }
    flush();
  }
  return paragraphs;
};

const isHyphenatedLineBreak = (previous: SemanticWord, current: SemanticWord): boolean => {
  return previous.lineId !== current.lineId
    && previous.normalizedText.endsWith("-")
    && LOWERCASE_START_PATTERN.test(current.normalizedText)
    && !URL_OR_EMAIL_PATTERN.test(previous.normalizedText)
    && !URL_OR_EMAIL_PATTERN.test(current.normalizedText);
};

const reconstructParagraph = (
  paragraph: SemanticParagraph,
  lineMap: ReadonlyMap<string, SemanticLine>,
  wordMap: ReadonlyMap<string, SemanticWord>,
): ReconstructedParagraph => {
  let text = "";
  const wordRanges: ReconstructedParagraph["wordRanges"] = [];
  const lineRanges: ReconstructedParagraph["lineRanges"] = [];
  let previousWord: SemanticWord | null = null;

  for (const lineId of paragraph.lineIds) {
    const line = lineMap.get(lineId);
    if (!line) continue;

    const lineStart = text.length;
    for (const wordId of line.wordIds) {
      const word = wordMap.get(wordId);
      if (!word) continue;

      let separator = "";
      if (text.length > 0) {
        if (previousWord && isHyphenatedLineBreak(previousWord, word)) {
          text = text.slice(0, -1);
          const previousRange = wordRanges[wordRanges.length - 1];
          if (previousRange) {
            previousRange.end = Math.max(previousRange.start, previousRange.end - 1);
          }
        } else if (
          !CLOSE_PUNCTUATION_PATTERN.test(word.normalizedText)
          && !OPEN_PUNCTUATION_PATTERN.test(previousWord?.normalizedText.slice(-1) ?? "")
        ) {
          separator = " ";
        }
      }

      text += separator;
      const start = text.length;
      text += word.normalizedText;
      wordRanges.push({ word, start, end: text.length });
      previousWord = word;
    }
    lineRanges.push({
      lineId,
      start: lineStart,
      end: text.length,
      text: line.normalizedText,
      indent: line.orientation.writingMode === "horizontal"
        ? line.bounds.x
        : line.bounds.y,
      listMarker: listMarker(line.normalizedText),
    });
  }

  return { text, wordRanges, lineRanges };
};

const sentenceFragments = (
  wordIds: readonly string[],
  wordMap: ReadonlyMap<string, SemanticWord>,
): Bounds[] => {
  const byLine = new Map<string, Bounds[]>();
  for (const wordId of wordIds) {
    const word = wordMap.get(wordId);
    if (!word) continue;

    const bounds = byLine.get(word.lineId) ?? [];
    bounds.push(word.bounds);
    byLine.set(word.lineId, bounds);
  }

  return Array.from(byLine.values())
    .map((bounds) => unionBounds(bounds))
    .filter((bounds): bounds is Bounds => bounds !== null);
};

const fallbackSegmentsByLine = (
  reconstructed: ReconstructedParagraph,
): SentenceSegment[] => {
  return reconstructed.lineRanges
    .map((range) => ({
      start: range.start,
      end: range.end,
      text: reconstructed.text.slice(range.start, range.end).trim(),
    }))
    .filter((segment) => segment.text.length > 0);
};

const fallbackSegmentsByListItem = (
  reconstructed: ReconstructedParagraph,
): SentenceSegment[] => {
  const segments: SentenceSegment[] = [];
  let start: number | null = null;
  let end = 0;

  const flush = (): void => {
    if (start === null || end <= start) return;
    const text = reconstructed.text.slice(start, end).trim();
    if (text) segments.push({ start, end, text });
    start = null;
    end = 0;
  };

  for (const range of reconstructed.lineRanges) {
    if (range.listMarker && start !== null) flush();
    if (start === null) start = range.start;
    end = range.end;
  }
  flush();
  return segments;
};

const hasNaturalSentenceBoundary = (text: string): boolean => {
  let candidate = text.trim();
  const closingCharacters = "\"')]}”’";
  while (candidate.length > 0 && closingCharacters.includes(candidate.slice(-1))) {
    candidate = candidate.slice(0, -1).trimEnd();
  }
  if (!candidate) return false;

  const words = candidate.split(/\s+/u);
  if (
    words.length <= 2
    && (URL_OR_EMAIL_PATTERN.test(candidate) || PATH_OR_MEMBER_PATTERN.test(candidate))
  ) {
    return false;
  }
  return SENTENCE_END_PATTERN.test(candidate.slice(-1));
};

const isShortLabelStack = (
  reconstructed: ReconstructedParagraph,
  proseSegments: readonly SentenceSegment[],
): boolean => {
  const ranges = reconstructed.lineRanges;
  if (ranges.length < 5 || proseSegments.length > 1) return false;

  const wordCounts = ranges.map((range) =>
    range.text.trim().split(/\s+/u).filter((word) => word.length > 0).length);
  const characterCounts = ranges.map((range) => range.text.trim().length);
  const indentCounts = new Map<string, number>();
  for (const range of ranges) {
    const key = range.indent.toFixed(3);
    indentCounts.set(key, (indentCounts.get(key) ?? 0) + 1);
  }
  const repeatedIndentationRatio = Math.max(...indentCounts.values())
    / Math.max(1, ranges.length);
  const sentenceBoundaryCount = ranges
    .filter((range) => hasNaturalSentenceBoundary(range.text))
    .length;

  return repeatedIndentationRatio >= 0.8
    && median(wordCounts) <= 4
    && median(characterCounts) <= 40
    && sentenceBoundaryCount <= Math.max(1, Math.floor(ranges.length * 0.15));
};

const splitProseAtVisualSentenceBoundaries = (
  reconstructed: ReconstructedParagraph,
  proseSegments: readonly SentenceSegment[],
): SentenceSegment[] => {
  if (proseSegments.length > 1) return [...proseSegments];
  const boundaryCount = reconstructed.lineRanges
    .filter((range) => hasNaturalSentenceBoundary(range.text))
    .length;
  if (boundaryCount < 2) return [...proseSegments];

  const segments: SentenceSegment[] = [];
  let start = reconstructed.lineRanges[0]?.start ?? 0;
  let end = start;
  for (const range of reconstructed.lineRanges) {
    end = range.end;
    if (!hasNaturalSentenceBoundary(range.text)) continue;
    const text = reconstructed.text.slice(start, end).trim();
    if (text) segments.push({ start, end, text });
    start = end;
  }
  if (end < reconstructed.text.length) {
    const text = reconstructed.text.slice(start).trim();
    if (text) segments.push({ start, end: reconstructed.text.length, text });
  }
  return segments.length > 1 ? segments : [...proseSegments];
};
const classifyParagraphSegmentationMode = (
  paragraph: SemanticParagraph,
  block: LayoutBlock | undefined,
  reconstructed: ReconstructedParagraph,
  proseSegments: readonly SentenceSegment[],
): ParagraphSegmentationMode => {
  if (block?.type === "heading") return "heading";

  const lineTexts = reconstructed.lineRanges.map((range) => range.text.trim());
  const listLines = reconstructed.lineRanges.filter((range) => range.listMarker);
  if (
    listLines.length >= 2
    || (listLines.length === 1 && reconstructed.lineRanges[0]?.listMarker)
  ) {
    return "list";
  }

  const treeLines = lineTexts.filter((text) => TREE_GLYPH_PATTERN.test(text)).length;
  const codeLines = lineTexts.filter((text) =>
    CODE_KEYWORD_PATTERN.test(text)
    || CODE_SYMBOL_PATTERN.test(text)
    || PATH_OR_MEMBER_PATTERN.test(text)).length;
  const distinctIndents = new Set(
    reconstructed.lineRanges.map((range) => range.indent.toFixed(3)),
  ).size;
  const structuralLines = treeLines + codeLines;
  if (
    treeLines > 0
    || (
      lineTexts.length >= 2
      && structuralLines >= Math.max(2, Math.ceil(lineTexts.length * 0.4))
      && distinctIndents >= 2
    )
  ) {
    return "preformatted";
  }

  if (isShortLabelStack(reconstructed, proseSegments)) {
    return "preformatted";
  }

  return paragraph.lineIds.length === 1 && block?.type === "metadata"
    ? "heading"
    : "prose";
};

const segmentsForParagraph = (
  mode: ParagraphSegmentationMode,
  reconstructed: ReconstructedParagraph,
  proseSegments: readonly SentenceSegment[],
): SentenceSegment[] => {
  if (mode === "preformatted") return fallbackSegmentsByLine(reconstructed);
  if (mode === "list") return fallbackSegmentsByListItem(reconstructed);
  if (mode === "heading") {
    return [{
      start: 0,
      end: reconstructed.text.length,
      text: reconstructed.text.trim(),
    }];
  }
  return splitProseAtVisualSentenceBoundaries(reconstructed, proseSegments);
};
const buildSentences = (
  paragraphs: SemanticParagraph[],
  lines: SemanticLine[],
  words: SemanticWord[],
  blocks: LayoutBlock[],
  pageId: string,
  extractorVersion: string,
): SemanticSentence[] => {
  const lineMap = new Map(lines.map((line) => [line.id, line]));
  const wordMap = new Map(words.map((word) => [word.id, word]));
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const segmenter = createSentenceSegmenter();
  const sentences: SemanticSentence[] = [];
  let sentenceOrder = 0;

  for (const paragraph of [...paragraphs].sort((left, right) => left.readingOrder - right.readingOrder)) {
    const reconstructed = reconstructParagraph(paragraph, lineMap, wordMap);
    if (!reconstructed.text.trim()) continue;

    const proseSegments = segmenter.segment(reconstructed.text);
    const mode = classifyParagraphSegmentationMode(
      paragraph,
      blockMap.get(paragraph.blockId),
      reconstructed,
      proseSegments,
    );
    let segments = segmentsForParagraph(mode, reconstructed, proseSegments);
    if (segments.length === 0) {
      segments = [{ start: 0, end: reconstructed.text.length, text: reconstructed.text }];
    }

    for (const segment of segments) {
      const included = reconstructed.wordRanges
        .filter((range) => range.start < segment.end && range.end > segment.start)
        .map((range) => range.word);
      if (included.length === 0) continue;

      const wordIds = included.map((word) => word.id);
      const lineIds = Array.from(new Set(included.map((word) => word.lineId)));
      const fragments = sentenceFragments(wordIds, wordMap);
      const bounds = unionBounds(fragments);
      const first = included[0];
      if (!bounds || !first) continue;

      const sentenceId = createSemanticId(pageId, "SENTENCE", sentenceOrder, extractorVersion);
      sentences.push({
        id: sentenceId,
        type: "SENTENCE",
        pageId,
        text: segment.text.trim(),
        normalizedText: segment.text.trim(),
        bounds,
        fragments,
        readingOrder: sentenceOrder,
        confidence: 0.82,
        orientation: { ...paragraph.orientation },
        regionId: paragraph.regionId,
        blockId: paragraph.blockId,
        columnId: paragraph.columnId,
        wordIds,
        lineIds,
        paragraphId: paragraph.id,
        startWordId: wordIds[0] ?? "",
        endWordId: wordIds[wordIds.length - 1] ?? "",
      });
      paragraph.sentenceIds.push(sentenceId);
      sentenceOrder += 1;
    }
  }

  return sentences;
};

export const createTextItemSignature = (
  textItems: readonly PageTextItemInput[],
): string => {
  let hash = 2166136261;
  const update = (value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };

  for (const item of textItems) {
    const orientation = resolveOrientation(item);
    update(item.id);
    update(item.text);
    update(String(item.sourceIndex));
    update(item.bounds.x.toFixed(6));
    update(item.bounds.y.toFixed(6));
    update(item.bounds.width.toFixed(6));
    update(item.bounds.height.toFixed(6));
    update(orientation.angle.toFixed(6));
    update(orientation.writingMode);
    update(item.hasEOL ? "1" : "0");
  }

  return String(textItems.length) + ":" + (hash >>> 0).toString(16);
};

const emptyModelData = (
  input: BuildPageInput,
  extractorVersion: string,
  schemaVersion: number,
  sourceSignature: string,
  sourceItemCount: number,
): PageSemanticModelData => ({
  schemaVersion,
  extractorVersion,
  documentId: input.documentId,
  pageId: input.pageId,
  pageNumber: input.pageNumber,
  sourceSignature,
  words: [],
  lines: [],
  layoutRegions: [],
  layoutBlocks: [],
  columns: [],
  sentences: [],
  paragraphs: [],
  createdAt: 0,
  sourceItemCount,
  processingDurationMs: 0,
});

export const buildPageSemanticModel = (input: BuildPageInput): PageSemanticModel => {
  const extractorVersion = input.extractorVersion ?? SEMANTIC_EXTRACTOR_VERSION;
  const schemaVersion = input.schemaVersion ?? SEMANTIC_SCHEMA_VERSION;
  const sourceSignature = createTextItemSignature(input.textItems);
  const sourceItems = normalizeItems(input.textItems);

  if (sourceItems.length === 0) {
    return new PageSemanticModel(emptyModelData(
      input,
      extractorVersion,
      schemaVersion,
      sourceSignature,
      0,
    ));
  }

  const sourceWords = sourceItems.flatMap(splitToSourceWords);
  if (sourceWords.length === 0) {
    return new PageSemanticModel(emptyModelData(
      input,
      extractorVersion,
      schemaVersion,
      sourceSignature,
      sourceItems.length,
    ));
  }

  const provisionalLineFragments = buildLineDrafts(sourceWords, "provisional");
  const regionDrafts = analyzeLayout(provisionalLineFragments);
  const { placements, layoutRegions, layoutBlocks, columns } = materializeLayout(
    regionDrafts,
    input.pageId,
    extractorVersion,
  );
  const { words, lines } = buildWordsAndLines(placements, input.pageId, extractorVersion);
  const paragraphs = buildParagraphs(lines, layoutBlocks, input.pageId, extractorVersion);
  const sentences = buildSentences(
    paragraphs,
    lines,
    words,
    layoutBlocks,
    input.pageId,
    extractorVersion,
  );

  return new PageSemanticModel({
    schemaVersion,
    extractorVersion,
    documentId: input.documentId,
    pageId: input.pageId,
    pageNumber: input.pageNumber,
    sourceSignature,
    words,
    lines,
    layoutRegions,
    layoutBlocks,
    columns,
    sentences,
    paragraphs,
    createdAt: 0,
    sourceItemCount: sourceItems.length,
    processingDurationMs: 0,
  });
};

export const buildPageModel = buildPageSemanticModel;
export { PageSemanticModel };
