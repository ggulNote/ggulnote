import type { NormalizedLandmark3D } from "../types/landmark-frame";
import type { Vector3 } from "../types/vector";

import { isFiniteVector } from "../math/vector3";

function ensureFinite(value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError("Landmark coordinate must be finite.");
  }
}

/**
 * JEO에서 사용되는 정규화 좌표 -> world 좌표 변환.
 * 주의: z 스케일은 frameWidth로 맞춘다.
 */
export function normalizeToWorldSpace(
  landmark: NormalizedLandmark3D,
  frameWidth: number,
  frameHeight: number,
): Vector3 {
  ensureFinite(landmark.x);
  ensureFinite(landmark.y);
  ensureFinite(landmark.z);
  ensureFinite(frameWidth);
  ensureFinite(frameHeight);

  const point: Vector3 = {
    x: landmark.x * frameWidth,
    y: landmark.y * frameHeight,
    z: landmark.z * frameWidth,
  };

  if (!isFiniteVector(point)) {
    throw new RangeError("Converted world landmark contains non-finite coordinates.");
  }

  return point;
}

export function landmarksToWorldPoints(
  landmarks: readonly NormalizedLandmark3D[],
  indices: readonly number[],
  frameWidth: number,
  frameHeight: number,
): Vector3[] {
  return indices.map((index) => normalizeToWorldSpace(landmarks[index], frameWidth, frameHeight));
}
