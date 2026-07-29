import type { PursuitCalibrationConfig } from "../config/pursuit-calibration-config";
import {
  CALIBRATION_MODEL_VERSION,
  LEGACY_GAZE_ROI_COVERAGE_PROBABILITY,
  SMALL_EIGENVALUE_EPSILON,
  makeError,
  makeResult,
  type AxisAlignedBounds,
  type ConfidenceRoiFallbackReason,
  type GazeConfidenceRoi,
  type GazeConfidenceRoiTemplate,
  type GazeResidual,
  type GazeRoi95,
  type LegacyGazeRoi95Error,
  type ResidualCovariance,
  type Result,
  type RoiClampInfo,
  type RoiCoverageMetrics,
  type ViewportPoint,
  type ViewportRect,
} from "../domain/calibration-types";

export type ConfidenceRoiTemplateConfig = PursuitCalibrationConfig["roi"];

export type ConfidenceRoiTemplateResult = Readonly<{
  readonly template: GazeConfidenceRoiTemplate;
}>;

export type ConfidenceRoiEstimationError =
  | "invalid-input"
  | "invalid-coverage";

export type ConfidenceRoiEstimationResult = Result<
  ConfidenceRoiTemplateResult,
  ConfidenceRoiEstimationError
>;

export type ConfidenceRoiQuantileError = "invalid-probability" | "empty";

export type EmpiricalQuantileResult = Readonly<{
  readonly value: number;
  readonly probability: number;
  readonly index: number;
  readonly sampleCount: number;
}>;

export type EmpiricalQuantileComputationResult = Result<
  EmpiricalQuantileResult,
  ConfidenceRoiQuantileError
>;

export type ChiSquareQuantileResult = Result<
  Readonly<{ readonly quantile: number }>,
  "invalid-coverage" | "invalid-input"
>;

export type LegacyGazeRoi95Result = Result<GazeRoi95, LegacyGazeRoi95Error>;

export type ConfidenceRoiPlacementTemplate = Pick<
  GazeConfidenceRoiTemplate,
  | "coverageProbability"
  | "radiusMajor"
  | "radiusMinor"
  | "rotationRad"
  | "covariance"
  | "scaleQuantile"
  | "estimationMethod"
  | "source"
  | "clampBoundsToViewport"
  | "fallbackReason"
>;

type CovarianceEigen = Readonly<{
  readonly major: number;
  readonly minor: number;
  readonly rotationRad: number;
}>;

type EllipseRadii = Readonly<{
  readonly radiusMajor: number;
  readonly radiusMinor: number;
}>;

/**
 * Uses nearest rank: ceil(probability * finiteSampleCount) - 1.
 * Non-finite values are excluded before sorting.
 */
export function calculateEmpiricalQuantile(
  values: readonly number[],
  probability: number,
): EmpiricalQuantileComputationResult {
  if (!isValidProbability(probability)) {
    return makeError(
      "invalid-probability",
      "Probability must be a finite number in (0, 1).",
    );
  }

  const sorted = values
    .filter(Number.isFinite)
    .slice()
    .sort((left, right) => left - right);

  if (sorted.length === 0) {
    return makeError(
      "empty",
      "Quantile input must contain at least one finite value.",
    );
  }

  const index = Math.ceil(probability * sorted.length) - 1;
  const value = sorted[index];
  if (value === undefined) {
    return makeError("empty", "Quantile rank could not be resolved.");
  }

  return makeResult({
    value,
    probability,
    index,
    sampleCount: sorted.length,
  });
}

export function calculateChiSquareQuantile2D(
  coverageProbability: number,
): ChiSquareQuantileResult {
  if (!Number.isFinite(coverageProbability)) {
    return makeError(
      "invalid-input",
      "Coverage probability must be a finite number.",
    );
  }

  if (!isValidProbability(coverageProbability)) {
    return makeError(
      "invalid-coverage",
      "Coverage probability must be greater than 0 and less than 1.",
    );
  }

  const quantile = -2 * Math.log1p(-coverageProbability);
  if (!Number.isFinite(quantile) || quantile <= 0) {
    return makeError(
      "invalid-input",
      "Coverage probability produced an invalid chi-square quantile.",
    );
  }

  return makeResult({ quantile });
}

/**
 * Residuals must be validation residuals after bias correction. The estimator
 * intentionally does not subtract a second mean or use calibration residuals.
 */
export function estimateConfidenceRoiTemplate(
  residuals: readonly GazeResidual[],
  config: ConfidenceRoiTemplateConfig,
): ConfidenceRoiEstimationResult {
  const configResult = validateConfig(config);
  if (!configResult.ok) {
    return configResult;
  }

  if (!residuals.every(isFiniteResidual)) {
    return makeError(
      "invalid-input",
      "Validation residuals must contain only finite coordinates.",
    );
  }

  if (residuals.length < config.minimumResidualCount) {
    return makeResult({
      template: createFallbackTemplate(
        residuals,
        config,
        "insufficient-residuals",
      ),
    });
  }

  if (config.estimationMethod === "gaussian-chi-square") {
    const gaussianResult = estimateGaussianTemplate(residuals, config);
    return gaussianResult.ok
      ? makeResult({ template: gaussianResult.value })
      : makeResult({
          template: createFallbackTemplate(
            residuals,
            config,
            gaussianResult.error.kind,
          ),
        });
  }

  const empiricalResult = estimateEmpiricalMahalanobisTemplate(
    residuals,
    config,
  );
  if (empiricalResult.ok) {
    return makeResult({ template: empiricalResult.value });
  }

  const gaussianResult = estimateGaussianTemplate(residuals, config);
  if (gaussianResult.ok) {
    return makeResult({
      template: {
        ...gaussianResult.value,
        source: "fallback",
        fallbackReason: empiricalResult.error.kind,
      },
    });
  }

  return makeResult({
    template: createFallbackTemplate(
      residuals,
      config,
      gaussianResult.error.kind,
    ),
  });
}

export function createConfidenceRoiAtPoint(
  center: ViewportPoint,
  template: ConfidenceRoiPlacementTemplate,
  viewportRect?: ViewportRect,
  calibrationVersion = CALIBRATION_MODEL_VERSION,
): GazeConfidenceRoi {
  const { widthAxis, heightAxis } = calculateEllipseAxisExtents(
    template.radiusMajor,
    template.radiusMinor,
    template.rotationRad,
  );
  const bounds: AxisAlignedBounds = {
    left: center.x - widthAxis,
    top: center.y - heightAxis,
    right: center.x + widthAxis,
    bottom: center.y + heightAxis,
  };
  const axisAlignedBounds =
    template.clampBoundsToViewport
    && viewportRect !== undefined
    && isFiniteViewportRect(viewportRect)
      ? clampAxisAlignedBounds(bounds, viewportRect)
      : bounds;

  return {
    coverageProbability: template.coverageProbability,
    shape: "ellipse",
    center,
    radiusMajor: template.radiusMajor,
    radiusMinor: template.radiusMinor,
    rotationRad: template.rotationRad,
    axisAlignedBounds,
    covariance: template.covariance,
    scaleQuantile: template.scaleQuantile,
    estimationMethod: template.estimationMethod,
    source: template.source,
    fallbackReason: template.fallbackReason,
    calibrationVersion,
  };
}

export function toLegacyGazeRoi95(
  confidenceRoi: GazeConfidenceRoi,
): LegacyGazeRoi95Result {
  if (
    confidenceRoi.coverageProbability
      !== LEGACY_GAZE_ROI_COVERAGE_PROBABILITY
  ) {
    return makeError(
      "unsupported-coverage",
      "Only the legacy coverage probability can be converted to GazeRoi95.",
    );
  }

  return makeResult({
    confidence: LEGACY_GAZE_ROI_COVERAGE_PROBABILITY,
    shape: confidenceRoi.shape,
    center: confidenceRoi.center,
    radiusMajor: confidenceRoi.radiusMajor,
    radiusMinor: confidenceRoi.radiusMinor,
    rotationRad: confidenceRoi.rotationRad,
    axisAlignedBounds: confidenceRoi.axisAlignedBounds,
    covariance: confidenceRoi.covariance,
    source: confidenceRoi.source,
    calibrationVersion: confidenceRoi.calibrationVersion,
  });
}

function estimateEmpiricalMahalanobisTemplate(
  residuals: readonly GazeResidual[],
  config: ConfidenceRoiTemplateConfig,
): Result<GazeConfidenceRoiTemplate, ConfidenceRoiFallbackReason> {
  const covariance = calculateResidualCovariance(residuals);
  if (!isInvertibleCovariance(covariance)) {
    return makeError(
      "singular-covariance",
      "Residual covariance is singular or numerically unstable.",
    );
  }

  const distancesResult = calculateMahalanobisDistances(
    residuals,
    covariance,
  );
  if (
    !distancesResult.ok
    || distancesResult.value.length !== residuals.length
  ) {
    return makeError(
      "invalid-distance-distribution",
      "Could not compute a finite Mahalanobis distance for every residual.",
    );
  }

  const quantileResult = calculateEmpiricalQuantile(
    distancesResult.value,
    config.coverageProbability,
  );
  if (!quantileResult.ok || quantileResult.value.value <= 0) {
    return makeError(
      "invalid-distance-distribution",
      "Empirical Mahalanobis distances produced an invalid scale quantile.",
    );
  }

  const eigenResult = decomposeCovariance(covariance);
  if (!eigenResult.ok) {
    return eigenResult;
  }
  const radiiResult = calculateEllipseRadii(
    eigenResult.value,
    quantileResult.value.value,
  );
  if (!radiiResult.ok) {
    return radiiResult;
  }

  return makeResult(makeTemplate({
    residuals,
    config,
    covariance,
    eigen: eigenResult.value,
    radii: radiiResult.value,
    scaleQuantile: quantileResult.value.value,
    estimationMethod: "empirical-mahalanobis",
    source: "validation-residuals",
  }));
}

function estimateGaussianTemplate(
  residuals: readonly GazeResidual[],
  config: ConfidenceRoiTemplateConfig,
): Result<GazeConfidenceRoiTemplate, ConfidenceRoiFallbackReason> {
  const covariance = calculateResidualCovariance(residuals);
  if (!isInvertibleCovariance(covariance)) {
    return makeError(
      "singular-covariance",
      "Residual covariance is singular or numerically unstable.",
    );
  }

  const eigenResult = decomposeCovariance(covariance);
  if (!eigenResult.ok) {
    return eigenResult;
  }
  const quantileResult = calculateChiSquareQuantile2D(
    config.coverageProbability,
  );
  if (!quantileResult.ok) {
    return makeError(
      "invalid-distance-distribution",
      quantileResult.error.message,
    );
  }
  const radiiResult = calculateEllipseRadii(
    eigenResult.value,
    quantileResult.value.quantile,
  );
  if (!radiiResult.ok) {
    return radiiResult;
  }

  return makeResult(makeTemplate({
    residuals,
    config,
    covariance,
    eigen: eigenResult.value,
    radii: radiiResult.value,
    scaleQuantile: quantileResult.value.quantile,
    estimationMethod: "gaussian-chi-square",
    source: "validation-residuals",
  }));
}

function makeTemplate(args: Readonly<{
  residuals: readonly GazeResidual[];
  config: ConfidenceRoiTemplateConfig;
  covariance: ResidualCovariance;
  eigen: CovarianceEigen;
  radii: EllipseRadii;
  scaleQuantile: number;
  estimationMethod: GazeConfidenceRoiTemplate["estimationMethod"];
  source: GazeConfidenceRoiTemplate["source"];
}>): GazeConfidenceRoiTemplate {
  const clamped = clampRadii(args.radii, {
    minimum: args.config.minimumRadiusPx,
    maximum: args.config.maximumRadiusPx,
  });

  return {
    coverageProbability: args.config.coverageProbability,
    radiusMajor: clamped.radiusMajor,
    radiusMinor: clamped.radiusMinor,
    rotationRad: args.eigen.rotationRad,
    covariance: args.covariance,
    scaleQuantile: args.scaleQuantile,
    estimationMethod: args.estimationMethod,
    source: args.source,
    clampBoundsToViewport: args.config.clampBoundsToViewport,
    metrics: createCoverageMetrics({
      residuals: args.residuals,
      coverageProbability: args.config.coverageProbability,
      radiusMajor: clamped.radiusMajor,
      radiusMinor: clamped.radiusMinor,
      rotationRad: args.eigen.rotationRad,
      clamped,
      scaleQuantile: args.scaleQuantile,
    }),
  };
}

function createFallbackTemplate(
  residuals: readonly GazeResidual[],
  config: ConfidenceRoiTemplateConfig,
  fallbackReason: ConfidenceRoiFallbackReason,
): GazeConfidenceRoiTemplate {
  const xQuantile = calculateEmpiricalQuantile(
    residuals.map((residual) => Math.abs(residual.x)),
    config.coverageProbability,
  );
  const yQuantile = calculateEmpiricalQuantile(
    residuals.map((residual) => Math.abs(residual.y)),
    config.coverageProbability,
  );
  const scaleResult = calculateChiSquareQuantile2D(
    config.coverageProbability,
  );
  const xRadius = xQuantile.ok
    ? xQuantile.value.value
    : config.minimumRadiusPx;
  const yRadius = yQuantile.ok
    ? yQuantile.value.value
    : config.minimumRadiusPx;
  const scaleQuantile = scaleResult.ok ? scaleResult.value.quantile : 1;
  const rawRadii: EllipseRadii = xRadius >= yRadius
    ? { radiusMajor: xRadius, radiusMinor: yRadius }
    : { radiusMajor: yRadius, radiusMinor: xRadius };
  const rotationRad = xRadius >= yRadius ? 0 : Math.PI / 2;
  const clamped = clampRadii(rawRadii, {
    minimum: config.minimumRadiusPx,
    maximum: config.maximumRadiusPx,
  });
  const covariance = covarianceFromEllipse(
    clamped.radiusMajor,
    clamped.radiusMinor,
    rotationRad,
    scaleQuantile,
  );

  return {
    coverageProbability: config.coverageProbability,
    radiusMajor: clamped.radiusMajor,
    radiusMinor: clamped.radiusMinor,
    rotationRad,
    covariance,
    scaleQuantile,
    estimationMethod: "gaussian-chi-square",
    source: "fallback",
    clampBoundsToViewport: config.clampBoundsToViewport,
    metrics: createCoverageMetrics({
      residuals,
      coverageProbability: config.coverageProbability,
      radiusMajor: clamped.radiusMajor,
      radiusMinor: clamped.radiusMinor,
      rotationRad,
      clamped,
      scaleQuantile,
    }),
    fallbackReason,
  };
}

function createCoverageMetrics(args: Readonly<{
  residuals: readonly GazeResidual[];
  coverageProbability: number;
  radiusMajor: number;
  radiusMinor: number;
  rotationRad: number;
  clamped: RoiClampInfo;
  scaleQuantile: number;
}>): RoiCoverageMetrics {
  const coveredResidualCount = args.residuals.filter((residual) =>
    isInsideEllipse(
      residual,
      args.radiusMajor,
      args.radiusMinor,
      args.rotationRad,
    )
  ).length;
  const totalResidualCount = args.residuals.length;

  return {
    requestedCoverage: args.coverageProbability,
    empiricalCoverage: totalResidualCount === 0
      ? 0
      : coveredResidualCount / totalResidualCount,
    coveredResidualCount,
    totalResidualCount,
    roiAreaPx2: Math.PI * args.radiusMajor * args.radiusMinor,
    scaleQuantile: args.scaleQuantile,
    radiusMajor: args.radiusMajor,
    radiusMinor: args.radiusMinor,
    majorRadiusClamped: args.clamped.majorClamped,
    minorRadiusClamped: args.clamped.minorClamped,
  };
}

function calculateResidualCovariance(
  residuals: readonly GazeResidual[],
): ResidualCovariance {
  if (residuals.length <= 1) {
    return { xx: 0, xy: 0, yy: 0 };
  }

  let sumXX = 0;
  let sumXY = 0;
  let sumYY = 0;
  for (const residual of residuals) {
    sumXX += residual.x * residual.x;
    sumXY += residual.x * residual.y;
    sumYY += residual.y * residual.y;
  }

  const denominator = residuals.length - 1;
  return {
    xx: sumXX / denominator,
    xy: sumXY / denominator,
    yy: sumYY / denominator,
  };
}

function isInvertibleCovariance(
  covariance: ResidualCovariance,
): boolean {
  if (
    !Number.isFinite(covariance.xx)
    || !Number.isFinite(covariance.xy)
    || !Number.isFinite(covariance.yy)
    || covariance.xx < 0
    || covariance.yy < 0
  ) {
    return false;
  }

  const determinant =
    covariance.xx * covariance.yy - covariance.xy * covariance.xy;
  return Number.isFinite(determinant)
    && determinant > SMALL_EIGENVALUE_EPSILON;
}

function calculateMahalanobisDistances(
  residuals: readonly GazeResidual[],
  covariance: ResidualCovariance,
): Result<readonly number[], "invalid-covariance" | "invalid-number"> {
  const inverseResult = invertCovariance(covariance);
  if (!inverseResult.ok) {
    return inverseResult;
  }

  const distances: number[] = [];
  for (const residual of residuals) {
    const transformedX =
      residual.x * inverseResult.value.xx
      + residual.y * inverseResult.value.xy;
    const transformedY =
      residual.x * inverseResult.value.yx
      + residual.y * inverseResult.value.yy;
    const distanceSquared =
      residual.x * transformedX + residual.y * transformedY;

    if (
      !Number.isFinite(distanceSquared)
      || distanceSquared < -SMALL_EIGENVALUE_EPSILON
    ) {
      return makeError(
        "invalid-number",
        "Mahalanobis distance squared must be finite and non-negative.",
      );
    }
    distances.push(Math.max(0, distanceSquared));
  }

  return makeResult(distances);
}

function invertCovariance(
  covariance: ResidualCovariance,
): Result<
  Readonly<{ xx: number; xy: number; yx: number; yy: number }>,
  "invalid-covariance"
> {
  const determinant =
    covariance.xx * covariance.yy - covariance.xy * covariance.xy;
  if (
    !Number.isFinite(determinant)
    || determinant <= SMALL_EIGENVALUE_EPSILON
  ) {
    return makeError("invalid-covariance", "Covariance matrix is singular.");
  }

  return makeResult({
    xx: covariance.yy / determinant,
    xy: -covariance.xy / determinant,
    yx: -covariance.xy / determinant,
    yy: covariance.xx / determinant,
  });
}

function decomposeCovariance(
  covariance: ResidualCovariance,
): Result<CovarianceEigen, "invalid-eigenvalues"> {
  const discriminant =
    (covariance.xx - covariance.yy) ** 2
    + 4 * covariance.xy * covariance.xy;
  if (!Number.isFinite(discriminant) || discriminant < 0) {
    return makeError(
      "invalid-eigenvalues",
      "Covariance produced an invalid eigenvalue discriminant.",
    );
  }

  const trace = covariance.xx + covariance.yy;
  const root = Math.sqrt(discriminant);
  const major = sanitizeEigenvalue((trace + root) / 2);
  const minor = sanitizeEigenvalue((trace - root) / 2);
  if (major === null || minor === null) {
    return makeError(
      "invalid-eigenvalues",
      "Covariance produced negative or non-finite eigenvalues.",
    );
  }

  return makeResult({
    major,
    minor,
    rotationRad: 0.5 * Math.atan2(
      2 * covariance.xy,
      covariance.xx - covariance.yy,
    ),
  });
}

function sanitizeEigenvalue(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value >= 0) {
    return value;
  }
  return value >= -SMALL_EIGENVALUE_EPSILON ? 0 : null;
}

function calculateEllipseRadii(
  eigen: CovarianceEigen,
  scaleQuantile: number,
): Result<EllipseRadii, "invalid-eigenvalues"> {
  const radiusMajor = Math.sqrt(eigen.major * scaleQuantile);
  const radiusMinor = Math.sqrt(eigen.minor * scaleQuantile);
  if (
    !Number.isFinite(scaleQuantile)
    || scaleQuantile <= 0
    || !Number.isFinite(radiusMajor)
    || !Number.isFinite(radiusMinor)
  ) {
    return makeError(
      "invalid-eigenvalues",
      "Covariance and scale quantile produced invalid ellipse radii.",
    );
  }
  return makeResult({ radiusMajor, radiusMinor });
}

function clampRadii(
  radii: EllipseRadii,
  limits: Readonly<{ minimum: number; maximum: number }>,
): EllipseRadii & RoiClampInfo {
  const radiusMajor = clamp(
    radii.radiusMajor,
    limits.minimum,
    limits.maximum,
  );
  const radiusMinor = clamp(
    radii.radiusMinor,
    limits.minimum,
    limits.maximum,
  );
  return {
    radiusMajor,
    radiusMinor,
    majorClamped: radiusMajor !== radii.radiusMajor,
    minorClamped: radiusMinor !== radii.radiusMinor,
  };
}

function isInsideEllipse(
  residual: GazeResidual,
  radiusMajor: number,
  radiusMinor: number,
  rotationRad: number,
): boolean {
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const majorCoordinate = residual.x * cos + residual.y * sin;
  const minorCoordinate = -residual.x * sin + residual.y * cos;
  const normalizedDistance =
    ellipseAxisContribution(majorCoordinate, radiusMajor)
    + ellipseAxisContribution(minorCoordinate, radiusMinor);
  return normalizedDistance <= 1 + SMALL_EIGENVALUE_EPSILON;
}

function ellipseAxisContribution(
  coordinate: number,
  radius: number,
): number {
  if (radius === 0) {
    return Math.abs(coordinate) <= SMALL_EIGENVALUE_EPSILON
      ? 0
      : Number.POSITIVE_INFINITY;
  }
  return (coordinate * coordinate) / (radius * radius);
}

function covarianceFromEllipse(
  radiusMajor: number,
  radiusMinor: number,
  rotationRad: number,
  scaleQuantile: number,
): ResidualCovariance {
  const majorVariance = radiusMajor * radiusMajor / scaleQuantile;
  const minorVariance = radiusMinor * radiusMinor / scaleQuantile;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  return {
    xx: majorVariance * cos * cos + minorVariance * sin * sin,
    xy: (majorVariance - minorVariance) * sin * cos,
    yy: majorVariance * sin * sin + minorVariance * cos * cos,
  };
}

function calculateEllipseAxisExtents(
  majorRadius: number,
  minorRadius: number,
  rotationRad: number,
): Readonly<{ widthAxis: number; heightAxis: number }> {
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  return {
    widthAxis: Math.sqrt(
      majorRadius * majorRadius * cos * cos
      + minorRadius * minorRadius * sin * sin,
    ),
    heightAxis: Math.sqrt(
      majorRadius * majorRadius * sin * sin
      + minorRadius * minorRadius * cos * cos,
    ),
  };
}

function clampAxisAlignedBounds(
  bounds: AxisAlignedBounds,
  viewportRect: ViewportRect,
): AxisAlignedBounds {
  const right = viewportRect.left + viewportRect.width;
  const bottom = viewportRect.top + viewportRect.height;
  return {
    left: clamp(bounds.left, viewportRect.left, right),
    top: clamp(bounds.top, viewportRect.top, bottom),
    right: clamp(bounds.right, viewportRect.left, right),
    bottom: clamp(bounds.bottom, viewportRect.top, bottom),
  };
}

function validateConfig(
  config: ConfidenceRoiTemplateConfig,
): Result<void, ConfidenceRoiEstimationError> {
  if (!isValidProbability(config.coverageProbability)) {
    return makeError(
      "invalid-coverage",
      "ROI coverage probability must be a finite number in (0, 1).",
    );
  }
  if (
    !Number.isInteger(config.minimumResidualCount)
    || config.minimumResidualCount <= 0
    || !Number.isFinite(config.minimumRadiusPx)
    || config.minimumRadiusPx < 0
    || !Number.isFinite(config.maximumRadiusPx)
    || config.maximumRadiusPx <= 0
    || config.minimumRadiusPx > config.maximumRadiusPx
    || typeof config.clampBoundsToViewport !== "boolean"
    || (
      config.estimationMethod !== "empirical-mahalanobis"
      && config.estimationMethod !== "gaussian-chi-square"
    )
  ) {
    return makeError(
      "invalid-input",
      "ROI sample count, radius limits, bounds policy, or estimation method is invalid.",
    );
  }
  return makeResult(undefined);
}

function isValidProbability(probability: number): boolean {
  return Number.isFinite(probability)
    && probability > 0
    && probability < 1;
}

function isFiniteResidual(residual: GazeResidual): boolean {
  return Number.isFinite(residual.x) && Number.isFinite(residual.y);
}

function isFiniteViewportRect(viewportRect: ViewportRect): boolean {
  return Number.isFinite(viewportRect.left)
    && Number.isFinite(viewportRect.top)
    && Number.isFinite(viewportRect.width)
    && Number.isFinite(viewportRect.height)
    && viewportRect.width > 0
    && viewportRect.height > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
