import {
  CHI_SQUARE_2D_95,
  MAX_ROI_RADIUS_RATIO,
  MIN_RADIUS_PX,
  type CalibrationRoiTemplate,
  type GazeRoi95,
  type ResidualCovariance,
  type RoiEstimationError,
  type Result,
  type ValidationResidualSample,
  type ViewportPoint,
} from "../domain/calibration-types";

export type RoiEstimationOptions = Readonly<{
  viewportBasis: {
    width: number;
    height: number;
  };
  minimumSamples: number;
  fallbackRadiusPx?: number;
}>;

export type RoiEstimationOutput = {
  readonly template: CalibrationRoiTemplate;
  readonly fallbackApplied: boolean;
};

type RoiResult = Result<RoiEstimationOutput, RoiEstimationError>;

export function estimateRoiTemplate(
  residualSamples: readonly ValidationResidualSample[],
  options: RoiEstimationOptions,
): RoiResult {
  if (!Number.isFinite(options.viewportBasis.width) || !Number.isFinite(options.viewportBasis.height)
    || options.viewportBasis.width <= 0 || options.viewportBasis.height <= 0) {
    return {
      ok: false,
      error: {
        kind: "invalid-number",
        message: "Viewport basis must be finite and positive.",
      },
    };
  }

  const validResiduals = residualSamples.filter(
    (sample) => Number.isFinite(sample.residual.x) && Number.isFinite(sample.residual.y),
  );

  const fallbackRadiusPx =
    options.fallbackRadiusPx ?? Math.min(options.viewportBasis.width, options.viewportBasis.height) * 0.04;

  if (validResiduals.length < Math.max(1, options.minimumSamples)) {
    return makeTemplateResult(validResiduals, options.viewportBasis, true, fallbackRadiusPx);
  }

  const covariance = calculateCovariance(validResiduals);
  if (!isFiniteCovariance(covariance)) {
    return makeTemplateResult(validResiduals, options.viewportBasis, true, fallbackRadiusPx);
  }

  if (covariance.xx < 0 || covariance.yy < 0) {
    return makeTemplateResult(validResiduals, options.viewportBasis, true, fallbackRadiusPx);
  }

  const eigen = eigenDecomposition(covariance);
  if (eigen === null) {
    return makeTemplateResult(validResiduals, options.viewportBasis, true, fallbackRadiusPx);
  }

  const radiusMajor = Math.sqrt(Math.max(0, eigen.major * CHI_SQUARE_2D_95));
  const radiusMinor = Math.sqrt(Math.max(0, eigen.minor * CHI_SQUARE_2D_95));

  const clamped = clampRadii({
    radiusMajor,
    radiusMinor,
    viewportBasis: options.viewportBasis,
    fallbackPx: fallbackRadiusPx,
  });

  return {
    ok: true,
    value: {
      template: {
        radiusMajor: clamped.radiusMajor,
        radiusMinor: clamped.radiusMinor,
        rotationRad: eigen.rotationRad,
        covariance,
        source: clamped.fallbackApplied ? "fallback" : "validation-residuals",
      },
      fallbackApplied: clamped.fallbackApplied,
    },
  };
}

export function combineRoiTemplateWithCenter(
  template: CalibrationRoiTemplate,
  center: ViewportPoint,
  calibrationVersion: string,
): GazeRoi95 {
  const { widthAxis, heightAxis } = ellipseAxisExtents(template.radiusMajor, template.radiusMinor, template.rotationRad);

  return {
    confidence: 0.95,
    shape: "ellipse",
    center,
    radiusMajor: template.radiusMajor,
    radiusMinor: template.radiusMinor,
    rotationRad: template.rotationRad,
    axisAlignedBounds: {
      left: center.x - widthAxis,
      right: center.x + widthAxis,
      top: center.y - heightAxis,
      bottom: center.y + heightAxis,
    },
    covariance: template.covariance,
    source: template.source,
    calibrationVersion,
  };
}

function makeTemplateResult(
  residuals: readonly ValidationResidualSample[],
  viewportBasis: { width: number; height: number },
  fallbackApplied: boolean,
  fallbackRadiusPx: number,
): RoiResult {
  const clamped = calculateFallbackTemplate(residuals, viewportBasis, fallbackRadiusPx);

  return {
    ok: true,
    value: {
      template: {
        radiusMajor: clamped.radiusMajor,
        radiusMinor: clamped.radiusMinor,
        rotationRad: 0,
        covariance: clamped.covariance,
        source: fallbackApplied || clamped.sourceWasFallback ? "fallback" : "validation-residuals",
      },
      fallbackApplied: fallbackApplied || clamped.sourceWasFallback,
    },
  };
}

function calculateFallbackTemplate(
  residuals: readonly ValidationResidualSample[],
  viewportBasis: { width: number; height: number },
  fallbackRadiusPx: number,
): { radiusMajor: number; radiusMinor: number; sourceWasFallback: boolean; covariance: ResidualCovariance } {
  const absX = residuals.map((sample) => Math.abs(sample.residual.x)).filter(Number.isFinite);
  const absY = residuals.map((sample) => Math.abs(sample.residual.y)).filter(Number.isFinite);

  const fallbackX = absX.length > 0 ? percentile(absX, 0.95) : fallbackRadiusPx;
  const fallbackY = absY.length > 0 ? percentile(absY, 0.95) : fallbackRadiusPx;

  const clamped = clampRadii({
    radiusMajor: fallbackX,
    radiusMinor: fallbackY,
    viewportBasis,
    fallbackPx: fallbackRadiusPx,
  });

  const radiusMajor = clamped.radiusMajor;
  const radiusMinor = clamped.radiusMinor;
  const covariance = {
    xx: (radiusMajor * radiusMajor) / CHI_SQUARE_2D_95,
    xy: 0,
    yy: (radiusMinor * radiusMinor) / CHI_SQUARE_2D_95,
  };

  return {
    radiusMajor,
    radiusMinor,
    sourceWasFallback: true,
    covariance,
  };
}

function calculateCovariance(samples: readonly ValidationResidualSample[]): ResidualCovariance {
  if (samples.length <= 1) {
    return { xx: 0, xy: 0, yy: 0 };
  }

  const count = samples.length;
  let sumXX = 0;
  let sumXY = 0;
  let sumYY = 0;

  for (const sample of samples) {
    const x = sample.residual.x;
    const y = sample.residual.y;
    sumXX += x * x;
    sumXY += x * y;
    sumYY += y * y;
  }

  const denominator = Math.max(1, count - 1);
  return {
    xx: sumXX / denominator,
    xy: sumXY / denominator,
    yy: sumYY / denominator,
  };
}

function isFiniteCovariance(covariance: ResidualCovariance): boolean {
  return [covariance.xx, covariance.xy, covariance.yy].every(Number.isFinite);
}

function clampRadii(input: {
  radiusMajor: number;
  radiusMinor: number;
  viewportBasis: { width: number; height: number };
  fallbackPx: number;
}): { radiusMajor: number; radiusMinor: number; fallbackApplied: boolean } {
  const maxRadius = Math.max(input.viewportBasis.width, input.viewportBasis.height) * MAX_ROI_RADIUS_RATIO;
  const clampedMajor = Math.max(MIN_RADIUS_PX, Math.min(maxRadius, input.radiusMajor || input.fallbackPx));
  const clampedMinor = Math.max(MIN_RADIUS_PX, Math.min(maxRadius, input.radiusMinor || input.fallbackPx));

  return {
    radiusMajor: clampedMajor,
    radiusMinor: clampedMinor,
    fallbackApplied: clampedMajor !== input.radiusMajor || clampedMinor !== input.radiusMinor,
  };
}

function eigenDecomposition(covariance: ResidualCovariance):
  | { major: number; minor: number; rotationRad: number }
  | null {
  const { xx, xy, yy } = covariance;
  const trace = xx + yy;
  const determinant = xx * yy - xy * xy;
  if (!Number.isFinite(trace) || !Number.isFinite(determinant) || !Number.isFinite(xy)) {
    return null;
  }

  const discriminant = Math.max(0, (xx - yy) ** 2 + 4 * xy * xy);
  const root = Math.sqrt(discriminant);
  const rawMajor = (trace + root) / 2;
  const rawMinor = (trace - root) / 2;

  const major = clampEigen(rawMajor);
  const minor = clampEigen(rawMinor);
  if (major < 0 || minor < 0) {
    return null;
  }

  const rotationRad = 0.5 * Math.atan2(2 * xy, xx - yy);

  return {
    major,
    minor,
    rotationRad,
  };
}

function clampEigen(value: number): number {
  if (!Number.isFinite(value)) {
    return -1;
  }

  if (value >= 0) {
    return value;
  }

  return value > -1e-10 ? 0 : -1;
}

function ellipseAxisExtents(a: number, b: number, rotationRad: number): {
  widthAxis: number;
  heightAxis: number;
} {
  const widthAxis = Math.sqrt(a * a * Math.cos(rotationRad) ** 2 + b * b * Math.sin(rotationRad) ** 2);
  const heightAxis = Math.sqrt(a * a * Math.sin(rotationRad) ** 2 + b * b * Math.cos(rotationRad) ** 2);
  return { widthAxis, heightAxis };
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const safeRatio = Math.min(1, Math.max(0, ratio));
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.floor((sorted.length - 1) * safeRatio);
  return sorted[index] ?? 0;
}
