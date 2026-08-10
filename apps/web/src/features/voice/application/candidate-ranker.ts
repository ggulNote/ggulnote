import type {
  CandidateEvidence,
  PageTargetCandidate,
  RankedTargetCandidate,
  TargetResolutionInput,
} from "../domain";
import type { TargetQuery, TextSpanTargetQuery } from "../domain";
import {
  TARGET_STRATEGY_CONFIG,
  type TargetEvidenceWeights,
} from "./target-resolution-policy";

const TEXT_LIKE_TYPES = new Set([
  "sentence",
  "paragraph",
  "line",
  "word",
  "text",
]);

export function rankTargetCandidates(
  input: TargetResolutionInput,
  options: {
    semanticMatches?: ReadonlyMap<string, number>;
    weights?: TargetEvidenceWeights;
  } = {},
): RankedTargetCandidate[] {
  const candidates = input.catalog.candidates.filter((candidate) =>
    candidateMatchesQueryType(candidate, input.query));
  const createdAtOrder = [...candidates]
    .filter((candidate) => candidate.createdAt !== undefined)
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));

  return candidates
    .map((candidate) => {
      const evidence = buildCandidateEvidence(
        candidate,
        input,
        createdAtOrder,
        options.semanticMatches,
      );
      return {
        candidate,
        score: scoreCandidateEvidence(
          evidence,
          options.weights ?? TARGET_STRATEGY_CONFIG[input.query.kind].weights,
        ),
        evidence,
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      const readingOrder = (left.candidate.readingOrder ?? Number.MAX_SAFE_INTEGER)
        - (right.candidate.readingOrder ?? Number.MAX_SAFE_INTEGER);
      return readingOrder !== 0
        ? readingOrder
        : left.candidate.candidateId.localeCompare(right.candidate.candidateId);
    });
}

export function normalizeGroundingText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function compactGroundingText(value: string): string {
  return normalizeGroundingText(value).replace(/\s+/gu, "");
}

export function fuzzyTextSimilarity(left: string, right: string): number {
  const normalizedLeft = compactGroundingText(left).slice(0, 512);
  const normalizedRight = compactGroundingText(right).slice(0, 2048);
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) return 0;
  if (
    normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft)
  ) {
    return 1;
  }

  const query = normalizedLeft.length <= normalizedRight.length
    ? normalizedLeft
    : normalizedRight;
  const candidate = normalizedLeft.length <= normalizedRight.length
    ? normalizedRight
    : normalizedLeft;
  const minimumWindow = Math.max(1, query.length - 2);
  const maximumWindow = Math.min(candidate.length, query.length + 2);
  let best = normalizedLevenshteinSimilarity(query, candidate);

  for (let windowSize = minimumWindow; windowSize <= maximumWindow; windowSize += 1) {
    for (let start = 0; start + windowSize <= candidate.length; start += 1) {
      best = Math.max(
        best,
        normalizedLevenshteinSimilarity(
          query,
          candidate.slice(start, start + windowSize),
        ),
      );
    }
  }
  return best;
}

function buildCandidateEvidence(
  candidate: PageTargetCandidate,
  input: TargetResolutionInput,
  createdAtOrder: readonly PageTargetCandidate[],
  semanticMatches?: ReadonlyMap<string, number>,
): CandidateEvidence {
  const queryText = textForQuery(input.query);
  const operationIndex = input.recentOperations.findIndex((operation) =>
    operation.targetSceneObjectId !== undefined
      && operation.targetSceneObjectId === candidate.sceneObjectId);
  const createdAtIndex = createdAtOrder.findIndex(
    (entry) => entry.candidateId === candidate.candidateId,
  );
  const temporalMatch = input.recentOperations.length > 0
    ? operationIndex < 0
      ? 0
      : 1 - (
        operationIndex / Math.max(1, input.recentOperations.length - 1)
      ) * 0.75
    : createdAtOrder.length > 0
      ? createdAtIndex < 0
        ? 0
        : 1 - (
          createdAtIndex / Math.max(1, createdAtOrder.length - 1)
        ) * 0.75
      : null;
  const focusMatch = input.frozenContext.focusObjectId === undefined
    ? null
    : candidate.sceneObjectId === input.frozenContext.focusObjectId
      ? 1
      : 0;

  return {
    typeMatch: 1,
    lexicalMatch: queryText === undefined || candidate.text === undefined
      ? null
      : lexicalMatch(input.query, candidate.text),
    fuzzyMatch: queryText === undefined || candidate.text === undefined
      ? null
      : fuzzyMatch(input.query, candidate.text),
    semanticMatch: semanticMatches?.get(candidate.candidateId) ?? null,
    mathMatch: null,
    temporalMatch,
    structuralMatch: structuralMatch(input.query, candidate),
    focusMatch,
  };
}

function candidateMatchesQueryType(
  candidate: PageTargetCandidate,
  query: TargetQuery,
): boolean {
  switch (query.kind) {
    case "text_span":
      return TEXT_LIKE_TYPES.has(candidate.type) && candidate.text !== undefined;
    case "semantic_unit":
      return candidate.semanticUnit === query.unit;
    case "object":
      return candidate.type === query.objectType;
    case "relative":
      return query.objectType === undefined || candidate.type === query.objectType;
    case "subrange":
      return false;
  }
}

function textForQuery(query: TargetQuery): string | undefined {
  switch (query.kind) {
    case "text_span":
      return query.quote
        ?? [query.startAnchor, query.endAnchor]
          .filter((value): value is string => value !== undefined)
          .join(" ");
    case "semantic_unit":
    case "object":
      return query.query;
    case "relative":
    case "subrange":
      return undefined;
  }
}

function lexicalMatch(query: TargetQuery, candidateText: string): number {
  if (query.kind === "text_span" && query.quote === undefined) {
    const anchors = [query.startAnchor, query.endAnchor]
      .filter((value): value is string => value !== undefined);
    return anchors.reduce(
      (score, anchor) =>
        score + (compactGroundingText(candidateText).includes(
          compactGroundingText(anchor),
        ) ? 1 : 0),
      0,
    ) / Math.max(1, anchors.length);
  }
  const queryText = textForQuery(query);
  if (queryText === undefined) return 0;
  const compactQuery = compactGroundingText(queryText);
  const compactCandidate = compactGroundingText(candidateText);
  if (
    compactCandidate.includes(compactQuery)
    || compactQuery.includes(compactCandidate)
  ) {
    return 1;
  }

  const queryTokens = new Set(normalizeGroundingText(queryText).split(" "));
  const candidateTokens = new Set(normalizeGroundingText(candidateText).split(" "));
  const intersection = [...queryTokens].filter((token) =>
    token.length > 0 && candidateTokens.has(token)).length;
  return intersection / Math.max(1, queryTokens.size);
}

function fuzzyMatch(query: TargetQuery, candidateText: string): number {
  if (query.kind === "text_span" && query.quote === undefined) {
    const anchors = [query.startAnchor, query.endAnchor]
      .filter((value): value is string => value !== undefined);
    return anchors.reduce(
      (score, anchor) => score + fuzzyTextSimilarity(anchor, candidateText),
      0,
    ) / Math.max(1, anchors.length);
  }
  const queryText = textForQuery(query);
  return queryText === undefined ? 0 : fuzzyTextSimilarity(queryText, candidateText);
}

function structuralMatch(
  query: TargetQuery,
  candidate: PageTargetCandidate,
): number {
  switch (query.kind) {
    case "text_span":
      return textSpanStructuralMatch(query, candidate.text ?? "");
    case "semantic_unit":
      return candidate.semanticUnit === query.unit ? 1 : 0;
    case "object":
      return candidate.type === query.objectType ? 1 : 0;
    case "relative":
      return query.objectType === undefined || candidate.type === query.objectType
        ? 1
        : 0;
    case "subrange":
      return 0;
  }
}

function textSpanStructuralMatch(
  query: TextSpanTargetQuery,
  candidateText: string,
): number {
  const candidate = compactGroundingText(candidateText);
  if (query.quote !== undefined) {
    return candidate.includes(compactGroundingText(query.quote)) ? 1 : 0;
  }
  const start = compactGroundingText(query.startAnchor ?? "");
  const end = compactGroundingText(query.endAnchor ?? "");
  const startIndex = candidate.indexOf(start);
  const endIndex = candidate.indexOf(end, Math.max(0, startIndex));
  return startIndex >= 0 && endIndex >= startIndex ? 1 : 0;
}

export function scoreCandidateEvidence(
  evidence: CandidateEvidence,
  weights: TargetEvidenceWeights,
): number {
  let weightedScore = 0;
  let totalWeight = 0;
  for (const key of Object.keys(weights) as Array<keyof CandidateEvidence>) {
    const value = evidence[key];
    if (value === null) continue;
    const weight = weights[key] ?? 0;
    weightedScore += value * weight;
    totalWeight += weight;
  }
  return totalWeight === 0 ? 0 : weightedScore / totalWeight;
}

function normalizedLevenshteinSimilarity(left: string, right: string): number {
  const distance = levenshteinDistance(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]
        + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        (current[rightIndex - 1] ?? 0) + 1,
        substitution,
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index] ?? 0;
    }
  }
  return previous[right.length] ?? 0;
}
