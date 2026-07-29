import type { Result } from "../domain/calibration-types";
import { makeError, makeResult } from "../domain/calibration-types";
import type { PursuitLagConfig } from "../config/pursuit-calibration-config";
import type { PursuitRawSample, PursuitTrajectoryRole } from "../domain/pursuit-types";
import type { PursuitTargetHistory, PursuitTargetHistoryLookupResult } from "./pursuit-target-history";

export type PursuitLagSource = "estimated" | "fixed" | "fallback";

export type PursuitLagEstimate = Readonly<{
  readonly lagMs: number;
  readonly correlationX: number;
  readonly correlationY: number;
  readonly combinedScore: number;
  readonly pairedSampleCount: number;
  readonly source: PursuitLagSource;
}>;

export type PursuitLagEstimationError =
  | "invalid-input"
  | "invalid-lag-range"
  | "insufficient-paired-samples"
  | "estimation-failed";

export type PursuitLagEstimateResult = Result<PursuitLagEstimate, PursuitLagEstimationError>;

export type AlignedPair = Readonly<{
  readonly rawX: number;
  readonly rawY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly timestampMs: number;
}>;

export type AlignmentInput = Readonly<{
  readonly rawSamples: readonly PursuitRawSample[];
  readonly targetHistory: PursuitTargetHistory;
  readonly lagConfig: PursuitLagConfig;
}>;

export function getLagCandidates(config: PursuitLagConfig): readonly number[] {
  if (!isFiniteLagConfig(config)) {
    return [];
  }

  const candidates: number[] = [];
  for (let lag = config.minimumLagMs; lag <= config.maximumLagMs; lag += config.searchStepMs) {
    candidates.push(lag);
  }

  return candidates;
}

export function calculatePearsonCorrelation(valuesX: readonly number[], valuesY: readonly number[]): number {
  if (valuesX.length !== valuesY.length || valuesX.length < 2) {
    return 0;
  }

  const n = valuesX.length;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;

  for (let index = 0; index < n; index += 1) {
    const x = valuesX[index];
    const y = valuesY[index];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
      return 0;
    }

    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumYY += y * y;
    sumXY += x * y;
  }

  const denominatorX = n * sumXX - sumX * sumX;
  const denominatorY = n * sumYY - sumY * sumY;
  if (!Number.isFinite(denominatorX) || !Number.isFinite(denominatorY) || denominatorX <= 0 || denominatorY <= 0) {
    return 0;
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(denominatorX * denominatorY);
  if (!Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }

  const correlation = numerator / denominator;
  return clamp(correlation, -1, 1);
}

export function calculateCombinedCorrelationScore(correlationX: number, correlationY: number): number {
  if (!Number.isFinite(correlationX) || !Number.isFinite(correlationY)) {
    return 0;
  }

  const a = Math.abs(correlationX);
  const b = Math.abs(correlationY);
  return Math.sqrt(a * b);
}

/**
 * A positive lag aligns raw gaze captured at t with target history at t - lagMs.
 * History misses are omitted rather than extrapolated across time or segment bounds.
 */
export function alignRawAndTargetWithLag(
  rawSamples: readonly PursuitRawSample[],
  lookup: (role: PursuitTrajectoryRole, segmentId: string, timestampMs: number) => PursuitTargetHistoryLookupResult,
  lagMs: number,
): readonly AlignedPair[] {
  if (!Number.isFinite(lagMs)) {
    return [];
  }

  const pairs: AlignedPair[] = [];
  for (const sample of rawSamples) {
    if (!Number.isFinite(sample.timestampMs) || !Number.isFinite(sample.rawVector.x) || !Number.isFinite(sample.rawVector.y)) {
      continue;
    }

    const targetResult = lookup(sample.role, sample.segmentId, sample.timestampMs - lagMs);
    if (!targetResult.ok) {
      continue;
    }

    const target = targetResult.sample;
    if (!Number.isFinite(target.targetCenter.x) || !Number.isFinite(target.targetCenter.y)) {
      continue;
    }

    pairs.push({
      rawX: sample.rawVector.x,
      rawY: sample.rawVector.y,
      targetX: target.targetCenter.x,
      targetY: target.targetCenter.y,
      timestampMs: sample.timestampMs,
    });
  }

  return pairs;
}

export function evaluateLag(
  rawSamples: readonly PursuitRawSample[],
  targetHistory: PursuitTargetHistory,
  lagMs: number,
): PursuitLagEstimate {
  const pairs = alignRawAndTargetWithLag(rawSamples, targetHistory.getTargetCenterAtTimestamp.bind(targetHistory), lagMs);
  const rawX: number[] = [];
  const rawY: number[] = [];
  const targetX: number[] = [];
  const targetY: number[] = [];

  for (const pair of pairs) {
    rawX.push(pair.rawX);
    rawY.push(pair.rawY);
    targetX.push(pair.targetX);
    targetY.push(pair.targetY);
  }

  const correlationX = calculatePearsonCorrelation(rawX, targetX);
  const correlationY = calculatePearsonCorrelation(rawY, targetY);
  const combinedScore = calculateCombinedCorrelationScore(correlationX, correlationY);

  return {
    lagMs,
    correlationX,
    correlationY,
    combinedScore,
    pairedSampleCount: pairs.length,
    source: "estimated",
  };
}

export function estimatePursuitLag(input: AlignmentInput): PursuitLagEstimateResult {
  if (!isFiniteLagConfig(input.lagConfig)) {
    return makeError("invalid-lag-range", "Invalid lag config range or search step.");
  }

  if (input.rawSamples.length < 2) {
    return makeError("invalid-input", "At least two raw samples are required.");
  }

  const fixedResult = evaluateLag(input.rawSamples, input.targetHistory, input.lagConfig.fixedLagMs);
  if (input.lagConfig.mode === "fixed") {
    return fixedResult.pairedSampleCount < 2
      ? makeError("insufficient-paired-samples", "Not enough paired samples for fixed lag alignment.")
      : makeResult({
          lagMs: fixedResult.lagMs,
          correlationX: fixedResult.correlationX,
          correlationY: fixedResult.correlationY,
          combinedScore: fixedResult.combinedScore,
          pairedSampleCount: fixedResult.pairedSampleCount,
          source: "fixed",
        });
  }

  const candidates = getLagCandidates(input.lagConfig);
  if (candidates.length === 0) {
    return makeError("invalid-lag-range", "Lag candidate list is empty.");
  }

  let best: PursuitLagEstimate | null = null;
  for (const lagMs of candidates) {
    const estimate = evaluateLag(input.rawSamples, input.targetHistory, lagMs);
    if (estimate.pairedSampleCount < 2) {
      continue;
    }

    if (best === null || estimate.combinedScore > best.combinedScore) {
      best = {
        lagMs: estimate.lagMs,
        correlationX: estimate.correlationX,
        correlationY: estimate.correlationY,
        combinedScore: estimate.combinedScore,
        pairedSampleCount: estimate.pairedSampleCount,
        source: "estimated",
      };
    }
  }

  if (best === null) {
    return fixedResult.pairedSampleCount >= 2
      ? makeResult({
          lagMs: fixedResult.lagMs,
          correlationX: fixedResult.correlationX,
          correlationY: fixedResult.correlationY,
          combinedScore: fixedResult.combinedScore,
          pairedSampleCount: fixedResult.pairedSampleCount,
          source: "fallback",
        })
      : makeError("insufficient-paired-samples", "No usable paired samples for lag search.");
  }

  if (best.combinedScore >= input.lagConfig.minimumCorrelation) {
    return makeResult(best);
  }

  if (fixedResult.pairedSampleCount >= 2) {
    return makeResult({
      lagMs: fixedResult.lagMs,
      correlationX: fixedResult.correlationX,
      correlationY: fixedResult.correlationY,
      combinedScore: fixedResult.combinedScore,
      pairedSampleCount: fixedResult.pairedSampleCount,
      source: "fallback",
    });
  }

  return makeError("estimation-failed", "Minimum correlation not reached and fixed lag fallback is unavailable.");
}

function isFiniteLagConfig(config: PursuitLagConfig): boolean {
  return Number.isFinite(config.minimumLagMs)
    && Number.isFinite(config.maximumLagMs)
    && Number.isFinite(config.minimumCorrelation)
    && Number.isFinite(config.fixedLagMs)
    && Number.isFinite(config.searchStepMs)
    && config.minimumLagMs >= 0
    && config.maximumLagMs >= config.minimumLagMs
    && config.searchStepMs > 0
    && config.minimumCorrelation >= 0
    && config.minimumCorrelation <= 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
