import { multiplyMatrixVector } from "../math/matrix3";
import { add, multiplyScalar } from "../math/vector3";
import type { EyeGeometryProfile } from "../types/eye-geometry";
import { MINIMUM_FACE_SCALE } from "../constants/jeo-landmark-indices";
import type { Matrix3 } from "../types/head-coordinate-frame";

function assertPositiveScale(scale: number): void {
  if (!Number.isFinite(scale) || scale <= MINIMUM_FACE_SCALE) {
    throw new RangeError("Face scale must be finite and positive.");
  }
}

export function computeEyeSphereCenter(params: {
  readonly headCenter: { x: number; y: number; z: number };
  readonly headRotation: Matrix3;
  readonly eyeOffset: { x: number; y: number; z: number };
  readonly faceScale: number;
  readonly referenceFaceScale: number;
}): { x: number; y: number; z: number } {
  assertPositiveScale(params.referenceFaceScale);
  assertPositiveScale(params.faceScale);

  const scaleRatio = params.faceScale / params.referenceFaceScale;
  const scaledOffset = multiplyScalar(params.eyeOffset, scaleRatio);
  const worldOffset = multiplyMatrixVector(params.headRotation, scaledOffset);

  return {
    x: params.headCenter.x + worldOffset.x,
    y: params.headCenter.y + worldOffset.y,
    z: params.headCenter.z + worldOffset.z,
  };
}

export function computeEyeSpheres(
  profile: EyeGeometryProfile,
  headCenter: { x: number; y: number; z: number },
  headRotation: Matrix3,
  currentFaceScale: number,
): {
  leftEyeSphereCenter: { x: number; y: number; z: number };
  rightEyeSphereCenter: { x: number; y: number; z: number };
} {
  return {
    leftEyeSphereCenter: computeEyeSphereCenter({
      headCenter,
      headRotation,
      eyeOffset: profile.leftEyeLocalOffset,
      faceScale: currentFaceScale,
      referenceFaceScale: profile.leftReferenceFaceScale,
    }),
    rightEyeSphereCenter: computeEyeSphereCenter({
      headCenter,
      headRotation,
      eyeOffset: profile.rightEyeLocalOffset,
      faceScale: currentFaceScale,
      referenceFaceScale: profile.rightReferenceFaceScale,
    }),
  };
}
