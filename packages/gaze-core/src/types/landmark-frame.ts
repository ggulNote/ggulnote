import type { SessionTimeMs } from "@ggulnote/shared-types";

/**
 * A normalized face landmark without a MediaPipe runtime dependency.
 *
 * x and y are normalized image coordinates. z is the model-relative depth and
 * is not required to be in the 0..1 range.
 */
export interface NormalizedLandmark3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly visibility?: number;
  readonly presence?: number;
}

/**
 * Face landmarks captured from one source frame.
 */
export interface FaceLandmarkFrame {
  readonly frameId: number;
  readonly sourceCapturedAt: SessionTimeMs;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly landmarks: readonly NormalizedLandmark3D[];
  /**
   * MediaPipe Face Landmarker does not guarantee a per-frame tracking confidence in
   * the same payload used here.
   */
  readonly trackingConfidence: number | null;
}
