import type { Vector3 } from "../types/vector";

export interface VectorAggregate {
  readonly sum: Vector3;
  readonly count: number;
}

export function sumVectors(values: readonly Vector3[]): VectorAggregate {
  let x = 0;
  let y = 0;
  let z = 0;

  for (const value of values) {
    x += value.x;
    y += value.y;
    z += value.z;
  }

  return { sum: { x, y, z }, count: values.length };
}

export function meanVector(values: readonly Vector3[]): Vector3 {
  const { sum, count } = sumVectors(values);
  if (count === 0) {
    return { x: 0, y: 0, z: 0 };
  }

  const invCount = 1 / count;
  return {
    x: sum.x * invCount,
    y: sum.y * invCount,
    z: sum.z * invCount,
  };
}

export const average = meanVector;
