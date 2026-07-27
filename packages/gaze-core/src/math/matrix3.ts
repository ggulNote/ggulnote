import type { Matrix3 } from "../types/head-coordinate-frame";
import type { Vector3 } from "../types/vector";
import { dot, norm } from "./vector3";

export function isFiniteMatrix(matrix: Matrix3): boolean {
  return matrix.every((value) => Number.isFinite(value));
}

export function identityMatrix(): Matrix3 {
  return [
    1,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    1,
  ];
}

export function transpose(matrix: Matrix3): Matrix3 {
  return [
    matrix[0],
    matrix[3],
    matrix[6],
    matrix[1],
    matrix[4],
    matrix[7],
    matrix[2],
    matrix[5],
    matrix[8],
  ];
}

export function determinant(matrix: Matrix3): number {
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22] = matrix;
  return (
    a00 * (a11 * a22 - a12 * a21)
    - a01 * (a10 * a22 - a12 * a20)
    + a02 * (a10 * a21 - a11 * a20)
  );
}

export function isRightHanded(matrix: Matrix3): boolean {
  return determinant(matrix) > 0;
}

export function multiplyMatrixVector(matrix: Matrix3, vector: Vector3): Vector3 {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
    y: matrix[3] * vector.x + matrix[4] * vector.y + matrix[5] * vector.z,
    z: matrix[6] * vector.x + matrix[7] * vector.y + matrix[8] * vector.z,
  };
}

export function multiplyMatrices(a: Matrix3, b: Matrix3): Matrix3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],

    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],

    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export function subtract(a: Matrix3, b: Matrix3): Matrix3 {
  return [
    a[0] - b[0],
    a[1] - b[1],
    a[2] - b[2],
    a[3] - b[3],
    a[4] - b[4],
    a[5] - b[5],
    a[6] - b[6],
    a[7] - b[7],
    a[8] - b[8],
  ];
}

export function scale(matrix: Matrix3, scalar: number): Matrix3 {
  return [
    matrix[0] * scalar,
    matrix[1] * scalar,
    matrix[2] * scalar,
    matrix[3] * scalar,
    matrix[4] * scalar,
    matrix[5] * scalar,
    matrix[6] * scalar,
    matrix[7] * scalar,
    matrix[8] * scalar,
  ];
}

export function axis(matrix: Matrix3, columnIndex: number): Vector3 {
  return {
    x: matrix[columnIndex],
    y: matrix[3 + columnIndex],
    z: matrix[6 + columnIndex],
  };
}

export function withReplacedColumn(matrix: Matrix3, columnIndex: number, vector: Vector3): Matrix3 {
  return [
    columnIndex === 0 ? vector.x : matrix[0],
    columnIndex === 1 ? vector.x : matrix[1],
    columnIndex === 2 ? vector.x : matrix[2],

    columnIndex === 0 ? vector.y : matrix[3],
    columnIndex === 1 ? vector.y : matrix[4],
    columnIndex === 2 ? vector.y : matrix[5],

    columnIndex === 0 ? vector.z : matrix[6],
    columnIndex === 1 ? vector.z : matrix[7],
    columnIndex === 2 ? vector.z : matrix[8],
  ];
}

export function matrixFromColumns(xAxis: Vector3, yAxis: Vector3, zAxis: Vector3): Matrix3 {
  return [
    xAxis.x,
    yAxis.x,
    zAxis.x,

    xAxis.y,
    yAxis.y,
    zAxis.y,

    xAxis.z,
    yAxis.z,
    zAxis.z,
  ];
}

export function hasOrthonormalAxes(matrix: Matrix3, tolerance = 1e-6): boolean {
  const x = axis(matrix, 0);
  const y = axis(matrix, 1);
  const z = axis(matrix, 2);

  const xLen = norm(x);
  const yLen = norm(y);
  const zLen = norm(z);

  if (
    Math.abs(xLen - 1) > 1e-4
    || Math.abs(yLen - 1) > 1e-4
    || Math.abs(zLen - 1) > 1e-4
  ) {
    return false;
  }

  const xy = dot(x, y);
  const yz = dot(y, z);
  const zx = dot(z, x);
  return Math.abs(xy) <= tolerance && Math.abs(yz) <= tolerance && Math.abs(zx) <= tolerance;
}
