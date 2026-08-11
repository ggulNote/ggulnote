export interface SpatialPlacementEvaluationCase {
  readonly expectedCommit: boolean;
  readonly executed: boolean;
  readonly placementValid?: boolean;
  readonly hardOverlap?: boolean;
  readonly relationSatisfied?: boolean;
  readonly preferredSizePreserved?: boolean;
  readonly resolvedDeterministically?: boolean;
  readonly multimodalUsed?: boolean;
  readonly multimodalChoiceCorrect?: boolean;
  readonly latencyMs: number;
  readonly undoIntegrity?: boolean;
}

export interface SpatialPlacementEvaluationMetrics {
  readonly caseCount: number;
  readonly placementValidityRate: number;
  readonly hardOverlapRate: number;
  readonly relationSatisfactionRate: number;
  readonly preferredSizePreservationRate: number;
  readonly deterministicResolutionRate: number;
  readonly multimodalFallbackRate: number;
  readonly multimodalChoiceAccuracy: number;
  readonly falseCommitRate: number;
  readonly noCommitPrecision: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly undoIntegrityRate: number;
}

/** Aggregates fixture results only; it does not log document text or images. */
export function evaluateSpatialPlacementCases(
  cases: readonly SpatialPlacementEvaluationCase[],
): SpatialPlacementEvaluationMetrics {
  const committed = cases.filter((entry) => entry.executed);
  const expectedNoCommit = cases.filter((entry) => !entry.expectedCommit);
  const multimodal = cases.filter((entry) => entry.multimodalUsed === true);
  const withUndo = committed.filter((entry) => entry.undoIntegrity !== undefined);
  const sortedLatency = cases
    .map((entry) => finiteLatency(entry.latencyMs))
    .sort((left, right) => left - right);
  return Object.freeze({
    caseCount: cases.length,
    placementValidityRate: rate(
      committed.filter((entry) => entry.placementValid === true).length,
      committed.length,
    ),
    hardOverlapRate: rate(
      committed.filter((entry) => entry.hardOverlap === true).length,
      committed.length,
    ),
    relationSatisfactionRate: rate(
      committed.filter((entry) => entry.relationSatisfied === true).length,
      committed.length,
    ),
    preferredSizePreservationRate: rate(
      committed.filter((entry) => entry.preferredSizePreserved === true).length,
      committed.length,
    ),
    deterministicResolutionRate: rate(
      cases.filter((entry) => entry.resolvedDeterministically === true).length,
      cases.length,
    ),
    multimodalFallbackRate: rate(multimodal.length, cases.length),
    multimodalChoiceAccuracy: rate(
      multimodal.filter((entry) => entry.multimodalChoiceCorrect === true).length,
      multimodal.length,
    ),
    falseCommitRate: rate(
      expectedNoCommit.filter((entry) => entry.executed).length,
      expectedNoCommit.length,
    ),
    noCommitPrecision: rate(
      expectedNoCommit.filter((entry) => !entry.executed).length,
      cases.filter((entry) => !entry.executed).length,
    ),
    p50LatencyMs: percentile(sortedLatency, 0.5),
    p95LatencyMs: percentile(sortedLatency, 0.95),
    undoIntegrityRate: rate(
      withUndo.filter((entry) => entry.undoIntegrity === true).length,
      withUndo.length,
    ),
  });
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function finiteLatency(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil(sorted.length * quantile) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}
