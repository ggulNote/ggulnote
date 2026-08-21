import type { Rect } from "@ggulnote/editor-core";
import type {
  PageSemanticModel,
  SemanticLine,
  SemanticSentence,
  SemanticWord,
} from "@ggulnote/document-core";
import type { TextSpanTargetQuery } from "../domain";
import { compactGroundingText, normalizeGroundingText } from "./candidate-ranker";

export interface CanonicalTextToken {
  id: string;
  pageId: string;

  text: string;
  normalizedText: string;

  readingOrder: number;

  paragraphId?: string;
  sentenceId?: string;
  lineId?: string;

  sourceObjectId?: string;

  bounds: Rect;

  charStart?: number;
  charEnd?: number;
}

export interface CanonicalTextStream {
  pageId: string;
  tokens: readonly CanonicalTextToken[];
}

export interface TextSpanRange {
  startIndex: number;
  endIndex: number;
}

export type TextSpanRangeResolution =
  | {
      status: "RESOLVED";
      range: TextSpanRange;
      text: string;
      bounds: readonly Rect[];
      tokens: readonly CanonicalTextToken[];
      selectedTokens: readonly CanonicalTextToken[];
    }
  | {
      status: "AMBIGUOUS";
      candidates: readonly TextSpanRange[];
    }
  | {
      status: "NOT_FOUND";
      reason:
        | "START_ANCHOR_NOT_FOUND"
        | "END_ANCHOR_NOT_FOUND"
        | "NO_FORWARD_SPAN"
        | "UNSUPPORTED_QUERY";
    };

export interface CanonicalTextStreamInput {
  semanticModel: PageSemanticModel;
  pageId: string;
  boundsBySourceObjectId: ReadonlyMap<string, Rect>;
}

export function buildCanonicalTextStream(
  input: CanonicalTextStreamInput,
): CanonicalTextStream {
  const lineById = buildLineMap(input.semanticModel);
  const sentenceByWordId = buildSentenceByWordIdMap(input.semanticModel);
  const wordCandidates: CanonicalTextToken[] = [];
  for (const candidate of input.semanticModel.getAllByReadingOrder()) {
    if (candidate.type !== "WORD" || candidate.pageId !== input.pageId) {
      continue;
    }
    const bounds = input.boundsBySourceObjectId.get(candidate.id);
    if (bounds === undefined) continue;
    const line = lineById.get(candidate.lineId);
    const sourceRange = candidate.sourceRanges.at(0);
    wordCandidates.push({
      id: `canonical:word:${candidate.id}`,
      pageId: candidate.pageId,
      text: candidate.text,
      normalizedText: normalizeGroundingText(candidate.text),
      readingOrder: candidate.readingOrder,
      paragraphId: line?.paragraphId ?? undefined,
      sentenceId: sentenceByWordId.get(candidate.id),
      lineId: candidate.lineId,
      sourceObjectId: candidate.id,
      bounds: { ...bounds },
      ...(sourceRange === undefined ? {} : {
        ...(sourceRange.startOffset === undefined ? {} : { charStart: sourceRange.startOffset }),
        ...(sourceRange.endOffset === undefined ? {} : { charEnd: sourceRange.endOffset }),
      }),
    });
  }
  wordCandidates.sort((left, right) => {
    if (left.readingOrder !== right.readingOrder) {
      return left.readingOrder - right.readingOrder;
    }
    return left.id.localeCompare(right.id);
  });

  if (wordCandidates.length > 0) {
    return {
      pageId: input.pageId,
      tokens: wordCandidates,
    };
  }

  const lineCandidates: CanonicalTextToken[] = [];
  for (const candidate of input.semanticModel.getAllByReadingOrder()) {
    if (candidate.type !== "LINE" || candidate.pageId !== input.pageId) {
      continue;
    }
    const bounds = input.boundsBySourceObjectId.get(candidate.id);
    if (bounds === undefined) {
      continue;
    }
    lineCandidates.push({
      id: `canonical:line:${candidate.id}`,
      pageId: candidate.pageId,
      text: candidate.text,
      normalizedText: normalizeGroundingText(candidate.text),
      readingOrder: candidate.readingOrder,
      paragraphId: candidate.paragraphId === null ? undefined : candidate.paragraphId,
      lineId: candidate.id,
      sourceObjectId: candidate.id,
      bounds: { ...bounds },
    });
  }

  lineCandidates.sort((left, right) => {
    if (left.readingOrder !== right.readingOrder) {
      return left.readingOrder - right.readingOrder;
    }
    return left.id.localeCompare(right.id);
  });

  return {
    pageId: input.pageId,
    tokens: lineCandidates,
  };
}

export function resolveTextSpanWithCanonicalStream(
  stream: CanonicalTextStream,
  query: TextSpanTargetQuery,
): TextSpanRangeResolution {
  if (!isQuerySupported(query)) {
    return {
      status: "NOT_FOUND",
      reason: "UNSUPPORTED_QUERY",
    };
  }

  if (query.quote !== undefined) {
    const matches = findTextRanges(stream.tokens, query.quote);
    if (matches.length === 0) {
      return {
        status: "NOT_FOUND",
        reason: "START_ANCHOR_NOT_FOUND",
      };
    }
    return buildSingleMatchResult(stream, matches);
  }

  const startMatches = findTextRanges(
    stream.tokens,
    query.startAnchor ?? "",
  );
  if (startMatches.length === 0) {
    return {
      status: "NOT_FOUND",
      reason: "START_ANCHOR_NOT_FOUND",
    };
  }

  const endMatches = findTextRanges(
    stream.tokens,
    query.endAnchor ?? "",
  );
  if (endMatches.length === 0) {
    return {
      status: "NOT_FOUND",
      reason: "END_ANCHOR_NOT_FOUND",
    };
  }

  const candidatePairs = buildCandidatePairs(startMatches, endMatches);
  if (candidatePairs.length === 0) {
    return {
      status: "NOT_FOUND",
      reason: "NO_FORWARD_SPAN",
    };
  }

  return buildPairMatchResult(stream, candidatePairs);
}

export function materializeCanonicalTextRange(
  stream: CanonicalTextStream,
  range: TextSpanRange,
): TextSpanRangeResolution {
  if (
    !Number.isInteger(range.startIndex)
    || !Number.isInteger(range.endIndex)
    || range.startIndex < 0
    || range.endIndex >= stream.tokens.length
    || range.startIndex > range.endIndex
  ) {
    return { status: "NOT_FOUND", reason: "NO_FORWARD_SPAN" };
  }
  const materialized = materializeTextSpan(stream.tokens, range);
  return {
    status: "RESOLVED",
    range: { ...range },
    text: materialized.text,
    bounds: materialized.bounds,
    tokens: stream.tokens,
    selectedTokens: materialized.tokens,
  };
}

function isQuerySupported(query: TextSpanTargetQuery): boolean {
  return query.quote !== undefined
    || (query.startAnchor !== undefined && query.endAnchor !== undefined);
}

function buildSingleMatchResult(
  stream: CanonicalTextStream,
  matches: readonly TextSpanRange[],
): TextSpanRangeResolution {
  if (matches.length === 1) {
    const range = matches[0];
    if (range === undefined) {
      return {
        status: "NOT_FOUND",
        reason: "START_ANCHOR_NOT_FOUND",
      };
    }
    const materialized = materializeTextSpan(stream.tokens, range);
    return {
      status: "RESOLVED",
      range,
      text: materialized.text,
      bounds: materialized.bounds,
      tokens: stream.tokens,
      selectedTokens: materialized.tokens,
    };
  }
  return {
    status: "AMBIGUOUS",
    candidates: [...matches],
  };
}

function buildPairMatchResult(
  stream: CanonicalTextStream,
  pairs: readonly TextSpanRange[],
): TextSpanRangeResolution {
  const startIndexes = new Set(pairs.map((pair) => pair.startIndex));
  const nearestEndIndex = startIndexes.size === 1
    ? Math.min(...pairs.map((pair) => pair.endIndex))
    : undefined;
  const nearestPairs = nearestEndIndex === undefined
    ? pairs
    : pairs.filter((pair) => pair.endIndex === nearestEndIndex);
  if (nearestPairs.length === 1) {
    const range = nearestPairs[0];
    if (range === undefined) {
      return {
        status: "NOT_FOUND",
        reason: "NO_FORWARD_SPAN",
      };
    }
    const materialized = materializeTextSpan(stream.tokens, range);
    return {
      status: "RESOLVED",
      range,
      text: materialized.text,
      bounds: materialized.bounds,
      tokens: stream.tokens,
      selectedTokens: materialized.tokens,
    };
  }

  return {
    status: "AMBIGUOUS",
    candidates: [...pairs],
  };
}

function buildCandidatePairs(
  startMatches: readonly TextSpanRange[],
  endMatches: readonly TextSpanRange[],
): TextSpanRange[] {
  const pairs = new Map<string, TextSpanRange>();
  for (const start of startMatches) {
    for (const end of endMatches) {
      if (
        start.startIndex <= end.startIndex
        && start.endIndex <= end.endIndex
      ) {
        const pair: TextSpanRange = {
          startIndex: start.startIndex,
          endIndex: Math.max(end.endIndex, start.startIndex),
        };
        pairs.set(`${pair.startIndex}:${pair.endIndex}`, pair);
      }
    }
  }
  return [...pairs.values()].sort((left, right) => {
    if (left.startIndex !== right.startIndex) return left.startIndex - right.startIndex;
    if (left.endIndex !== right.endIndex) return left.endIndex - right.endIndex;
    return 0;
  });
}

function findTextRanges(
  tokens: readonly CanonicalTextToken[],
  anchor: string,
): TextSpanRange[] {
  const normalized = normalizeTokenText(anchor);
  if (normalized.length === 0) {
    return [];
  }

  const tokenTexts = tokens.map((token) => compactGroundingText(token.text));
  const result: TextSpanRange[] = [];
  for (let start = 0; start < tokenTexts.length; start += 1) {
    let compactedPhrase = "";
    for (let end = start; end < tokenTexts.length; end += 1) {
      const tokenText = tokenTexts[end];
      if (tokenText.length === 0) {
        continue;
      }
      compactedPhrase += tokenText;
      if (compactedPhrase === normalized) {
        result.push({ startIndex: start, endIndex: end });
      }
      if (compactedPhrase.length > normalized.length + 8) {
        break;
      }
    }
  }

  return result;
}

function materializeTextSpan(
  tokens: readonly CanonicalTextToken[],
  range: TextSpanRange,
): {
  text: string;
  bounds: readonly Rect[];
  tokens: readonly CanonicalTextToken[];
} {
  const selected = tokens.slice(range.startIndex, range.endIndex + 1);
  const text = selected.map((token) => token.text).join(" ");
  const lineBounds = new Map<string, Rect[]>();

  selected.forEach((token) => {
    const lineKey = token.lineId ?? `token-line:${token.id}`;
    const current = lineBounds.get(lineKey);
    if (current === undefined) {
      lineBounds.set(lineKey, [token.bounds]);
    } else {
      current.push(token.bounds);
    }
  });

  return {
    text,
    bounds: [...lineBounds.values()].map((group) => unionRectangles(group)),
    tokens: selected,
  };
}

function buildLineMap(model: PageSemanticModel): Map<string, SemanticLine> {
  const lineById = new Map<string, SemanticLine>();
  for (const candidate of model.getAllByReadingOrder()) {
    if (candidate.type === "LINE") {
      lineById.set(candidate.id, candidate);
    }
  }
  return lineById;
}

function buildSentenceByWordIdMap(model: PageSemanticModel): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const sentence of model.getAllByReadingOrder()) {
    if (sentence.type !== "SENTENCE") continue;
    const typed = sentence as SemanticSentence;
    for (const wordId of typed.wordIds) {
      mapping.set(wordId, typed.id);
    }
  }
  return mapping;
}

function normalizeTokenText(value: string): string {
  return compactGroundingText(normalizeGroundingText(value));
}

function unionRectangles(rects: readonly Rect[]): Rect {
  const first = rects[0];
  if (first === undefined) {
    throw new Error("Expected at least one rectangle to union.");
  }

  return rects.slice(1).reduce((acc, rect) => ({
    x: Math.min(acc.x, rect.x),
    y: Math.min(acc.y, rect.y),
    width: Math.max(acc.x + acc.width, rect.x + rect.width) - Math.min(acc.x, rect.x),
    height: Math.max(acc.y + acc.height, rect.y + rect.height) - Math.min(acc.y, rect.y),
  }), { ...first });
}
