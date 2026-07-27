import { JEO_BASE_EYE_SPHERE_RADIUS } from "../constants/jeo-landmark-indices";
import { LEFT_IRIS_CENTER_INDEX, RIGHT_IRIS_CENTER_INDEX } from "../constants/jeo-landmark-indices";
import { hasFiniteLength, multiplyScalar, subtract } from "../math/vector3";
import { normalizeToWorldSpace } from "./landmark-coordinate";
import type { EyeGeometryProfile } from "../types/eye-geometry";
import type { FaceLandmarkFrame } from "../types/landmark-frame";
import { ORIENTATION_EPSILON } from "../constants/jeo-landmark-indices";
import type { SessionTimeMs } from "@ggulnote/shared-types";
import type { Vector3 } from "../types/vector";

function irisPoint(frame: FaceLandmarkFrame, index: number): Vector3 {
  if (index >= frame.landmarks.length) {
    throw new RangeError(`Expected landmark ${index}, but only ${frame.landmarks.length} were provided.`);
  }

  return normalizeToWorldSpace(frame.landmarks[index], frame.frameWidth, frame.frameHeight);
}

function multiplyByTranspose(rotation: readonly number[], vector: Vector3): Vector3 {
  return {
    x: rotation[0] * vector.x + rotation[3] * vector.y + rotation[6] * vector.z,
    y: rotation[1] * vector.x + rotation[4] * vector.y + rotation[7] * vector.z,
    z: rotation[2] * vector.x + rotation[5] * vector.y + rotation[8] * vector.z,
  };
}

function cameraDirectionLocal(rotation: readonly number[]): Vector3 {
  const cameraWorld = { x: 0, y: 0, z: 1 };
  const cameraLocal = multiplyByTranspose(rotation, cameraWorld);
  const norm = Math.hypot(cameraLocal.x, cameraLocal.y, cameraLocal.z);
  if (!Number.isFinite(norm) || norm <= ORIENTATION_EPSILON) {
    throw new RangeError("Invalid head rotation for camera direction conversion.");
  }

  return {
    x: cameraLocal.x / norm,
    y: cameraLocal.y / norm,
    z: cameraLocal.z / norm,
  };
}

export function initializeEyeGeometry(
  frame: FaceLandmarkFrame,
  headFrame: {
    readonly center: { x: number; y: number; z: number };
    readonly faceScale: number;
    readonly rotation: readonly number[];
  },
  sourceFrameId: number,
  initializedAt: SessionTimeMs,
): EyeGeometryProfile {
  const leftIris = irisPoint(frame, LEFT_IRIS_CENTER_INDEX);
  const rightIris = irisPoint(frame, RIGHT_IRIS_CENTER_INDEX);

  const leftWorldOffset = subtract(leftIris, headFrame.center);
  const rightWorldOffset = subtract(rightIris, headFrame.center);

  const leftLocalOffset = multiplyByTranspose(headFrame.rotation, leftWorldOffset);
  const rightLocalOffset = multiplyByTranspose(headFrame.rotation, rightWorldOffset);

  const cameraLocal = cameraDirectionLocal(headFrame.rotation);
  const localForward = multiplyScalar(cameraLocal, JEO_BASE_EYE_SPHERE_RADIUS);

  if (!hasFiniteLength(localForward, ORIENTATION_EPSILON)) {
    throw new RangeError("Camera-local forward vector is invalid.");
  }

  return {
    leftEyeLocalOffset: {
      x: leftLocalOffset.x + localForward.x,
      y: leftLocalOffset.y + localForward.y,
      z: leftLocalOffset.z + localForward.z,
    },
    rightEyeLocalOffset: {
      x: rightLocalOffset.x + localForward.x,
      y: rightLocalOffset.y + localForward.y,
      z: rightLocalOffset.z + localForward.z,
    },
    leftReferenceFaceScale: headFrame.faceScale,
    rightReferenceFaceScale: headFrame.faceScale,
    baseEyeSphereRadius: JEO_BASE_EYE_SPHERE_RADIUS,
    initializedFromFrameId: sourceFrameId,
    initializedAt,
  };
}
