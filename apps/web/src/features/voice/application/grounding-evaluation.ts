export type GroundingEvaluationCategory =
  | "exact_relative"
  | "exact_text_span"
  | "semantic_sentence"
  | "semantic_paragraph"
  | "phonetic_semantic"
  | "phonetic_text_span"
  | "duplicate_anchor"
  | "no_target"
  | "ambiguous_target"
  | "canvas_text"
  | "numeric_evidence"
  | "math_evidence";

export interface GroundingEvaluationCase {
  category: GroundingEvaluationCategory;
  expectedIntent?: string;
  actualIntent?: string;
  expectedTargetId?: string;
  actualTargetId?: string;
  expectedStartTokenId?: string;
  actualStartTokenId?: string;
  expectedEndTokenId?: string;
  actualEndTokenId?: string;
  expectedRangeTokenIds?: readonly string[];
  actualRangeTokenIds?: readonly string[];
  shouldCommit: boolean;
  committed: boolean;
  recoveryAttempted: boolean;
  recoverySelected: boolean;
  recoveryNoneExpected?: boolean;
  undoRestored?: boolean;
  embeddingCacheHit?: boolean;
  latencyMs?: number;
}

export interface GroundingEvaluationMetrics {
  intentAccuracy: number | null;
  targetHitAt1: number | null;
  anchorStartAccuracy: number | null;
  anchorEndAccuracy: number | null;
  rangeCorrectness: number | null;
  recoverySuccessRate: number | null;
  recoveryNonePrecision: number | null;
  falseCommitRate: number;
  embeddingCacheHitRate: number | null;
  recoveryRate: number;
  undoIntegrity: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
}

export function evaluateGroundingCases(
  cases: readonly GroundingEvaluationCase[],
): GroundingEvaluationMetrics {
  const rate = (values: readonly boolean[]): number | null =>
    values.length === 0 ? null : values.filter(Boolean).length / values.length;
  const expectedIntent = cases.filter((item) => item.expectedIntent !== undefined);
  const expectedTarget = cases.filter((item) => item.expectedTargetId !== undefined);
  const expectedStart = cases.filter((item) => item.expectedStartTokenId !== undefined);
  const expectedEnd = cases.filter((item) => item.expectedEndTokenId !== undefined);
  const expectedRange = cases.filter((item) => item.expectedRangeTokenIds !== undefined);
  const recoveryAttempts = cases.filter((item) => item.recoveryAttempted);
  const expectedNone = cases.filter((item) => item.recoveryNoneExpected === true);
  const unsafeCases = cases.filter((item) => !item.shouldCommit);
  const cacheCases = cases.filter((item) => item.embeddingCacheHit !== undefined);
  const undoCases = cases.filter((item) => item.shouldCommit && item.undoRestored !== undefined);
  const latencies = cases
    .map((item) => item.latencyMs)
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
    .sort((left, right) => left - right);

  return {
    intentAccuracy: rate(expectedIntent.map((item) => item.actualIntent === item.expectedIntent)),
    targetHitAt1: rate(expectedTarget.map((item) => item.actualTargetId === item.expectedTargetId)),
    anchorStartAccuracy: rate(expectedStart.map((item) => item.actualStartTokenId === item.expectedStartTokenId)),
    anchorEndAccuracy: rate(expectedEnd.map((item) => item.actualEndTokenId === item.expectedEndTokenId)),
    rangeCorrectness: rate(expectedRange.map((item) =>
      equalOrdered(item.actualRangeTokenIds, item.expectedRangeTokenIds))),
    recoverySuccessRate: rate(recoveryAttempts.map((item) => item.recoverySelected)),
    recoveryNonePrecision: rate(expectedNone.map((item) => !item.recoverySelected && !item.committed)),
    falseCommitRate: unsafeCases.length === 0
      ? 0
      : unsafeCases.filter((item) => item.committed).length / unsafeCases.length,
    embeddingCacheHitRate: rate(cacheCases.map((item) => item.embeddingCacheHit === true)),
    recoveryRate: cases.length === 0
      ? 0
      : recoveryAttempts.length / cases.length,
    undoIntegrity: rate(undoCases.map((item) => item.undoRestored === true)),
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
  };
}

function equalOrdered(
  actual: readonly string[] | undefined,
  expected: readonly string[] | undefined,
): boolean {
  return actual !== undefined
    && expected !== undefined
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function percentile(values: readonly number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const index = Math.ceil(percentileValue * values.length) - 1;
  return values[Math.max(0, index)] ?? null;
}
