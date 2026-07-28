import {
  type AffineCalibrationModel,
  type CalibrationErrorKind,
  type CalibrationObservation,
  type CalibrationVector3D,
  type Result,
  type ViewportPoint,
} from "../domain/calibration-types";

type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

type Vector3Like = [number, number, number];

type FitResult = Result<AffineCalibrationModel, CalibrationErrorKind>;

const MIN_REQUIRED_OBSERVATIONS = 3;
const MIN_VARIANCE = 1e-9;
const SINGULAR_EPSILON = 1e-12;

export function fitAffineCalibration(
  observations: readonly CalibrationObservation[],
  options: {
    viewportBasis: {
      width: number;
      height: number;
    };
    createdAtMs: number;
    version: string;
  },
): FitResult {
  if (observations.length < MIN_REQUIRED_OBSERVATIONS) {
    return {
      ok: false,
      error: {
        kind: "sample-count",
        message: `At least ${MIN_REQUIRED_OBSERVATIONS} calibration observations are required.`,
      },
    };
  }

  if (!Number.isFinite(options.createdAtMs) || options.createdAtMs < 0) {
    return {
      ok: false,
      error: {
        kind: "invalid-number",
        message: "createdAtMs must be a finite non-negative number.",
      },
    };
  }

  if (!Number.isFinite(options.viewportBasis.width) || !Number.isFinite(options.viewportBasis.height)
    || options.viewportBasis.width <= 0 || options.viewportBasis.height <= 0) {
    return {
      ok: false,
      error: {
        kind: "invalid-number",
        message: "Viewport basis must contain finite positive dimensions.",
      },
    };
  }

  const targetX = observations.map((entry) => entry.target.viewportPoint.x);
  const targetY = observations.map((entry) => entry.target.viewportPoint.y);
  const raw = observations.map((entry) => entry.sample.rawVector);

  if (!isFiniteArray(targetX) || !isFiniteArray(targetY) || !isFiniteVectorList(raw)) {
    return {
      ok: false,
      error: {
        kind: "invalid-number",
        message: "Observation values must be finite numbers.",
      },
    };
  }

  if (!hasSufficientSpread(targetX) || !hasSufficientSpread(targetY)) {
    return {
      ok: false,
      error: {
        kind: "target-distribution",
        message: "Calibration targets have insufficient distribution in viewport space.",
      },
    };
  }

  const xCoefficients = solveLeastSquares(raw, targetX);
  if (xCoefficients === null) {
    return {
      ok: false,
      error: {
        kind: "singular-matrix",
        message: "Unable to solve X-axis affine projection due to singular system.",
      },
    };
  }

  const yCoefficients = solveLeastSquares(raw, targetY);
  if (yCoefficients === null) {
    return {
      ok: false,
      error: {
        kind: "singular-matrix",
        message: "Unable to solve Y-axis affine projection due to singular system.",
      },
    };
  }

  if (!isFiniteArray(xCoefficients) || !isFiniteArray(yCoefficients)) {
    return {
      ok: false,
      error: {
        kind: "invalid-number",
        message: "Model coefficients contain invalid numbers.",
      },
    };
  }

  return {
    ok: true,
    value: {
      method: "affine-2d",
      coefficientsX: xCoefficients,
      coefficientsY: yCoefficients,
      viewportBasis: {
        width: options.viewportBasis.width,
        height: options.viewportBasis.height,
      },
      biasCorrection: {
        x: 0,
        y: 0,
      },
      version: options.version,
      createdAtMs: options.createdAtMs,
    },
  };
}

export function projectRawGazeToViewport(
  model: AffineCalibrationModel,
  rawVector: CalibrationVector3D,
): ViewportPoint {
  const withoutBias = projectRawGazeToViewportWithoutBias(model, rawVector);
  return {
    x: withoutBias.x - model.biasCorrection.x,
    y: withoutBias.y - model.biasCorrection.y,
  };
}

export function projectRawGazeToViewportWithoutBias(
  model: AffineCalibrationModel,
  rawVector: CalibrationVector3D,
): ViewportPoint {
  return {
    x: model.coefficientsX[0] + model.coefficientsX[1] * rawVector.x + model.coefficientsX[2] * rawVector.y,
    y: model.coefficientsY[0] + model.coefficientsY[1] * rawVector.x + model.coefficientsY[2] * rawVector.y,
  };
}

function solveLeastSquares(
  raw: readonly CalibrationVector3D[],
  target: readonly number[],
): Vector3Like | null {
  if (raw.length !== target.length || raw.length < MIN_REQUIRED_OBSERVATIONS) {
    return null;
  }

  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  let sumYY = 0;
  let targetSum = 0;
  let targetX = 0;
  let targetY = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const sample = raw[index];
    if (!sample || !Number.isFinite(sample.x) || !Number.isFinite(sample.y) || !Number.isFinite(sample.z)) {
      return null;
    }

    const x = sample.x;
    const y = sample.y;
    const t = target[index] ?? 0;

    if (!Number.isFinite(t)) {
      return null;
    }

    count += 1;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
    sumYY += y * y;
    targetSum += t;
    targetX += x * t;
    targetY += y * t;
  }

  const normal: Matrix3 = [
    [count, sumX, sumY],
    [sumX, sumXX, sumXY],
    [sumY, sumXY, sumYY],
  ];

  const rhs: Vector3Like = [targetSum, targetX, targetY];
  return solveLinearSystem(normal, rhs);
}

function solveLinearSystem(matrix: Matrix3, rhs: Vector3Like): Vector3Like | null {
  const augmented: [number, number, number, number][] = [
    [...matrix[0], rhs[0]],
    [...matrix[1], rhs[1]],
    [...matrix[2], rhs[2]],
  ];

  for (let pivot = 0; pivot < 3; pivot += 1) {
    let pivotRow = pivot;
    let pivotValue = Math.abs(augmented[pivot][pivot]);

    for (let row = pivot + 1; row < 3; row += 1) {
      const candidate = Math.abs(augmented[row][pivot]);
      if (candidate > pivotValue) {
        pivotValue = candidate;
        pivotRow = row;
      }
    }

    if (!Number.isFinite(pivotValue) || pivotValue <= SINGULAR_EPSILON) {
      return null;
    }

    if (pivotRow !== pivot) {
      const temp = augmented[pivot];
      augmented[pivot] = augmented[pivotRow];
      augmented[pivotRow] = temp;
    }

    const scale = augmented[pivot][pivot];
    for (let col = pivot; col < 4; col += 1) {
      augmented[pivot][col] /= scale;
    }

    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) {
        continue;
      }

      const factor = augmented[row][pivot];
      if (!Number.isFinite(factor) || factor === 0) {
        continue;
      }

      for (let col = pivot; col < 4; col += 1) {
        augmented[row][col] -= factor * augmented[pivot][col];
      }
    }
  }

  return [
    augmented[0][3],
    augmented[1][3],
    augmented[2][3],
  ];
}

function isFiniteArray(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function isFiniteVectorList(samples: readonly CalibrationVector3D[]): boolean {
  return samples.every((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.y) && Number.isFinite(sample.z));
}

function hasSufficientSpread(values: readonly number[]): boolean {
  if (values.length === 0) {
    return false;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  return Number.isFinite(min) && Number.isFinite(max) && max - min >= MIN_VARIANCE;
}
