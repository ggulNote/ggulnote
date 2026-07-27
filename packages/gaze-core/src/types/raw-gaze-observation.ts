import type { SessionTimeMs } from "@ggulnote/shared-types";
import type { Vector3 } from "./vector";

export interface RawGazeQuality {
  readonly faceDetected: boolean;
  readonly leftEyeReady: boolean;
  readonly rightEyeReady: boolean;
  /**
   * Provider confidence in the 0..1 range.
   */
  readonly trackingConfidence: number;
}

/**
 * One raw gaze result on the shared session time axis.
 *
 * sourceCapturedAt identifies when the source frame was captured.
 * processingStartedAt and processingCompletedAt are retained only for
 * performance and pipeline latency measurements.
 */
export interface RawGazeObservation {
  readonly frameId: number;
  readonly sourceCapturedAt: SessionTimeMs;
  readonly processingStartedAt: SessionTimeMs;
  readonly processingCompletedAt: SessionTimeMs;
  readonly leftDirection: Vector3 | null;
  readonly rightDirection: Vector3 | null;
  readonly rawCombinedDirection: Vector3 | null;
  readonly smoothedCombinedDirection: Vector3 | null;
  readonly quality: RawGazeQuality;
}
