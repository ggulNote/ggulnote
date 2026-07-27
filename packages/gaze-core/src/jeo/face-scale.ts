import { norm } from "../math/vector3";
import type { Vector3 } from "../types/vector";

/**
 * Python `compute_scale` equivalent: average pairwise distance of nose points.
 */
export function computeScale(points: readonly Vector3[]): number {
  const count = points.length;
  if (count < 2) {
    return 1;
  }

  let total = 0;
  let pairCount = 0;

  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const distance = norm({
        x: points[i].x - points[j].x,
        y: points[i].y - points[j].y,
        z: points[i].z - points[j].z,
      });
      if (Number.isFinite(distance)) {
        total += distance;
        pairCount += 1;
      }
    }
  }

  return pairCount > 0 ? total / pairCount : 1;
}
