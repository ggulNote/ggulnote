import {
  FallbackSentenceSegmenter,
  SentenceSegment,
  createSentenceSegmenter,
} from "./segmentation";
import {
  SEMANTIC_EXTRACTOR_VERSION,
  SEMANTIC_SCHEMA_VERSION,
  LINE_BASELINE_TOLERANCE_RATIO,
  PARAGRAPH_GAP_MULTIPLIER,
} from "./constants";
import {
  clampRect,
  sortByReadingPoint,
  unionBounds,
  verticalOverlapRatio,
  yCenter,
  xCenter,
} from "./geometry";
import { PageSemanticModel } from "./page-semantic-model";
import type {
  BuildPageInput,
  PageSemanticModelData,
  PageTextItemInput,
  SemanticLine,
  SemanticObjectType,
  SemanticParagraph,
  SemanticSentence,
  SemanticWord,
  TextDirection,
} from "./types";

const DEFAULT_DIRECTION: TextDirection = "ltr";
const WORD_TOKEN_PATTERN = /(?:\p{L}[\p{L}\p{N}\-']*|\p{N}+\.\p{N}+|\.{3}|[.!?,:;()\[\]{}"“”'’])/gu;
const FALLBACK_WORD_TOKEN_PATTERN = /\S+/gu;
const FALLBACK_BOUNDARY_PATTERN = /\s+/gu;
const WORD_FALLBACK_TOKEN_BOUNDARY_PATTERN = /(\s+|[.!?,:;()\[\]{}"“”'’\-\/])/gu;
const WORD_OR_PUNCTUATION_PATTERN = /^(?:\p{L}|\p{N}|\p{P}|\p{S})+$/u;

const isCoverageComplete = (rawText: string, tokens: readonly string[]): boolean => {
  if (tokens.length === 0) {
    return false;
  }

  const compactText = rawText.replace(FALLBACK_BOUNDARY_PATTERN, "");
  const compactTokens = tokens.join("").replace(FALLBACK_BOUNDARY_PATTERN, "");

  return compactTokens.length > 0 && compactTokens === compactText;
};

const buildWordTokensBySegmenter = (text: string): string[] => {
  if (!text || !("Segmenter" in Intl)) {
    return [];
  }

  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    const tokens = Array.from(segmenter.segment(text), (entry) => entry.segment)
      .filter((token) => token.length > 0)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    const compact = tokens.filter((token) => WORD_OR_PUNCTUATION_PATTERN.test(token));
    return compact.length > 0 ? compact : tokens;
  } catch {
    return [];
  }
};
const clampPositive = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

const isFiniteBounds = (bounds: PageTextItemInput["bounds"]): boolean => {
  return Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0;
};

const normalizeDirection = (value: unknown): TextDirection => {
  if (value === "rtl" || value === "ttb" || value === "ltr") {
    return value;
  }

  return DEFAULT_DIRECTION;
};

const normalizeText = (value: string): string => {
  const normalized = value.replace(/\u00a0/g, " ").replace(/\s+/gu, " ").trim();
  return normalized;
};

const normalizeTextWithSource = (item: PageTextItemInput): PageTextItemInput => {
  const normalizedText = normalizeText(item.text);

  return {
    id: item.id,
    text: normalizedText,
    bounds: clampRect(item.bounds),
    sourceIndex: Number.isFinite(item.sourceIndex) ? item.sourceIndex : 0,
    fontName: item.fontName,
    fontSize: clampPositive(item.fontSize ?? item.bounds.height),
    direction: normalizeDirection(item.direction),
  };
};

const createSemanticId = (pageId: string, type: SemanticObjectType, readingOrder: number, extractorVersion: string): string => {
  return `${pageId}:${type.toLowerCase()}:${extractorVersion}:${readingOrder}`;
};

const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[center - 1] + sorted[center]) / 2;
  }

  return sorted[center];
};

interface SourceWordCandidate {
  text: string;
  normalizedText: string;
  bounds: PageTextItemInput["bounds"];
  sourceItemId: string;
  sourceIndex: number;
  fontName?: string;
  fontSize: number;
  direction: TextDirection;
}

const createWordTokens = (item: PageTextItemInput): string[] => {
  const text = item.text;
  if (!text) {
    return [];
  }

  const segmenterTokens = buildWordTokensBySegmenter(text);
  if (isCoverageComplete(text, segmenterTokens)) {
    return segmenterTokens;
  }

  const regexMatches = text.match(WORD_TOKEN_PATTERN);
  if (regexMatches && isCoverageComplete(text, regexMatches)) {
    return regexMatches.filter((token) => token.length > 0);
  }

  const fallbackTokens = text
    .split(WORD_FALLBACK_TOKEN_BOUNDARY_PATTERN)
    .map((token) => normalizeText(token))
    .filter((token) => token.length > 0);

  if (fallbackTokens.length > 0) {
    return fallbackTokens;
  }

  return text.match(FALLBACK_WORD_TOKEN_PATTERN) ?? [];
};
const spreadBoundsForTokens = (
  item: PageTextItemInput,
  tokens: string[],
): PageTextItemInput["bounds"][] => {
  const normalizedTokens = tokens
    .map((token) => normalizeText(token))
    .filter((token) => token.length > 0);

  if (normalizedTokens.length === 0) {
    return [];
  }

  const boundsList: PageTextItemInput["bounds"][] = [];
  const sourceText = item.text;
  const sourceLength = Math.max(1, sourceText.length);
  let sourceCursor = 0;

  for (let index = 0; index < normalizedTokens.length; index += 1) {
    const token = normalizedTokens[index] ?? "";
    const foundAt = sourceText.indexOf(token, sourceCursor);
    const tokenStart = foundAt >= 0 ? foundAt : sourceCursor;
    const tokenEnd = Math.min(sourceLength, tokenStart + Math.max(1, token.length));
    const startRatio = tokenStart / sourceLength;
    const endRatio = tokenEnd / sourceLength;
    const width = item.bounds.width * Math.max(Number.EPSILON, endRatio - startRatio);
    const x = item.direction === "rtl"
      ? item.bounds.x + item.bounds.width * (1 - endRatio)
      : item.bounds.x + item.bounds.width * startRatio;

    const tokenBounds: PageTextItemInput["bounds"] = {
      x,
      y: item.bounds.y,
      width,
      height: item.bounds.height,
    };

    const normalized = clampRect(tokenBounds);
    if (normalized.width <= 0 || normalized.height <= 0) {
      sourceCursor = tokenEnd;
      continue;
    }

    boundsList.push(normalized);
    sourceCursor = tokenEnd;
  }

  return boundsList;
};
const splitToSourceWords = (item: PageTextItemInput): SourceWordCandidate[] => {
  const tokens = createWordTokens(item);
  if (tokens.length === 0 || !isFiniteBounds(item.bounds)) {
    return [];
  }

  const normalized = item.text;
  const boundsList = spreadBoundsForTokens(item, tokens);
  const fontSize = clampPositive(item.fontSize ?? item.bounds.height);
  const result: SourceWordCandidate[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = normalizeText(tokens[index] ?? "");
    if (!token) {
      continue;
    }

    const tokenBounds = boundsList[index];
    if (!tokenBounds || tokenBounds.width <= 0 || tokenBounds.height <= 0) {
      continue;
    }

    result.push({
      text: token,
      normalizedText: token,
      bounds: tokenBounds,
      sourceItemId: item.id,
      sourceIndex: item.sourceIndex,
      fontName: item.fontName,
      fontSize,
      direction: item.direction ?? DEFAULT_DIRECTION,
    });
  }

  return result;
};

interface LineDraft {
  words: SourceWordCandidate[];
  baseline: number;
  bounds: PageTextItemInput["bounds"];
  direction: TextDirection;
  wordIndices: number[];
}

const buildLineDrafts = (
  candidates: SourceWordCandidate[],
): LineDraft[] => {
  if (candidates.length === 0) {
    return [];
  }

  const sorted = [...candidates]
    .sort((left, right) => {
      const leftCenter = yCenter(left.bounds);
      const rightCenter = yCenter(right.bounds);
      const centerDelta = leftCenter - rightCenter;

      const centerTolerance = Math.max(Number.EPSILON, Math.min(left.bounds.height, right.bounds.height) * 0.1);
      if (Number.isFinite(centerDelta) && Math.abs(centerDelta) > centerTolerance) {
        return centerDelta;
      }

      if (left.sourceIndex !== right.sourceIndex) {
        return left.sourceIndex - right.sourceIndex;
      }

      if (left.direction !== right.direction) {
        return left.direction === "rtl" ? 1 : -1;
      }

      return xCenter(left.bounds) - xCenter(right.bounds);
    });

  const heightMedian = median(sorted.map((entry) => entry.bounds.height));

  const drafts: LineDraft[] = [];
  let lineCounter = 0;

  for (const candidate of sorted) {
    const candidateCenter = yCenter(candidate.bounds);
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < drafts.length; index += 1) {
      const draft = drafts[index];
      const overlap = verticalOverlapRatio(draft.bounds, candidate.bounds);
      const baselineDistance = Math.abs(draft.baseline - candidateCenter);
      const draftHeight = median(draft.words.map((word) => word.bounds.height));
      const referenceHeight = Math.max(
        Number.EPSILON,
        candidate.bounds.height,
        draftHeight,
        heightMedian * 0.5,
      );
      const baselineTolerance = referenceHeight * 0.55;
      const hasVerticalOverlap = overlap >= 0.3;
      const hasCloseBaseline = baselineDistance <= baselineTolerance;

      if (!hasVerticalOverlap && !hasCloseBaseline) {
        continue;
      }

      if (candidate.direction !== draft.direction && !hasVerticalOverlap) {
        continue;
      }

      const distance = baselineDistance / referenceHeight + (1 - overlap) * 0.25;

      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }

    if (bestIndex < 0) {
      drafts.push({
        words: [candidate],
        baseline: candidateCenter,
        bounds: { ...candidate.bounds },
        direction: candidate.direction,
        wordIndices: [lineCounter],
      });
      lineCounter += 1;
      continue;
    }

    const draft = drafts[bestIndex];
    draft.words.push(candidate);
    draft.baseline = median(draft.words.map((entry) => yCenter(entry.bounds)));
    draft.bounds = unionBounds([draft.bounds, candidate.bounds]) ?? draft.bounds;
    draft.wordIndices.push(lineCounter);
    lineCounter += 1;
  }

  for (const draft of drafts) {
    draft.words.sort((left, right) => {
      if (left.direction === "rtl") {
        return xCenter(right.bounds) - xCenter(left.bounds);
      }

      return xCenter(left.bounds) - xCenter(right.bounds);
    });
  }

  return drafts;
};
interface ColumnDraft extends LineDraft {
  columnIndex: number;
  readingOrder: number;
}

const inferColumns = (drafts: LineDraft[]): ColumnDraft[] => {
  const sortedByCenter = [...drafts].sort((left, right) => xCenter(left.bounds) - xCenter(right.bounds));

  if (sortedByCenter.length === 0) {
    return [];
  }

  const widths = sortedByCenter.map((entry) => entry.bounds.width);
  const gapThreshold = Math.max(0.04, median(widths) * 2.2);

  let nextColumn = 0;
  const columns: { left: number; right: number }[] = [];
  const output: ColumnDraft[] = [];

  for (const draft of sortedByCenter) {
    const left = draft.bounds.x;
    const right = draft.bounds.x + draft.bounds.width;

    let matched = -1;
    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      const overlap = Math.min(column.right, right) - Math.max(column.left, left);
      if (overlap >= 0 || left - column.right <= gapThreshold) {
        matched = index;
        column.left = Math.min(column.left, left);
        column.right = Math.max(column.right, right);
        break;
      }
    }

    if (matched < 0) {
      matched = nextColumn;
      columns.push({ left, right });
      nextColumn += 1;
    }

    output.push({ ...draft, columnIndex: matched, readingOrder: 0 });
  }

  return output;
};

const normalizeLineText = (words: SourceWordCandidate[]): string => {
  if (words.length === 0) {
    return "";
  }

  const normalized = words.map((word) => word.normalizedText.trim()).filter(Boolean);
  return normalized.join(" ").trim();
};

const buildWords = (orderedLines: ColumnDraft[], pageId: string, extractorVersion: string): {
  words: SemanticWord[];
  lineWordIds: Map<string, string[]>;
} => {
  const words: SemanticWord[] = [];
  const lineWordIds = new Map<string, string[]>();

  let order = 0;
  for (const line of orderedLines) {
    const lineId = createSemanticId(pageId, "LINE", line.readingOrder, extractorVersion);
    const ids: string[] = [];

    for (const word of line.words) {
      const wordId = createSemanticId(pageId, "WORD", order, extractorVersion);
      const normalizedText = word.normalizedText;

      words.push({
        id: wordId,
        type: "WORD",
        pageId,
        text: word.text,
        normalizedText,
        bounds: word.bounds,
        readingOrder: order,
        confidence: clampPositive(Math.min(1, 0.6 + (word.fontSize / 20))),
        sourceItemIds: [word.sourceItemId],
        lineId,
        direction: word.direction,
        fontName: word.fontName,
        fontSize: word.fontSize,
        startsWithPunctuation: /^[\p{P}\p{S}]/u.test(normalizedText),
        endsWithPunctuation: /[\p{P}\p{S}]$|\.$/u.test(normalizedText),
      });

      ids.push(wordId);
      order += 1;
    }

    lineWordIds.set(lineId, ids);
  }

  return { words, lineWordIds };
};

const resolveLineReadingOrder = (drafts: ColumnDraft[]): ColumnDraft[] => {
  return [...drafts]
    .sort((left, right) => {
      if (left.columnIndex !== right.columnIndex) {
        return left.columnIndex - right.columnIndex;
      }

      const baselineDelta = left.baseline - right.baseline;
      if (Number.isFinite(baselineDelta) && Math.abs(baselineDelta) > Number.EPSILON) {
        return baselineDelta;
      }

      if (left.direction === "rtl" && right.direction === "rtl") {
        return xCenter(right.bounds) - xCenter(left.bounds);
      }

      return xCenter(left.bounds) - xCenter(right.bounds);
    })
    .map((draft, index) => ({
      ...draft,
      readingOrder: index,
    }));
};

const buildLines = (
  lineDrafts: ColumnDraft[],
  pageId: string,
  extractorVersion: string,
  words: SemanticWord[],
  lineWordIds: Map<string, string[]>,
): SemanticLine[] => {
  const lines: SemanticLine[] = [];

  for (const draft of lineDrafts) {
    const lineId = createSemanticId(pageId, "LINE", draft.readingOrder, extractorVersion);
    const wordIds = lineWordIds.get(lineId) ?? words
      .filter((word) => word.lineId === lineId)
      .map((word) => word.id);
    const text = normalizeLineText(draft.words);
    const bounds = unionBounds(draft.words.map((word) => word.bounds)) ?? draft.bounds;
    const fonts = draft.words.map((word) => word.fontSize).filter((font) => font > 0);

    const line: SemanticLine = {
      id: lineId,
      type: "LINE",
      pageId,
      text,
      normalizedText: text,
      bounds,
      readingOrder: draft.readingOrder,
      confidence: wordIds.length > 0 ? 0.75 : 0.3,
      wordIds,
      paragraphId: null,
      baseline: yCenter(bounds),
      direction: draft.direction,
      averageFontSize: fonts.length === 0 ? undefined : fonts.reduce((left, right) => left + right, 0) / fonts.length,
      columnIndex: draft.columnIndex,
    };

    lines.push(line);
  }

  return lines;
};
const SENTENCE_END_MARKS = new Set([".", "!", "?", "。", "！", "？"]);

const buildFallbackSentencesByLines = (
  words: SemanticWord[],
  lines: SemanticLine[],
  pageId: string,
  extractorVersion: string,
): SemanticSentence[] => {
  if (words.length === 0) {
    return [];
  }

  const sortedLines = [...lines].sort(sortByReadingPoint);
  const lineWordIds = new Map<string, string[]>();
  const lineIds = sortedLines
    .map((line) => {
      const ids = words
        .filter((word) => word.lineId === line.id)
        .map((word) => word.id);
      if (ids.length === 0) {
        return "";
      }

      lineWordIds.set(line.id, ids);
      return line.id;
    })
    .filter((value): value is string => value.length > 0);

  if (lineIds.length === 0) {
    return [];
  }

  return lineIds.map((lineId, order): SemanticSentence | null => {
    const ids = lineWordIds.get(lineId) ?? [];
    if (ids.length === 0) {
      return null;
    }

    const bounds = ids
      .map((id) => words.find((word) => word.id === id)?.bounds)
      .filter((rect): rect is NonNullable<typeof rect> => typeof rect !== "undefined");
    const text = ids
      .map((id) => words.find((word) => word.id === id)?.normalizedText)
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join(" ");

    return {
      id: createSemanticId(pageId, "SENTENCE", order, extractorVersion),
      type: "SENTENCE",
      pageId,
      text,
      normalizedText: text,
      bounds: unionBounds(bounds) ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      readingOrder: order,
      confidence: 0.74,
      wordIds: ids,
      lineIds: [lineId],
      paragraphId: null,
      startWordId: ids[0] ?? "",
      endWordId: ids[ids.length - 1] ?? "",
    };
  })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
};

const buildSentences = (
  words: SemanticWord[],
  lines: SemanticLine[],
  pageId: string,
  extractorVersion: string,
): SemanticSentence[] => {
  if (words.length === 0) {
    return [];
  }

  const sortedWords = [...words].sort(sortByReadingPoint);
  const normalizedText = sortedWords
    .map((word) => word.normalizedText)
    .join(" ")
    .trim();

  if (normalizedText.length === 0) {
    return [];
  }

  const segmenter = createSentenceSegmenter();
  const segments = segmenter.segment(normalizedText);
  const fallbackSegments = segments.length > 0
    ? segments
    : [{
      start: 0,
      end: normalizedText.length,
      text: normalizedText,
    }];

  const hasSentenceEnd = normalizedText.split("").some((char) => SENTENCE_END_MARKS.has(char));
  if (lines.length > 1 && (!hasSentenceEnd || fallbackSegments.length === 1)) {
    const fallback = buildFallbackSentencesByLines(sortedWords, lines, pageId, extractorVersion);
    if (fallback.length > 0) {
      return fallback;
    }
  }

  const wordCharacterRanges = (() => {
    let cursor = 0;
    return sortedWords.map((word) => {
      const start = cursor;
      const end = start + word.normalizedText.length;
      cursor = end + 1;
      return { start, end };
    });
  })();

  const positions = fallbackSegments
      .map((segment) => {
        const text = segment.text.trim();
        if (!text) {
          return null;
        }

        const includedWordIndices = wordCharacterRanges
          .map((range, index) => ({ range, index }))
          .filter(({ range }) => range.end > segment.start && range.start < segment.end)
          .map(({ index }) => index);
        const start = includedWordIndices[0] ?? 0;
        const end = (includedWordIndices[includedWordIndices.length - 1] ?? -1) + 1;

        return { start, end, segment };
      })
      .filter((position): position is { start: number; end: number; segment: SentenceSegment } => position !== null)
      .filter((position) => position.end > position.start);

  const result: SemanticSentence[] = [];
  let order = 0;

  for (const position of positions) {
    const wordIds = sortedWords
      .slice(position.start, position.end)
      .map((word) => word.id);

    if (wordIds.length === 0) {
      continue;
    }

    const sentenceLineIds = Array.from(
      new Set(
        wordIds
          .map((id) => sortedWords.find((word) => word.id === id)?.lineId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );

    const sentenceWordBounds = wordIds
      .map((wordId) => sortedWords.find((word) => word.id === wordId)?.bounds)
      .filter((rect): rect is NonNullable<typeof rect> => typeof rect !== "undefined");

    const sentenceText = wordIds
      .map((wordId) => sortedWords.find((word) => word.id === wordId)?.normalizedText)
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join(" ");

    const bounds = unionBounds(sentenceWordBounds) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };

    result.push({
      id: createSemanticId(pageId, "SENTENCE", order, extractorVersion),
      type: "SENTENCE",
      pageId,
      text: sentenceText,
      normalizedText: sentenceText,
      bounds,
      readingOrder: order,
      confidence: 0.7,
      wordIds,
      lineIds: sentenceLineIds,
      paragraphId: null,
      startWordId: wordIds[0] ?? "",
      endWordId: wordIds[wordIds.length - 1] ?? "",
    });
    order += 1;
  }

  if (result.length > 0) {
    return result;
  }

  return [
    {
      id: createSemanticId(pageId, "SENTENCE", 0, extractorVersion),
      type: "SENTENCE",
      pageId,
      text: normalizedText,
      normalizedText,
      bounds: unionBounds(sortedWords.map((word) => word.bounds)) ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      readingOrder: 0,
      confidence: 0.65,
      wordIds: sortedWords.map((word) => word.id),
      lineIds: [...new Set(lines.map((line) => line.id))],
      paragraphId: null,
      startWordId: sortedWords[0]?.id ?? "",
      endWordId: sortedWords[sortedWords.length - 1]?.id ?? "",
    },
  ];
};
const buildParagraphs = (
  lines: SemanticLine[],
  sentences: SemanticSentence[],
  pageId: string,
  extractorVersion: string,
): SemanticParagraph[] => {
  if (lines.length === 0) {
    return [];
  }

  const sortedLines = [...lines].sort(sortByReadingPoint);
  const gaps = sortedLines
    .slice(1)
    .map((current, index) => {
      const prev = sortedLines[index];
      if (!prev || !current.bounds) {
        return 0;
      }

      return current.bounds.y - (prev.bounds.y + prev.bounds.height);
    })
    .filter((value) => value > 0);

  const typicalLineHeight = median(sortedLines.map((line) => line.bounds.height));
  const gapThreshold = gaps.length > 0
    ? Math.max(typicalLineHeight * 0.75, median(gaps) * PARAGRAPH_GAP_MULTIPLIER)
    : Number.POSITIVE_INFINITY;

  let nextOrder = 0;
  const paragraphs: SemanticParagraph[] = [];
  let currentLineIds: string[] = [];
  let currentSentenceIds: string[] = [];
  let currentColumn = sortedLines[0]!.columnIndex;
  let previousLine: SemanticLine | null = null;

  const flushParagraph = () => {
    if (currentLineIds.length === 0) {
      return;
    }

    const text = currentLineIds
      .map((lineId) => lines.find((line) => line.id === lineId)?.normalizedText)
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join(" ");

    const bounds = unionBounds(currentLineIds
      .map((lineId) => lines.find((line) => line.id === lineId)?.bounds)
      .filter((entry): entry is NonNullable<typeof entry> => typeof entry !== "undefined")
    ) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };

    const paragraph: SemanticParagraph = {
      id: createSemanticId(pageId, "PARAGRAPH", nextOrder, extractorVersion),
      type: "PARAGRAPH",
      pageId,
      text,
      normalizedText: text,
      bounds,
      readingOrder: nextOrder,
      confidence: 0.75,
      lineIds: [...currentLineIds],
      sentenceIds: [...new Set(currentSentenceIds)],
      columnIndex: currentColumn,
      averageFontSize: undefined,
    };

    for (const lineId of currentLineIds) {
      const line = lines.find((entry) => entry.id === lineId);
      if (line) {
        line.paragraphId = paragraph.id;
      }
    }

    for (const sentenceId of currentSentenceIds) {
      const sentence = sentences.find((entry) => entry.id === sentenceId);
      if (sentence) {
        sentence.paragraphId = paragraph.id;
      }
    }

    paragraphs.push(paragraph);
    nextOrder += 1;
    currentLineIds = [];
    currentSentenceIds = [];
  };

  for (const line of sortedLines) {
    const paragraphBoundary = (() => {
      if (!previousLine) {
        return false;
      }

      if (line.columnIndex !== currentColumn) {
        return true;
      }

      const gap = line.bounds.y - (previousLine.bounds.y + previousLine.bounds.height);
      if (gap > gapThreshold) {
        return true;
      }

      const indentDiff = Math.abs(line.bounds.x - previousLine.bounds.x);
      if (indentDiff > previousLine.bounds.width * 0.2 && previousLine.bounds.width > 0) {
        return true;
      }

      return false;
    })();

    if (paragraphBoundary) {
      flushParagraph();
      currentColumn = line.columnIndex;
    }

    currentLineIds.push(line.id);

    const sentenceIds = sentences
      .filter((sentence) => sentence.lineIds.some((lineId) => lineId === line.id))
      .map((sentence) => sentence.id);
    for (const sentenceId of sentenceIds) {
      if (!currentSentenceIds.includes(sentenceId)) {
        currentSentenceIds.push(sentenceId);
      }
    }

    previousLine = line;
  }

  flushParagraph();
  return paragraphs;
};

const normalizeItems = (items: PageTextItemInput[]): PageTextItemInput[] => {
  return items
    .map((item, index) => normalizeTextWithSource({
      ...item,
      id: item.id || `${index}`,
      sourceIndex: Number.isFinite(item.sourceIndex) ? item.sourceIndex : index,
    }))
    .filter((item) => item.text.length > 0)
    .filter((item) => isFiniteBounds(item.bounds))
    .sort((left, right) => {
      if (left.sourceIndex !== right.sourceIndex) {
        return left.sourceIndex - right.sourceIndex;
      }

      return xCenter(left.bounds) - xCenter(right.bounds);
    });
};

export const buildPageSemanticModel = (input: BuildPageInput): PageSemanticModel => {
  const extractorVersion = input.extractorVersion ?? SEMANTIC_EXTRACTOR_VERSION;
  const schemaVersion = input.schemaVersion ?? SEMANTIC_SCHEMA_VERSION;

  const sourceItems = normalizeItems(input.textItems);
  if (sourceItems.length === 0) {
    return new PageSemanticModel({
      schemaVersion,
      extractorVersion,
      documentId: input.documentId,
      pageId: input.pageId,
      pageNumber: input.pageNumber,
      words: [],
      lines: [],
      sentences: [],
      paragraphs: [],
      createdAt: 0,
      sourceItemCount: 0,
      processingDurationMs: 0,
    });
  }

  const sourceWordCandidates = sourceItems.flatMap((item) => splitToSourceWords(item));
  if (sourceWordCandidates.length === 0) {
    return new PageSemanticModel({
      schemaVersion,
      extractorVersion,
      documentId: input.documentId,
      pageId: input.pageId,
      pageNumber: input.pageNumber,
      words: [],
      lines: [],
      sentences: [],
      paragraphs: [],
      createdAt: 0,
      sourceItemCount: sourceItems.length,
      processingDurationMs: 0,
    });
  }

  const lineDrafts = inferColumns(buildLineDrafts(sourceWordCandidates));
  const lineDraftWithOrder = lineDrafts
    .map((draft) => ({
      ...draft,
      readingOrder: 0,
    }))
    .sort((left, right) => {
      if (left.columnIndex !== right.columnIndex) {
        return left.columnIndex - right.columnIndex;
      }

      return left.baseline - right.baseline;
    });

  for (let index = 0; index < lineDraftWithOrder.length; index += 1) {
    lineDraftWithOrder[index] = {
      ...lineDraftWithOrder[index],
      readingOrder: index,
    };
  }

  const { words, lineWordIds } = buildWords(lineDraftWithOrder, input.pageId, extractorVersion);

  const lines = buildLines(lineDraftWithOrder, input.pageId, extractorVersion, words, lineWordIds);
  for (const line of lines) {
    const orderedIds = lineWordIds.get(line.id);
    if (orderedIds) {
      line.wordIds = orderedIds.filter((value, index, all) => all.indexOf(value) === index);
    }
  }

  const sentences = buildSentences(words, lines, input.pageId, extractorVersion);
  const paragraphs = buildParagraphs(lines, sentences, input.pageId, extractorVersion);

  const model: PageSemanticModelData = {
    schemaVersion,
    extractorVersion,
    documentId: input.documentId,
    pageId: input.pageId,
    pageNumber: input.pageNumber,
    words,
    lines,
    sentences,
    paragraphs,
    createdAt: 0,
    sourceItemCount: sourceItems.length,
    processingDurationMs: 0,
  };

  return new PageSemanticModel(model);
};

// export alias for compatibility
export const buildPageModel = buildPageSemanticModel;
export { PageSemanticModel };
