import {
  AffineCalibrationModel,
  CalibrationValidationMetrics,
  type CalibrationObservation,
  type ResidualAnalysisResult,
  type ResidualBias,
  type Result,
  type ValidationResidualSample,
  type ViewportPoint,
  ResidualCovariance,
} from "../domain/calibration-types";
import { projectRawGazeToViewportWithoutBias } from "./affine-calibration";

type ResidualError = "sample-count" | "invalid-number";
type ResultWithError<T, K extends string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly kind: K; readonly message: string } };

export function analyzeResiduals(
  observations: readonly CalibrationObservation[],
  model: AffineCalibrationModel,
): ResultWithError<ResidualAnalysisResult, ResidualError> {
  if (!observations.length) {
    return {
      ok: false,
      error: {
        kind: "sample-count",
        message: "No validation observations provided.",
      },
    };
  }

  const residualSamples: ValidationResidualSample[] = [];

  for (const observation of observations) {
    const predicted = projectRawGazeToViewportWithoutBias(model, observation.sample.rawVector);
    if (!isFinitePoint(predicted) || !isFinitePoint(observation.target.viewportPoint)) {
      return {
        ok: false,
        error: {
          kind: "invalid-number",
          message: "Invalid numeric value found while computing residuals.",
        },
      };
    }

    const residual: ViewportPoint = {
      x: predicted.x - observation.target.viewportPoint.x,
      y: predicted.y - observation.target.viewportPoint.y,
    };

    residualSamples.push({
      target: observation.target.viewportPoint,
      predicted,
      residual,
    });
  }

  const bias = meanResidual(residualSamples);
  const correctedResiduals = residualSamples.map((entry) => ({
    ...entry,
    residual: {
      x: entry.residual.x - bias.x,
      y: entry.residual.y - bias.y,
    },
  }));

  return {
    ok: true,
    value: {
      rawResiduals: residualSamples,
      biasCorrection: bias,
      correctedResiduals,
      metricsBeforeCorrection: calculateMetricsFromResiduals(residualSamples),
      metricsAfterCorrection: calculateMetricsFromResiduals(correctedResiduals),
    },
  };
}

export function calculateResidualCovariance(
  residualSamples: readonly ValidationResidualSample[],
): ResidualCovariance {
  if (residualSamples.length <= 1) {
    return { xx: 0, xy: 0, yy: 0 };
  }

  let sumXX = 0;
  let sumXY = 0;
  let sumYY = 0;
  const count = residualSamples.length;

  for (const sample of residualSamples) {
    sumXX += sample.residual.x * sample.residual.x;
    sumXY += sample.residual.x * sample.residual.y;
    sumYY += sample.residual.y * sample.residual.y;
  }

  const denominator = Math.max(1, count - 1);
  return {
    xx: sumXX / denominator,
    xy: sumXY / denominator,
    yy: sumYY / denominator,
  };
}

export function calculateMetrics(samples: readonly ValidationResidualSample[]): CalibrationValidationMetrics {
  return calculateMetricsFromResiduals(samples);
}

export function meanResidual(samples: readonly ValidationResidualSample[]): ResidualBias {
  if (samples.length === 0) {
    return { x: 0, y: 0 };
  }

  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const sample of samples) {
    if (!isFinitePoint(sample.residual)) {
      continue;
    }

    sumX += sample.residual.x;
    sumY += sample.residual.y;
    count += 1;
  }

  if (count === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: sumX / count,
    y: sumY / count,
  };
}

function calculateMetricsFromResiduals(samples: readonly ValidationResidualSample[]): CalibrationValidationMetrics {
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      meanResidual: { x: 0, y: 0 },
      rmse: { x: 0, y: 0, radial: 0 },
      meanAbsoluteError: { x: 0, y: 0 },
      maxRadialError: 0,
    };
  }

  const xResiduals = samples.map((sample) => sample.residual.x);
  const yResiduals = samples.map((sample) => sample.residual.y);
  const radialErrors = samples.map((sample) => Math.hypot(sample.residual.x, sample.residual.y));
  const mean = meanResidual(samples);

  return {
    sampleCount: samples.length,
    meanResidual: mean,
    rmse: {
      x: rootMeanSquare(xResiduals),
      y: rootMeanSquare(yResiduals),
      radial: rootMeanSquare(radialErrors),
    },
    meanAbsoluteError: {
      x: meanAbsolute(xResiduals),
      y: meanAbsolute(yResiduals),
    },
    maxRadialError: radialErrors.reduce((acc, value) => Math.max(acc, value), 0),
  };
}

function rootMeanSquare(values: readonly number[]): number {
  if (!values.length) {
    return 0;
  }

  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return 0;
  }

  const sum = finite.reduce((acc, value) => acc + value * value, 0);
  return Math.sqrt(sum / finite.length);
}

function meanAbsolute(values: readonly number[]): number {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return 0;
  }

  const sum = finite.reduce((acc, value) => acc + Math.abs(value), 0);
  return sum / finite.length;
}

function isFinitePoint(point: ViewportPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
