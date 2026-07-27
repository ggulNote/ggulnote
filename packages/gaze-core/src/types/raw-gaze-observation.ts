import type { SessionTimeMs } from "@ggulnote/shared-types";
import type { HeadCoordinateFrame } from "./head-coordinate-frame";
import type { Vector3 } from "./vector";

export interface RawGazeQuality {
  readonly faceDetected: boolean;
  readonly leftEyeReady: boolean;
  readonly rightEyeReady: boolean;
  /**
   * MediaPipe does not provide stable per-frame face-tracking confidence in this stage.
   */
  readonly trackingConfidence: number | null;
}

/**
 * One raw gaze result on the shared session timeline.
 */
export interface RawGazeObservation {
  readonly frameId: number;
  readonly sourceCapturedAt: SessionTimeMs;
  readonly processingStartedAt: SessionTimeMs;
  readonly processingCompletedAt: SessionTimeMs;

  readonly leftDirection: Vector3;
  readonly rightDirection: Vector3;
  readonly rawCombinedDirection: Vector3;
  readonly smoothedCombinedDirection: Vector3;

  readonly head: HeadCoordinateFrame;

  readonly smoothing: {
    readonly sampleCount: number;
    readonly windowStartedAt: SessionTimeMs;
    readonly windowEndedAt: SessionTimeMs;
  };

  readonly quality: RawGazeQuality;
}
