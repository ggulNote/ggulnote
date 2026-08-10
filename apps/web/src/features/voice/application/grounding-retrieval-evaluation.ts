import type { TargetTermCandidate } from "../domain";
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
