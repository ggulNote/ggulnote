import type { Vector3 } from "../types/vector";
import type { Matrix3 } from "../types/head-coordinate-frame";
import { cross, dot, hasFiniteLength, normalize, subtract } from "../math/vector3";
import { axis, determinant, matrixFromColumns, withReplacedColumn } from "../math/matrix3";
import { average } from "../math/statistics";
import { computeScale } from "./face-scale";
import { landmarksToWorldPoints } from "./landmark-coordinate";
import {
  MINIMUM_FACE_SCALE,
  NOSE_LANDMARK_INDICES,
  ORIENTATION_EPSILON,
  REFERENCE_ORIENTATION_FLIP_EPSILON,
} from "../constants/jeo-landmark-indices";
import type { FaceLandmarkFrame } from "../types/landmark-frame";
import type { HeadCoordinateFrame } from "../types/head-coordinate-frame";

type AxisCandidate = { axis: Vector3; value: number };
type AxisPermutation = readonly [number, number, number];

const AXIS_PERMUTATIONS: readonly AxisPermutation[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function matrixVector(matrix: Matrix3, vector: Vector3): Vector3 {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
    y: matrix[3] * vector.x + matrix[4] * vector.y + matrix[5] * vector.z,
    z: matrix[6] * vector.x + matrix[7] * vector.y + matrix[8] * vector.z,
  };
}

function matrixToCovariance(points: readonly Vector3[]): Matrix3 {
  const n = points.length;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;

  for (const point of points) {
    xx += point.x * point.x;
    xy += point.x * point.y;
    xz += point.x * point.z;
    yy += point.y * point.y;
    yz += point.y * point.z;
    zz += point.z * point.z;
  }

  const inv = 1 / n;
  return [xx * inv, xy * inv, xz * inv, xy * inv, yy * inv, yz * inv, xz * inv, yz * inv, zz * inv];
}

function deflate(matrix: Matrix3, eigenAxis: Vector3, eigenValue: number): Matrix3 {
  return [
    matrix[0] - eigenValue * eigenAxis.x * eigenAxis.x,
    matrix[1] - eigenValue * eigenAxis.x * eigenAxis.y,
    matrix[2] - eigenValue * eigenAxis.x * eigenAxis.z,
    matrix[3] - eigenValue * eigenAxis.y * eigenAxis.x,
    matrix[4] - eigenValue * eigenAxis.y * eigenAxis.y,
    matrix[5] - eigenValue * eigenAxis.y * eigenAxis.z,
    matrix[6] - eigenValue * eigenAxis.z * eigenAxis.x,
    matrix[7] - eigenValue * eigenAxis.z * eigenAxis.y,
    matrix[8] - eigenValue * eigenAxis.z * eigenAxis.z,
  ];
}

function powerIteration(matrix: Matrix3, seed: Vector3): AxisCandidate {
  let vector = normalize(seed);
  if (!vector) {
    throw new RangeError("Power iteration seed must be non-zero.");
  }

  let eigenValue = 0;
  for (let i = 0; i < 120; i += 1) {
    const next = matrixVector(matrix, vector);
    const length = Math.hypot(next.x, next.y, next.z);
    if (!Number.isFinite(length) || length <= ORIENTATION_EPSILON) {
      break;
    }

    vector = {
      x: next.x / length,
      y: next.y / length,
      z: next.z / length,
    };

    eigenValue = dot(vector, next);
  }

  if (!hasFiniteLength(vector, ORIENTATION_EPSILON)) {
    throw new RangeError("Failed to compute valid eigen axis.");
  }

  return { axis: vector, value: eigenValue };
}

function orthogonalize(base: Vector3, target: Vector3): Vector3 {
  const projection = dot(base, target);
  const corrected = {
    x: target.x - base.x * projection,
    y: target.y - base.y * projection,
    z: target.z - base.z * projection,
  };

  const normalized = normalize(corrected);
  if (!normalized) {
    throw new RangeError("Cannot orthogonalize vectors.");
  }

  return normalized;
}

function normalizeRotation(xAxisCandidate: Vector3, yAxisCandidate: Vector3): Matrix3 {
  const xAxis = normalize(xAxisCandidate);
  if (!xAxis || !hasFiniteLength(xAxisCandidate, ORIENTATION_EPSILON)) {
    throw new RangeError("Invalid first principal axis.");
  }

  const yAxis = normalize(orthogonalize(xAxis, yAxisCandidate));
  if (!yAxis) {
    throw new RangeError("Invalid second principal axis.");
  }

  const zAxis = normalize(cross(xAxis, yAxis));
  if (!zAxis) {
    throw new RangeError("Invalid third principal axis.");
  }

  const result = matrixFromColumns(xAxis, yAxis, zAxis);
  const det = determinant(result);
  if (!Number.isFinite(det) || Math.abs(det) <= REFERENCE_ORIENTATION_FLIP_EPSILON) {
    throw new RangeError("Head coordinate frame is degenerate.");
  }

  if (det < 0) {
    return matrixFromColumns(xAxis, yAxis, {
      x: -zAxis.x,
      y: -zAxis.y,
      z: -zAxis.z,
    });
  }

  return result;
}

function applyPermutation(columns: readonly Vector3[], permutation: AxisPermutation): Matrix3 {
  return matrixFromColumns(columns[permutation[0]], columns[permutation[1]], columns[permutation[2]]);
}

function alignToReference(rotation: Matrix3, reference: Matrix3): Matrix3 {
  const columns = [axis(rotation, 0), axis(rotation, 1), axis(rotation, 2)];
  let best: Matrix3 | null = null;
  let bestScore = -Infinity;

  for (const permutation of AXIS_PERMUTATIONS) {
    let candidate = applyPermutation(columns, permutation);
    let score = 0;

    for (let column = 0; column < 3; column += 1) {
      const current = axis(candidate, column);
      const target = axis(reference, column);
      const alignment = dot(current, target);

      if (alignment < 0) {
        const flipped = {
          x: -current.x,
          y: -current.y,
          z: -current.z,
        };
        candidate = withReplacedColumn(candidate, column, flipped);
        score += -alignment;
      } else {
        score += alignment;
      }
    }

    const det = determinant(candidate);
    if (!Number.isFinite(det) || det <= REFERENCE_ORIENTATION_FLIP_EPSILON) {
      continue;
    }

    if (det < 0) {
      const zAxis = axis(candidate, 2);
      candidate = withReplacedColumn(candidate, 2, {
        x: -zAxis.x,
        y: -zAxis.y,
        z: -zAxis.z,
      });
    }

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  if (!best) {
    return alignSignOnly(rotation, reference);
  }

  return best;
}

function alignSignOnly(rotation: Matrix3, reference: Matrix3): Matrix3 {
  let stabilized = rotation;

  for (let column = 0; column < 3; column += 1) {
    const current = axis(stabilized, column);
    const previous = axis(reference, column);

    if (dot(current, previous) < 0) {
      stabilized = withReplacedColumn(stabilized, column, {
        x: -current.x,
        y: -current.y,
        z: -current.z,
      });
    }
  }

  return stabilized;
}

function stabilizeSign(rotation: Matrix3, reference: Matrix3 | null): Matrix3 {
  if (!reference) {
    return rotation;
  }

  return alignToReference(rotation, reference);
}

export function estimateHeadCoordinateFrame(frame: FaceLandmarkFrame): HeadCoordinateFrame {
  const requiredLandmarks = NOSE_LANDMARK_INDICES.at(-1) ?? 0;
  if (frame.landmarks.length <= requiredLandmarks) {
    throw new RangeError(
      `FaceLandmarkFrame has ${frame.landmarks.length} landmarks, but head frame requires at least ${requiredLandmarks + 1}.`,
    );
  }

  const nosePoints = landmarksToWorldPoints(
    frame.landmarks,
    NOSE_LANDMARK_INDICES,
    frame.frameWidth,
    frame.frameHeight,
  );

  if (nosePoints.length < 3) {
    throw new RangeError("Need at least three nose landmarks for stable axis estimation.");
  }

  const center = average(nosePoints);
  const centeredPoints = nosePoints.map((point) => subtract(point, center));
  const covariance = matrixToCovariance(centeredPoints);

  const first = powerIteration(covariance, { x: 1, y: 0, z: 0 });
  const second = powerIteration(deflate(covariance, first.axis, first.value), { x: 0, y: 1, z: 0 });
  const thirdCovariance = deflate(deflate(covariance, first.axis, first.value), second.axis, second.value);
  const third = powerIteration(thirdCovariance, { x: 0, y: 0, z: 1 });
  const thirdAxis = third.axis;

  const axes: AxisCandidate[] = [
    first,
    second,
    { axis: thirdAxis, value: third.value },
  ].sort((a, b) => b.value - a.value);

  const rotation = normalizeRotation(axes[0].axis, axes[1].axis);

  const faceScale = computeScale(nosePoints);
  if (!Number.isFinite(faceScale) || faceScale <= MINIMUM_FACE_SCALE) {
    throw new RangeError("Invalid face scale.");
  }

  return {
    center,
    rotation,
    faceScale,
  };
}

export class HeadCoordinateFrameCalculator {
  private referenceMatrix: Matrix3 | null = null;

  public reset(): void {
    this.referenceMatrix = null;
  }

  public compute(frame: FaceLandmarkFrame): HeadCoordinateFrame {
    const raw = estimateHeadCoordinateFrame(frame);
    const stabilized = stabilizeSign(raw.rotation, this.referenceMatrix);
    this.referenceMatrix = stabilized;

    return {
      center: raw.center,
      rotation: stabilized,
      faceScale: raw.faceScale,
    };
  }
}