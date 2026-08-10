import type { SpeechGroundingEvidence, TextSpanTargetQuery } from "../domain";
import {
  materializeCanonicalTextRange,
  type CanonicalTextStream,
  type CanonicalTextToken,
  type TextSpanRangeResolution,
} from "./canonical-text-stream";
import {
  compactGroundingText,
  fuzzyTextSimilarity,
  normalizeGroundingText,
} from "./candidate-ranker";
import {
  phoneticMorphologyCompatibility,
  phoneticSimilarity,
} from "./target-aware-grounding-retrieval";

const ANCHOR_TERM_PATTERN = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;

export const TEXT_SPAN_GROUNDING_POLICY = {
  seedCandidatesPerChunk: 10,
  maxAnchorCandidatesPerSide: 12,
  maxSpanPairCandidates: 12,
  phraseLengthDelta: 1,
  contextTokenRadius: 4,
  previewEdgeTokens: 10,
  minSeedScore: 0.3,
  minChunkMatchScore: 0.3,
  minAnchorCandidateScore: 0.52,
  minResolvedPairScore: 0.96,
  minResolvedPairMargin: 0.03,
  fullSupportBonus: 0.05,
  fullPairSupportBonus: 0.03,
  morphologyConfidence: {
    strong: 0.65,
    medium: 0.5,
  },
  weights: {
    anchorPhraseAlignment: 0.52,
    anchorCoverage: 0.3,
    anchorBoundaryPrecision: 0.18,
    pairAnchor: 0.5,
    pairMorphology: 0.12,
    pairCoverage: 0.1,
    pairBoundary: 0.12,
    pairStructure: 0.08,
    pairDistance: 0.03,
    pairMaterializable: 0.05,
  },
} as const;

export interface AnchorSpanEvidence {
  exact?: number;
  normalized?: number;
  fuzzy?: number;
  phonetic?: number;
  morphology?: number;
  asrAlternative?: number;
  phraseAlignment: number;
  coverage: number;
  queryChunkCount: number;
  matchedChunkCount: number;
  candidateTokenCount: number;
  extraPrefixTokens: number;
  extraSuffixTokens: number;
  boundaryPrecision: number;
}

type AnchorMatchEvidence = Pick<
  AnchorSpanEvidence,
  "exact" | "normalized" | "fuzzy" | "phonetic" | "morphology" | "asrAlternative"
>;

export interface AnchorSpanCandidate {
  text: string;
  startIndex: number;
  endIndex: number;
  startReadingOrder: number;
  endReadingOrder: number;
  alignedStartIndex: number;
  alignedEndIndex: number;
  tokenCount: number;
  context: string;
  evidence: AnchorSpanEvidence;
  score: number;
  paragraphId?: string;
  sentenceId?: string;
  lineIds: readonly string[];
  sourceObjectIds: readonly string[];
}

export interface SpanPairEvidence {
  startAlignment: AnchorSpanEvidence;
  endAlignment: AnchorSpanEvidence;
  startAnchorConfidence: number;
  endAnchorConfidence: number;
  forwardValid: true;
  tokenDistance: number;
  lineDistance: number;
  sameSentence: boolean;
  sameParagraph: boolean;
  focusProximity?: number;
  rangeMaterializable: true;
}

export interface SpanPairCandidate {
  start: AnchorSpanCandidate;
  end: AnchorSpanCandidate;
  evidence: SpanPairEvidence;
  preview: string;
  score: number;
  range: { startIndex: number; endIndex: number };
  materialized: Extract<TextSpanRangeResolution, { status: "RESOLVED" }>;
}

export interface TextSpanGroundingDiagnostics {
  startAnchorChunkCount: number;
  endAnchorChunkCount: number;
  startAnchorCandidateCount: number;
  endAnchorCandidateCount: number;
  multiTokenAnchorUsed: boolean;
  anchorVariantCount: number;
  canonicalAnchorCount: number;
  dominatedAnchorVariantCount: number;
  spanPairCandidateCountBeforePruning: number;
  dominatedPairCount: number;
  spanPairCandidateCountAfterPruning: number;
  spanPairCandidateCount: number;
  topSpanPairScore?: number;
  topSpanPairMargin?: number;
  spanPairResolvedDeterministically: boolean;
}

export type TextSpanGroundingResult =
  | { status: "RESOLVED"; pair: SpanPairCandidate; diagnostics: TextSpanGroundingDiagnostics }
  | { status: "AMBIGUOUS"; pairs: readonly SpanPairCandidate[]; diagnostics: TextSpanGroundingDiagnostics }
  | {
      status: "NOT_FOUND";
      reason: "ANCHOR_NOT_FOUND" | "NO_FORWARD_PAIR";
      diagnostics: TextSpanGroundingDiagnostics;
    };

export interface TextSpanGroundingInput {
  stream: CanonicalTextStream;
  query: TextSpanTargetQuery;
  speechEvidence?: SpeechGroundingEvidence;
  focusObjectId?: string;
}

export function normalizeTextSpanAnchorSlot(
  raw: string,
  role: "quote" | "start" | "end",
): string {
  let value = raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (role === "start") value = value.replace(/(?:에서)?부터\s*$/u, "").trim();
  if (role === "end") value = value.replace(/까지(?:의)?\s*$/u, "").trim();
  return value;
}

export function countTextSpanAnchorChunks(value: string): number {
  return normalizeTextSpanAnchorSlot(value, "quote").match(ANCHOR_TERM_PATTERN)?.length ?? 0;
}

export function retrieveAnchorSpanCandidates(
  stream: CanonicalTextStream,
  rawAnchor: string,
  options: {
    role: "quote" | "start" | "end";
    speechEvidence?: SpeechGroundingEvidence;
  },
): readonly AnchorSpanCandidate[] {
  return retrieveAnchorSpanCandidatesDetailed(stream, rawAnchor, options).candidates;
}

interface AnchorRetrievalResult {
  variants: readonly AnchorSpanCandidate[];
  candidates: readonly AnchorSpanCandidate[];
  canonicalCount: number;
  dominatedVariantCount: number;
}

function retrieveAnchorSpanCandidatesDetailed(
  stream: CanonicalTextStream,
  rawAnchor: string,
  options: {
    role: "quote" | "start" | "end";
    speechEvidence?: SpeechGroundingEvidence;
  },
): AnchorRetrievalResult {
  const anchor = normalizeTextSpanAnchorSlot(rawAnchor, options.role);
  const chunks = anchor.match(ANCHOR_TERM_PATTERN) ?? [];
  if (chunks.length === 0 || stream.tokens.length === 0) {
    return { variants: [], candidates: [], canonicalCount: 0, dominatedVariantCount: 0 };
  }

  const seeds = findSeeds(stream.tokens, chunks, options.speechEvidence);
  const ranges = expandSeedWindows(stream.tokens, seeds, chunks.length);
  const candidates = ranges.flatMap(({ startIndex, endIndex }): AnchorSpanCandidate[] => {
    const tokens = stream.tokens.slice(startIndex, endIndex + 1);
    if (!isNaturalPhraseWindow(tokens)) return [];
    const alignment = alignPhrase(chunks, tokens, options.speechEvidence);
    const score = clamp(
      alignment.phraseAlignment * TEXT_SPAN_GROUNDING_POLICY.weights.anchorPhraseAlignment
      + alignment.coverage * TEXT_SPAN_GROUNDING_POLICY.weights.anchorCoverage
      + alignment.boundaryPrecision
        * TEXT_SPAN_GROUNDING_POLICY.weights.anchorBoundaryPrecision
      + (alignment.coverage === 1 && alignment.boundaryPrecision === 1
        ? TEXT_SPAN_GROUNDING_POLICY.fullSupportBonus
        : 0),
    );
    if (score < TEXT_SPAN_GROUNDING_POLICY.minAnchorCandidateScore) return [];
    const first = tokens[0];
    const last = tokens.at(-1);
    if (first === undefined || last === undefined) return [];
    const paragraphIds = uniqueDefined(tokens.map((token) => token.paragraphId));
    const sentenceIds = uniqueDefined(tokens.map((token) => token.sentenceId));
    const paragraphId = paragraphIds[0];
    const sentenceId = sentenceIds[0];
    return [{
      text: tokens.map((token) => token.text).join(" "),
      startIndex,
      endIndex,
      startReadingOrder: first.readingOrder,
      endReadingOrder: last.readingOrder,
      alignedStartIndex: startIndex + alignment.alignedStartOffset,
      alignedEndIndex: startIndex + alignment.alignedEndOffset,
      tokenCount: tokens.length,
      context: contextAround(stream.tokens, startIndex, endIndex),
      evidence: {
        ...alignment.evidence,
        phraseAlignment: alignment.phraseAlignment,
        coverage: alignment.coverage,
        queryChunkCount: chunks.length,
        matchedChunkCount: alignment.matchedChunkCount,
        candidateTokenCount: tokens.length,
        extraPrefixTokens: alignment.extraPrefixTokens,
        extraSuffixTokens: alignment.extraSuffixTokens,
        boundaryPrecision: alignment.boundaryPrecision,
      },
      score,
      ...(paragraphIds.length === 1 && paragraphId !== undefined ? { paragraphId } : {}),
      ...(sentenceIds.length === 1 && sentenceId !== undefined ? { sentenceId } : {}),
      lineIds: uniqueDefined(tokens.map((token) => token.lineId)),
      sourceObjectIds: uniqueDefined(tokens.map((token) => token.sourceObjectId)),
    }];
  });

  const variants = dedupeAnchorCandidates(candidates);
  const canonical = canonicalizeAnchorCandidates(variants);
  return {
    variants,
    candidates: canonical.slice(0, TEXT_SPAN_GROUNDING_POLICY.maxAnchorCandidatesPerSide),
    canonicalCount: canonical.length,
    dominatedVariantCount: variants.length - canonical.length,
  };
}

export function canonicalizeAnchorCandidates(
  candidates: readonly AnchorSpanCandidate[],
): readonly AnchorSpanCandidate[] {
  const byOccurrence = new Map<string, AnchorSpanCandidate>();
  for (const candidate of dedupeAnchorCandidates(candidates)) {
    const key = anchorOccurrenceKey(candidate);
    const existing = byOccurrence.get(key);
    if (existing === undefined || compareAnchorCandidates(candidate, existing) < 0) {
      byOccurrence.set(key, candidate);
    }
  }
  return [...byOccurrence.values()].sort(compareAnchorCandidates);
}

export function buildSpanPairCandidates(
  stream: CanonicalTextStream,
  startCandidates: readonly AnchorSpanCandidate[],
  endCandidates: readonly AnchorSpanCandidate[],
  focusObjectId?: string,
): readonly SpanPairCandidate[] {
  return buildSpanPairCandidatesDetailed(
    stream,
    canonicalizeAnchorCandidates(startCandidates),
    canonicalizeAnchorCandidates(endCandidates),
    focusObjectId,
  ).candidates;
}

interface SpanPairBuildResult {
  candidates: readonly SpanPairCandidate[];
  candidateCountBeforePruning: number;
  dominatedPairCount: number;
  candidateCountAfterPruning: number;
}

function buildSpanPairCandidatesDetailed(
  stream: CanonicalTextStream,
  startCandidates: readonly AnchorSpanCandidate[],
  endCandidates: readonly AnchorSpanCandidate[],
  focusObjectId?: string,
): SpanPairBuildResult {
  const pairs: SpanPairCandidate[] = [];
  for (const start of startCandidates) {
    for (const end of endCandidates) {
      if (start.startIndex > end.startIndex || start.endIndex > end.endIndex) continue;
      const range = { startIndex: start.startIndex, endIndex: end.endIndex };
      const materialized = materializeCanonicalTextRange(stream, range);
      if (materialized.status !== "RESOLVED" || !hasValidGeometry(materialized.bounds)) continue;
      const tokenDistance = end.endIndex - start.startIndex + 1;
      const lineDistance = uniqueDefined(materialized.selectedTokens.map((token) => token.lineId)).length;
      const sameSentence = start.sentenceId !== undefined && start.sentenceId === end.sentenceId;
      const sameParagraph = start.paragraphId !== undefined && start.paragraphId === end.paragraphId;
      const focusProximity = focusObjectId === undefined
        ? undefined
        : start.sourceObjectIds.includes(focusObjectId) || end.sourceObjectIds.includes(focusObjectId)
          ? 1
          : 0;
      const anchorScore = (start.score + end.score) / 2;
      const boundaryScore = (
        start.evidence.boundaryPrecision + end.evidence.boundaryPrecision
      ) / 2;
      const coverageScore = (start.evidence.coverage + end.evidence.coverage) / 2;
      const morphologyScore = (
        morphologyConfidence(start.evidence.morphology)
        + morphologyConfidence(end.evidence.morphology)
      ) / 2;
      const fullPairSupport = start.evidence.coverage === 1
        && end.evidence.coverage === 1
        && start.evidence.boundaryPrecision === 1
        && end.evidence.boundaryPrecision === 1;
      const structureScore = sameSentence ? 1 : sameParagraph ? 0.72 : 0.28;
      const distanceScore = 1 / (1 + Math.max(0, tokenDistance - start.tokenCount - end.tokenCount) / 40);
      const score = clamp(
        anchorScore * TEXT_SPAN_GROUNDING_POLICY.weights.pairAnchor
        + morphologyScore * TEXT_SPAN_GROUNDING_POLICY.weights.pairMorphology
        + coverageScore * TEXT_SPAN_GROUNDING_POLICY.weights.pairCoverage
        + boundaryScore * TEXT_SPAN_GROUNDING_POLICY.weights.pairBoundary
        + structureScore * TEXT_SPAN_GROUNDING_POLICY.weights.pairStructure
        + distanceScore * TEXT_SPAN_GROUNDING_POLICY.weights.pairDistance
        + TEXT_SPAN_GROUNDING_POLICY.weights.pairMaterializable
        + (fullPairSupport ? TEXT_SPAN_GROUNDING_POLICY.fullPairSupportBonus : 0)
        + (focusProximity ?? 0) * 0.03,
      );
      pairs.push({
        start,
        end,
        evidence: {
          startAlignment: { ...start.evidence },
          endAlignment: { ...end.evidence },
          startAnchorConfidence: start.score,
          endAnchorConfidence: end.score,
          forwardValid: true,
          tokenDistance,
          lineDistance,
          sameSentence,
          sameParagraph,
          ...(focusProximity === undefined ? {} : { focusProximity }),
          rangeMaterializable: true,
        },
        preview: buildRangePreview(materialized.selectedTokens),
        score,
        range,
        materialized,
      });
    }
  }
  const deduped = dedupePairCandidates(pairs);
  const pruned = pruneDominatedSpanPairs(deduped);
  const ranked = pruned
    .sort((left, right) => right.score - left.score
      || left.evidence.tokenDistance - right.evidence.tokenDistance
      || left.range.startIndex - right.range.startIndex
      || left.range.endIndex - right.range.endIndex);
  return {
    candidates: ranked.slice(0, TEXT_SPAN_GROUNDING_POLICY.maxSpanPairCandidates),
    candidateCountBeforePruning: pairs.length,
    dominatedPairCount: pairs.length - pruned.length,
    candidateCountAfterPruning: pruned.length,
  };
}

export function pruneDominatedSpanPairs(
  candidates: readonly SpanPairCandidate[],
): SpanPairCandidate[] {
  return candidates.filter((candidate, index) => !candidates.some(
    (other, otherIndex) => otherIndex !== index && spanPairDominates(other, candidate),
  ));
}

export function groundTextSpan(input: TextSpanGroundingInput): TextSpanGroundingResult {
  const isQuote = input.query.quote !== undefined;
  const startText = input.query.quote ?? input.query.startAnchor;
  const endText = input.query.quote ?? input.query.endAnchor;
  const startChunkCount = startText === undefined ? 0 : countTextSpanAnchorChunks(startText);
  const endChunkCount = endText === undefined ? 0 : countTextSpanAnchorChunks(endText);
  const startRetrieval = startText === undefined
    ? { variants: [], candidates: [], canonicalCount: 0, dominatedVariantCount: 0 }
    : retrieveAnchorSpanCandidatesDetailed(input.stream, startText, {
      role: isQuote ? "quote" : "start",
      ...(input.speechEvidence === undefined ? {} : { speechEvidence: input.speechEvidence }),
    });
  const endRetrieval = isQuote
    ? startRetrieval
    : endText === undefined
      ? { variants: [], candidates: [], canonicalCount: 0, dominatedVariantCount: 0 }
      : retrieveAnchorSpanCandidatesDetailed(input.stream, endText, {
        role: "end",
        ...(input.speechEvidence === undefined ? {} : { speechEvidence: input.speechEvidence }),
      });
  const startCandidates = startRetrieval.candidates;
  const endCandidates = endRetrieval.candidates;
  const pairBuild = buildSpanPairCandidatesDetailed(
    input.stream,
    startCandidates,
    endCandidates,
    input.focusObjectId,
  );
  const pairs = isQuote
    ? pairBuild.candidates.filter((pair) => pair.start.startIndex === pair.end.startIndex
        && pair.start.endIndex === pair.end.endIndex)
    : pairBuild.candidates;
  const top = pairs[0];
  const second = pairs[1];
  const margin = top === undefined ? undefined : top.score - (second?.score ?? 0);
  const deterministic = top !== undefined
    && top.score >= TEXT_SPAN_GROUNDING_POLICY.minResolvedPairScore
    && margin !== undefined
    && margin >= TEXT_SPAN_GROUNDING_POLICY.minResolvedPairMargin;
  const diagnostics: TextSpanGroundingDiagnostics = {
    startAnchorChunkCount: startChunkCount,
    endAnchorChunkCount: endChunkCount,
    startAnchorCandidateCount: startCandidates.length,
    endAnchorCandidateCount: endCandidates.length,
    multiTokenAnchorUsed: (startChunkCount > 1 && startCandidates.some((candidate) => candidate.tokenCount > 1))
      || (endChunkCount > 1 && endCandidates.some((candidate) => candidate.tokenCount > 1)),
    anchorVariantCount: startRetrieval.variants.length
      + (isQuote ? 0 : endRetrieval.variants.length),
    canonicalAnchorCount: startRetrieval.canonicalCount
      + (isQuote ? 0 : endRetrieval.canonicalCount),
    dominatedAnchorVariantCount: startRetrieval.dominatedVariantCount
      + (isQuote ? 0 : endRetrieval.dominatedVariantCount),
    spanPairCandidateCountBeforePruning: pairBuild.candidateCountBeforePruning,
    dominatedPairCount: pairBuild.dominatedPairCount,
    spanPairCandidateCountAfterPruning: pairBuild.candidateCountAfterPruning,
    spanPairCandidateCount: pairs.length,
    ...(top === undefined ? {} : { topSpanPairScore: top.score }),
    ...(margin === undefined ? {} : { topSpanPairMargin: margin }),
    spanPairResolvedDeterministically: deterministic,
  };
  if (startCandidates.length === 0 || endCandidates.length === 0) {
    return { status: "NOT_FOUND", reason: "ANCHOR_NOT_FOUND", diagnostics };
  }
  if (top === undefined) return { status: "NOT_FOUND", reason: "NO_FORWARD_PAIR", diagnostics };
  if (deterministic) return { status: "RESOLVED", pair: top, diagnostics };
  return { status: "AMBIGUOUS", pairs, diagnostics };
}

function findSeeds(
  tokens: readonly CanonicalTextToken[],
  chunks: readonly string[],
  evidence: SpeechGroundingEvidence | undefined,
): readonly number[] {
  const seeds = new Set<number>();
  for (const chunk of chunks) {
    tokens.map((token, index) => ({ index, score: scoreChunk(chunk, token.text, evidence).score }))
      .filter((entry) => entry.score >= TEXT_SPAN_GROUNDING_POLICY.minSeedScore)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, TEXT_SPAN_GROUNDING_POLICY.seedCandidatesPerChunk)
      .forEach((entry) => seeds.add(entry.index));
  }
  return [...seeds].sort((left, right) => left - right);
}

function expandSeedWindows(
  tokens: readonly CanonicalTextToken[],
  seeds: readonly number[],
  expectedLength: number,
): readonly { startIndex: number; endIndex: number }[] {
  const ranges = new Map<string, { startIndex: number; endIndex: number }>();
  const minLength = Math.max(1, expectedLength - TEXT_SPAN_GROUNDING_POLICY.phraseLengthDelta);
  const maxLength = Math.min(tokens.length, expectedLength + TEXT_SPAN_GROUNDING_POLICY.phraseLengthDelta);
  for (const seed of seeds) {
    for (let length = minLength; length <= maxLength; length += 1) {
      const minStart = Math.max(0, seed - length + 1);
      const maxStart = Math.min(seed, tokens.length - length);
      for (let startIndex = minStart; startIndex <= maxStart; startIndex += 1) {
        const endIndex = startIndex + length - 1;
        ranges.set(`${startIndex}:${endIndex}`, { startIndex, endIndex });
      }
    }
  }
  return [...ranges.values()];
}

function isNaturalPhraseWindow(tokens: readonly CanonicalTextToken[]): boolean {
  if (tokens.length === 0) return false;
  return uniqueDefined(tokens.map((token) => token.paragraphId)).length <= 1;
}

function alignPhrase(
  chunks: readonly string[],
  tokens: readonly CanonicalTextToken[],
  speechEvidence: SpeechGroundingEvidence | undefined,
): {
  phraseAlignment: number;
  coverage: number;
  matchedChunkCount: number;
  alignedStartOffset: number;
  alignedEndOffset: number;
  extraPrefixTokens: number;
  extraSuffixTokens: number;
  boundaryPrecision: number;
  evidence: AnchorMatchEvidence;
} {
  const matrix = chunks.map((chunk) => tokens.map((token) => scoreChunk(chunk, token.text, speechEvidence)));
  const memo = new Map<string, Alignment>();
  const visit = (chunkIndex: number, tokenIndex: number): Alignment => {
    if (chunkIndex >= chunks.length || tokenIndex >= tokens.length) return { objective: 0, matches: [] };
    const key = `${chunkIndex}:${tokenIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const alternatives: Alignment[] = [visit(chunkIndex + 1, tokenIndex), visit(chunkIndex, tokenIndex + 1)];
    const current = matrix[chunkIndex]?.[tokenIndex];
    if (current !== undefined && current.score >= TEXT_SPAN_GROUNDING_POLICY.minChunkMatchScore) {
      const next = visit(chunkIndex + 1, tokenIndex + 1);
      alternatives.push({
        objective: current.score + 0.18 + next.objective,
        matches: [{
          chunkIndex,
          tokenIndex,
          score: current.score,
          evidence: current.evidence,
        }, ...next.matches],
      });
    }
    const best = alternatives.sort((left, right) => right.objective - left.objective
      || right.matches.length - left.matches.length)[0] ?? { objective: 0, matches: [] };
    memo.set(key, best);
    return best;
  };
  const aligned = visit(0, 0);
  const coverage = chunks.length === 0 ? 0 : aligned.matches.length / chunks.length;
  const average = aligned.matches.length === 0
    ? 0
    : aligned.matches.reduce((sum, match) => sum + match.score, 0) / aligned.matches.length;
  const evidence = aligned.matches.reduce<AnchorMatchEvidence>(
    (result, match) => mergeAnchorEvidence(result, match.evidence),
    {},
  );
  const firstMatch = aligned.matches[0];
  const lastMatch = aligned.matches.at(-1);
  const alignedStartOffset = firstMatch?.tokenIndex ?? 0;
  const alignedEndOffset = lastMatch?.tokenIndex ?? Math.max(0, tokens.length - 1);
  const extraPrefixTokens = alignedStartOffset;
  const extraSuffixTokens = Math.max(0, tokens.length - alignedEndOffset - 1);
  const boundaryPrecision = tokens.length === 0 ? 0 : aligned.matches.length / tokens.length;
  return {
    phraseAlignment: average,
    coverage,
    matchedChunkCount: aligned.matches.length,
    alignedStartOffset,
    alignedEndOffset,
    extraPrefixTokens,
    extraSuffixTokens,
    boundaryPrecision,
    evidence,
  };
}

function scoreChunk(
  spoken: string,
  actual: string,
  speechEvidence: SpeechGroundingEvidence | undefined,
): { score: number; evidence: AnchorMatchEvidence } {
  const spokenCompact = compactGroundingText(normalizeGroundingText(spoken));
  const actualCompact = compactGroundingText(normalizeGroundingText(actual));
  const evidence: AnchorMatchEvidence = {};
  if (spoken === actual) evidence.exact = 1;
  if (spokenCompact.length > 0 && spokenCompact === actualCompact) evidence.normalized = 1;
  const fuzzy = fuzzyTextSimilarity(spoken, actual);
  if (fuzzy >= 0.25) evidence.fuzzy = fuzzy;
  const phonetic = phoneticSimilarity(spoken, actual);
  if (phonetic >= 0.25) evidence.phonetic = phonetic;
  const morphology = phoneticMorphologyCompatibility(spoken, actual);
  if (morphology !== undefined) evidence.morphology = morphology === 1 ? phonetic : 0;
  const hypothesis = directHypothesisScore(spoken, actualCompact, speechEvidence);
  if (hypothesis > 0) evidence.phonetic = Math.max(evidence.phonetic ?? 0, hypothesis);
  const asrAlternative = bestAsrAlternative(actual, speechEvidence);
  if (asrAlternative >= 0.7) evidence.asrAlternative = asrAlternative;
  return {
    score: Math.max(
      evidence.exact ?? 0,
      (evidence.normalized ?? 0) * 0.98,
      (evidence.fuzzy ?? 0) * 0.55,
      (evidence.phonetic ?? 0) * 0.94,
      (evidence.asrAlternative ?? 0) * 0.85,
    ),
    evidence,
  };
}

function directHypothesisScore(
  spoken: string,
  actualCompact: string,
  evidence: SpeechGroundingEvidence | undefined,
): number {
  const spokenCompact = compactGroundingText(normalizeGroundingText(spoken));
  let best = 0;
  for (const hypothesis of evidence?.termHypotheses ?? []) {
    if (compactGroundingText(normalizeGroundingText(hypothesis.rawSpan)) !== spokenCompact) continue;
    for (const candidate of hypothesis.candidates) {
      if (compactGroundingText(normalizeGroundingText(candidate.value)) === actualCompact) {
        best = Math.max(best, candidate.confidence ?? 0.75);
      }
    }
  }
  return best;
}

function bestAsrAlternative(actual: string, evidence: SpeechGroundingEvidence | undefined): number {
  let best = 0;
  for (const alternative of evidence?.asrAlternatives ?? []) {
    for (const term of alternative.text.match(ANCHOR_TERM_PATTERN) ?? []) {
      best = Math.max(best, fuzzyTextSimilarity(term, actual));
    }
  }
  return best;
}

function mergeAnchorEvidence(
  left: AnchorMatchEvidence,
  right: AnchorMatchEvidence,
): AnchorMatchEvidence {
  const result = { ...left };
  for (const key of [
    "exact",
    "normalized",
    "fuzzy",
    "phonetic",
    "morphology",
    "asrAlternative",
  ] as const) {
    const value = right[key];
    if (value !== undefined) result[key] = Math.max(result[key] ?? 0, value);
  }
  return result;
}

function dedupeAnchorCandidates(candidates: readonly AnchorSpanCandidate[]): AnchorSpanCandidate[] {
  const result = new Map<string, AnchorSpanCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.startIndex}:${candidate.endIndex}`;
    const existing = result.get(key);
    if (existing === undefined || candidate.score > existing.score) result.set(key, candidate);
  }
  return [...result.values()];
}

function anchorOccurrenceKey(candidate: AnchorSpanCandidate): string {
  return `${candidate.alignedStartIndex}:${candidate.alignedEndIndex}`;
}

function compareAnchorCandidates(
  left: AnchorSpanCandidate,
  right: AnchorSpanCandidate,
): number {
  return right.score - left.score
    || right.evidence.coverage - left.evidence.coverage
    || right.evidence.boundaryPrecision - left.evidence.boundaryPrecision
    || right.evidence.phraseAlignment - left.evidence.phraseAlignment
    || (left.evidence.extraPrefixTokens + left.evidence.extraSuffixTokens)
      - (right.evidence.extraPrefixTokens + right.evidence.extraSuffixTokens)
    || left.startReadingOrder - right.startReadingOrder
    || left.endReadingOrder - right.endReadingOrder;
}

function dedupePairCandidates(candidates: readonly SpanPairCandidate[]): SpanPairCandidate[] {
  const result = new Map<string, SpanPairCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.range.startIndex}:${candidate.range.endIndex}`;
    const existing = result.get(key);
    if (existing === undefined || candidate.score > existing.score) result.set(key, candidate);
  }
  return [...result.values()];
}

function spanPairDominates(
  left: SpanPairCandidate,
  right: SpanPairCandidate,
): boolean {
  if (
    anchorOccurrenceKey(left.start) !== anchorOccurrenceKey(right.start)
    || anchorOccurrenceKey(left.end) !== anchorOccurrenceKey(right.end)
  ) return false;
  const leftEvidence = pairDominanceVector(left);
  const rightEvidence = pairDominanceVector(right);
  const epsilon = 1e-9;
  return leftEvidence.every((value, index) => value + epsilon >= (rightEvidence[index] ?? 0))
    && leftEvidence.some((value, index) => value > (rightEvidence[index] ?? 0) + epsilon);
}

function pairDominanceVector(pair: SpanPairCandidate): readonly number[] {
  return [
    pair.start.evidence.coverage,
    pair.start.evidence.phraseAlignment,
    pair.start.evidence.boundaryPrecision,
    pair.end.evidence.coverage,
    pair.end.evidence.phraseAlignment,
    pair.end.evidence.boundaryPrecision,
    Number(pair.evidence.sameSentence),
    Number(pair.evidence.sameParagraph),
    1 / Math.max(1, pair.evidence.tokenDistance),
    Number(pair.evidence.rangeMaterializable),
  ];
}

function morphologyConfidence(value: number | undefined): number {
  if (value === undefined) return 0.5;
  if (value >= TEXT_SPAN_GROUNDING_POLICY.morphologyConfidence.strong) return 1;
  if (value >= TEXT_SPAN_GROUNDING_POLICY.morphologyConfidence.medium) return 0.5;
  return 0;
}

function contextAround(tokens: readonly CanonicalTextToken[], start: number, end: number): string {
  return tokens.slice(
    Math.max(0, start - TEXT_SPAN_GROUNDING_POLICY.contextTokenRadius),
    Math.min(tokens.length, end + TEXT_SPAN_GROUNDING_POLICY.contextTokenRadius + 1),
  ).map((token) => token.text).join(" ");
}

function buildRangePreview(tokens: readonly CanonicalTextToken[]): string {
  const edge = TEXT_SPAN_GROUNDING_POLICY.previewEdgeTokens;
  if (tokens.length <= edge * 2) return tokens.map((token) => token.text).join(" ");
  return [
    ...tokens.slice(0, edge).map((token) => token.text),
    "[omitted]",
    ...tokens.slice(-edge).map((token) => token.text),
  ].join(" ");
}

function hasValidGeometry(bounds: readonly { x: number; y: number; width: number; height: number }[]): boolean {
  return bounds.length > 0 && bounds.every((rect) =>
    Number.isFinite(rect.x) && Number.isFinite(rect.y)
    && Number.isFinite(rect.width) && Number.isFinite(rect.height)
    && rect.width >= 0 && rect.height >= 0);
}

function uniqueDefined(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

interface Alignment {
  objective: number;
  matches: readonly {
    chunkIndex: number;
    tokenIndex: number;
    score: number;
    evidence: AnchorMatchEvidence;
  }[];
}
