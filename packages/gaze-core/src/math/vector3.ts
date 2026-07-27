import type { Vector3 } from "../types/vector";

export const EPSILON = 1e-9;

export const zeroVector: Vector3 = {
  x: 0,
  y: 0,
  z: 0,
};

export const UNIT_X: Vector3 = { x: 1, y: 0, z: 0 };
export const UNIT_Y: Vector3 = { x: 0, y: 1, z: 0 };
export const UNIT_Z: Vector3 = { x: 0, y: 0, z: 1 };

export function isFiniteVector(value: Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

export function add(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

export function subtract(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

export function multiplyScalar(value: Vector3, scalar: number): Vector3 {
  return {
    x: value.x * scalar,
    y: value.y * scalar,
    z: value.z * scalar,
  };
}

export function divideScalar(value: Vector3, scalar: number): Vector3 {
  return multiplyScalar(value, 1 / scalar);
}

export function norm(value: Vector3): number {
  return Math.hypot(value.x, value.y, value.z);
}

export function norm2(value: Vector3): number {
  return value.x * value.x + value.y * value.y + value.z * value.z;
}

export function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function hasFiniteLength(value: Vector3, minimum = EPSILON): boolean {
  return isFiniteVector(value) && norm(value) > minimum;
}

export function normalize(value: Vector3): Vector3 | null {
  const length = norm(value);
  if (!Number.isFinite(length) || length <= EPSILON) {
    return null;
  }

  return divideScalar(value, length);
}

export function assertFinite(value: Vector3): void {
  if (!isFiniteVector(value)) {
    throw new RangeError("Vector contains non-finite values.");
  }
}

export function tryNormalize(value: Vector3): Vector3 {
  const normalized = normalize(value);
  if (!normalized) {
    throw new RangeError("Vector cannot be normalized due to non-finite or zero length.");
  }
  return normalized;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
