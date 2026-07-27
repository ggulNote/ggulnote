import type { SessionTimeMs } from "@ggulnote/shared-types";
import type { FaceLandmarkFrame, NormalizedLandmark3D } from "@ggulnote/gaze-core";

export const LEFT_IRIS_CENTER_INDEX = 468;
export const RIGHT_IRIS_CENTER_INDEX = 473;

export type WorkerLandmark = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly visibility?: number;
  readonly presence?: number;
};

export type FaceLandmarkerRawResult = {
  readonly landmarks: readonly WorkerLandmark[];
  readonly trackingConfidence: number | null;
};

export type FaceLandmarkAdapterPayload = {
  readonly frameId: number;
  readonly sourceCapturedAt: SessionTimeMs;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly rawResult: FaceLandmarkerRawResult;
};

export type FaceLandmarkAdapterErrorCode = "unsupported-landmark-layout";

export type FaceLandmarkAdapterResult =
  | {
      readonly kind: "ok";
      readonly frame: FaceLandmarkFrame & {
        readonly leftIrisCenter: NormalizedLandmark3D;
        readonly rightIrisCenter: NormalizedLandmark3D;
      };
    }
  | { readonly kind: "no-face"; readonly frameId: number }
  | {
      readonly kind: "unsupported-landmark-layout";
      readonly code: FaceLandmarkAdapterErrorCode;
      readonly frameId: number;
      readonly detectedLandmarkCount: number;
      readonly message: string;
    };

function toNormalizedLandmark(landmark: WorkerLandmark): NormalizedLandmark3D {
  return {
    x: landmark.x,
    y: landmark.y,
    z: landmark.z,
    visibility: landmark.visibility,
    presence: landmark.presence,
  };
}

export function adaptFaceLandmarkResult(
  payload: FaceLandmarkAdapterPayload,
): FaceLandmarkAdapterResult {
  const { frameId, sourceCapturedAt, frameWidth, frameHeight, rawResult } = payload;

  if (rawResult.landmarks.length === 0) {
    return { kind: "no-face", frameId };
  }

  const minimumLandmarkCount = Math.max(LEFT_IRIS_CENTER_INDEX, RIGHT_IRIS_CENTER_INDEX) + 1;
  if (rawResult.landmarks.length < minimumLandmarkCount) {
    return {
      kind: "unsupported-landmark-layout",
      code: "unsupported-landmark-layout",
      frameId,
      detectedLandmarkCount: rawResult.landmarks.length,
      message:
        `MediaPipe returned ${rawResult.landmarks.length} landmarks, but iris centers require at least ${minimumLandmarkCount}.`,
    };
  }

  const landmarks = rawResult.landmarks.map(toNormalizedLandmark);

  return {
    kind: "ok",
    frame: {
      frameId,
      sourceCapturedAt,
      frameWidth,
      frameHeight,
      landmarks,
      trackingConfidence: rawResult.trackingConfidence,
      leftIrisCenter: toNormalizedLandmark(rawResult.landmarks[LEFT_IRIS_CENTER_INDEX]),
      rightIrisCenter: toNormalizedLandmark(rawResult.landmarks[RIGHT_IRIS_CENTER_INDEX]),
    },
  };
}
