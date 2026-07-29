import {
  makeError,
  makeResult,
  type Result,
} from "../domain/calibration-types";

export type PursuitTargetConfig = Readonly<{
  readonly diameterPx: number;
  readonly centerDotDiameterPx: number;
  readonly borderWidthPx: number;
  readonly viewportInsetPx: number;
}>;

export type PursuitMotionConfig = Readonly<{
  readonly speedPxPerSecond: number;
  readonly samplingIntervalMs: number;
  readonly movementWarmupMs: number;
  readonly movementCooldownMs: number;
}>;

export type PursuitTransitionConfig = Readonly<{
  readonly initialHoldMs: number;
  readonly segmentStopMs: number;
  readonly endpointHoldMs: number;
  readonly directionCueMs: number;
  readonly settleAfterCueMs: number;
}>;

export type PursuitLagConfig = Readonly<{
  readonly mode: "estimate" | "fixed";
  readonly fixedLagMs: number;
  readonly minimumLagMs: number;
  readonly maximumLagMs: number;
  readonly searchStepMs: number;
  readonly minimumCorrelation: number;
}>;

export type PursuitSampleSelectionConfig = Readonly<{
  readonly minimumCalibrationSamples: number;
  readonly minimumValidationSamples: number;
  readonly spatialBinSizePx: number;
  readonly maximumSamplesPerSpatialBin: number;
  readonly trimRatio: number;
}>;

export type PursuitRoiConfig = Readonly<{
  readonly coverageProbability: number;
  readonly estimationMethod: "empirical-mahalanobis" | "gaussian-chi-square";
  readonly minimumResidualCount: number;
  readonly minimumRadiusPx: number;
  readonly maximumRadiusPx: number;
  readonly clampBoundsToViewport: boolean;
}>;

export type PursuitCalibrationConfig = Readonly<{
  readonly target: PursuitTargetConfig;
  readonly motion: PursuitMotionConfig;
  readonly transition: PursuitTransitionConfig;
  readonly lagAlignment: PursuitLagConfig;
  readonly sampleSelection: PursuitSampleSelectionConfig;
  readonly roi: PursuitRoiConfig;
}>;

export type PursuitCalibrationConfigError =
  | "target-invalid"
  | "motion-invalid"
  | "transition-invalid"
  | "lag-invalid"
  | "sample-selection-invalid"
  | "roi-invalid";

export const DEFAULT_PURSUIT_CALIBRATION_CONFIG: PursuitCalibrationConfig = {
  target: {
    diameterPx: 56,
    centerDotDiameterPx: 8,
    borderWidthPx: 2,
    viewportInsetPx: 16,
  },
  motion: {
    speedPxPerSecond: 120,
    samplingIntervalMs: 50,
    movementWarmupMs: 250,
    movementCooldownMs: 250,
  },
  transition: {
    initialHoldMs: 800,
    segmentStopMs: 120,
    endpointHoldMs: 300,
    directionCueMs: 500,
    settleAfterCueMs: 300,
  },
  lagAlignment: {
    mode: "estimate",
    fixedLagMs: 150,
    minimumLagMs: 0,
    maximumLagMs: 300,
    searchStepMs: 10,
    minimumCorrelation: 0.4,
  },
  sampleSelection: {
    minimumCalibrationSamples: 60,
    minimumValidationSamples: 40,
    spatialBinSizePx: 64,
    maximumSamplesPerSpatialBin: 8,
    trimRatio: 0.1,
  },
  roi: {
    coverageProbability: 0.95,
    estimationMethod: "empirical-mahalanobis",
    minimumResidualCount: 40,
    minimumRadiusPx: 8,
    maximumRadiusPx: 180,
    clampBoundsToViewport: true,
  },
};

export function validatePursuitCalibrationConfig(
  config: PursuitCalibrationConfig,
): Result<PursuitCalibrationConfig, PursuitCalibrationConfigError> {
  const { target } = config;
  if (
    !isPositiveFinite(target.diameterPx)
    || !isPositiveFinite(target.centerDotDiameterPx)
    || target.centerDotDiameterPx >= target.diameterPx
    || !isNonNegativeFinite(target.borderWidthPx)
    || target.borderWidthPx >= target.diameterPx / 2
    || !isNonNegativeFinite(target.viewportInsetPx)
  ) {
    return makeError(
      "target-invalid",
      "Target diameters must be positive, the center dot and border must fit inside the target, and inset must be non-negative.",
    );
  }

  const { motion } = config;
  if (
    !isPositiveFinite(motion.speedPxPerSecond)
    || !isPositiveFinite(motion.samplingIntervalMs)
    || !isNonNegativeFinite(motion.movementWarmupMs)
    || !isNonNegativeFinite(motion.movementCooldownMs)
  ) {
    return makeError(
      "motion-invalid",
      "Motion speed and sampling interval must be positive, and movement margins must be non-negative.",
    );
  }

  const { transition } = config;
  if (
    !isNonNegativeFinite(transition.initialHoldMs)
    || !isNonNegativeFinite(transition.segmentStopMs)
    || !isNonNegativeFinite(transition.endpointHoldMs)
    || !isNonNegativeFinite(transition.directionCueMs)
    || !isNonNegativeFinite(transition.settleAfterCueMs)
  ) {
    return makeError("transition-invalid", "Transition durations must be finite and non-negative.");
  }

  const { lagAlignment } = config;
  if (
    !isNonNegativeFinite(lagAlignment.fixedLagMs)
    || !isNonNegativeFinite(lagAlignment.minimumLagMs)
    || !isNonNegativeFinite(lagAlignment.maximumLagMs)
    || lagAlignment.minimumLagMs > lagAlignment.maximumLagMs
    || lagAlignment.fixedLagMs < lagAlignment.minimumLagMs
    || lagAlignment.fixedLagMs > lagAlignment.maximumLagMs
    || !isPositiveFinite(lagAlignment.searchStepMs)
    || !Number.isFinite(lagAlignment.minimumCorrelation)
    || lagAlignment.minimumCorrelation < 0
    || lagAlignment.minimumCorrelation > 1
  ) {
    return makeError(
      "lag-invalid",
      "Lag values must form a valid non-negative range, fixed lag must be within it, search step must be positive, and correlation must be in [0, 1].",
    );
  }

  const { sampleSelection } = config;
  if (
    !isPositiveInteger(sampleSelection.minimumCalibrationSamples)
    || !isPositiveInteger(sampleSelection.minimumValidationSamples)
    || !isPositiveFinite(sampleSelection.spatialBinSizePx)
    || !isPositiveInteger(sampleSelection.maximumSamplesPerSpatialBin)
    || !Number.isFinite(sampleSelection.trimRatio)
    || sampleSelection.trimRatio < 0
    || sampleSelection.trimRatio >= 0.5
  ) {
    return makeError(
      "sample-selection-invalid",
      "Sample counts and bin limits must be positive, and trim ratio must be in [0, 0.5).",
    );
  }

  const { roi } = config;
  if (
    !Number.isFinite(roi.coverageProbability)
    || roi.coverageProbability <= 0
    || roi.coverageProbability >= 1
    || !isPositiveInteger(roi.minimumResidualCount)
    || !isNonNegativeFinite(roi.minimumRadiusPx)
    || !isPositiveFinite(roi.maximumRadiusPx)
    || roi.minimumRadiusPx > roi.maximumRadiusPx
  ) {
    return makeError(
      "roi-invalid",
      "ROI coverage must be in (0, 1), residual count must be positive, and radius bounds must be valid.",
    );
  }

  return makeResult(config);
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
