import type { TargetTermCandidate } from "../domain";
import type { AnchorSpanCandidate, SpanPairCandidate } from "./text-span-grounder";
import { normalizeGroundingText } from "./candidate-ranker";

export interface CandidateRecallEvaluationCase {
  expectedSurfaces: readonly string[];
  candidates: readonly TargetTermCandidate[];
  k: number;
}

export interface CandidateRecallEvaluationResult {
  recalled: number;
  expected: number;
  recallAtK: number;
}

export function evaluateCandidateRecallAtK(
  input: CandidateRecallEvaluationCase,
): CandidateRecallEvaluationResult {
  if (!Number.isInteger(input.k) || input.k <= 0) {
    throw new RangeError("k must be a positive integer.");
  }
  const expected = new Set(input.expectedSurfaces.map(normalizeGroundingText));
  const actual = new Set(input.candidates.slice(0, input.k)
    .map((candidate) => candidate.actualTerm.normalized));
  const recalled = [...expected].filter((surface) => actual.has(surface)).length;
  return {
    recalled,
    expected: expected.size,
    recallAtK: expected.size === 0 ? 1 : recalled / expected.size,
  };
}

export interface TextSpanGroundingEvaluationCase {
  expectedStart: { startIndex: number; endIndex: number };
  expectedEnd: { startIndex: number; endIndex: number };
  expectedPair: { startIndex: number; endIndex: number };
  startCandidates: readonly AnchorSpanCandidate[];
  endCandidates: readonly AnchorSpanCandidate[];
  pairCandidates: readonly SpanPairCandidate[];
  selectedPair?: SpanPairCandidate;
  committed: boolean;
  shouldCommit: boolean;
  deterministicallyResolved: boolean;
  recoveryUsed: boolean;
  k: number;
}

export interface TextSpanGroundingEvaluationResult {
  anchorCandidateRecallAtK: number;
  anchorPhraseAccuracy: number;
  anchorBoundaryAccuracy: number;
  spanPairRecallAtK: number;
  spanPairSelectionAccuracy: number;
  finalTargetHitAt1: number;
  deterministicResolutionRate: number;
  llmRecoveryRate: number;
  falseCommitRate: number;
}

export function evaluateTextSpanGroundingStages(
  input: TextSpanGroundingEvaluationCase,
): TextSpanGroundingEvaluationResult {
  if (!Number.isInteger(input.k) || input.k <= 0) {
    throw new RangeError("k must be a positive integer.");
  }
  const startRecalled = input.startCandidates.slice(0, input.k)
    .some((candidate) => sameRange(candidate, input.expectedStart));
  const endRecalled = input.endCandidates.slice(0, input.k)
    .some((candidate) => sameRange(candidate, input.expectedEnd));
  const pairRecalled = input.pairCandidates.slice(0, input.k)
    .some((candidate) => sameRange(candidate.range, input.expectedPair));
  const selected = input.selectedPair;
  const selectionCorrect = selected !== undefined && sameRange(selected.range, input.expectedPair);
  const startBoundaryCorrect = input.startCandidates[0] !== undefined
    && sameRange(input.startCandidates[0], input.expectedStart)
    && input.startCandidates[0].evidence.boundaryPrecision === 1;
  const endBoundaryCorrect = input.endCandidates[0] !== undefined
    && sameRange(input.endCandidates[0], input.expectedEnd)
    && input.endCandidates[0].evidence.boundaryPrecision === 1;
  return {
    anchorCandidateRecallAtK: (Number(startRecalled) + Number(endRecalled)) / 2,
    anchorPhraseAccuracy: (
      Number(input.startCandidates[0] !== undefined
        && sameRange(input.startCandidates[0], input.expectedStart))
      + Number(input.endCandidates[0] !== undefined
        && sameRange(input.endCandidates[0], input.expectedEnd))
    ) / 2,
    anchorBoundaryAccuracy: (Number(startBoundaryCorrect) + Number(endBoundaryCorrect)) / 2,
    spanPairRecallAtK: Number(pairRecalled),
    spanPairSelectionAccuracy: Number(selectionCorrect),
    finalTargetHitAt1: Number(selectionCorrect && input.committed),
    deterministicResolutionRate: Number(input.deterministicallyResolved),
    llmRecoveryRate: Number(input.recoveryUsed),
    falseCommitRate: Number(input.committed && !input.shouldCommit),
  };
}

function sameRange(
  actual: { startIndex: number; endIndex: number },
  expected: { startIndex: number; endIndex: number },
): boolean {
  return actual.startIndex === expected.startIndex && actual.endIndex === expected.endIndex;
}
