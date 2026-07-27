import type { SessionTimeMs } from "@ggulnote/shared-types";
import { EyeGeometryProfile } from "../types/eye-geometry";
import type { FaceLandmarkFrame } from "../types/landmark-frame";
import {
  JEO_FILTER_LENGTH,
  LEFT_IRIS_CENTER_INDEX,
  RIGHT_IRIS_CENTER_INDEX,
  STALE_TRACKING_RESET_MS,
} from "../constants/jeo-landmark-indices";
import { computeEyeDirection, combineDirections, isOpposingDirections } from "../jeo/eye-gaze-direction";
import { initializeEyeGeometry as initializeEyeGeometryCore } from "../jeo/eye-geometry-initializer";
import { HeadCoordinateFrameCalculator } from "../jeo/head-coordinate-frame";
import { computeEyeSpheres } from "../jeo/eye-sphere-position";
import { GazeVectorMovingAverage } from "../filters/gaze-vector-moving-average";
import { isFiniteVector, normalize } from "../math/vector3";
import {
  type RawGazeEngineErrorCode,
  type RawGazeEngineResult,
  type RawGazeEngineTiming,
  type RawGazeEngineTrackingResult,
  type RawGazeEngineNoFaceResult,
  type RawGazeEngineUnsupportedLayoutResult,
  type RawGazeEngineInvalidHeadFrameResult,
  type RawGazeEngineInvalidEyeDirectionResult,
  type RawGazeEngineMathInvalidResult,
  type RawGazeEngineEyeGeometryRequiredResult,
  type RawGazeEngineStatusResult,
} from "../types/raw-gaze-result";
import type { RawGazeObservation } from "../types/raw-gaze-observation";
import type { RawGazeEngineState, RawGazeEngineStatus } from "../types/gaze-engine-state";
import { normalizeToWorldSpace } from "../jeo/landmark-coordinate";
import type { HeadCoordinateFrame } from "../types/head-coordinate-frame";

type ProcessTiming = {
  readonly processingStartedAt: SessionTimeMs;
  readonly processingCompletedAt: SessionTimeMs;
};

const MAX_GAZE_AVERAGE_AGE_MS = 1_000;

export interface JeoRawGazeEngine {
  initializeEyeGeometry(frame: FaceLandmarkFrame): EyeGeometryProfile;
  processFrame(
    frame: FaceLandmarkFrame,
    timing: ProcessTiming,
  ): RawGazeEngineResult;
  resetEyeGeometry(): void;
  resetTrackingState(): void;
  getState(): RawGazeEngineState;
}

function asNumber(value: SessionTimeMs): number {
  return Number(value);
}

export class JeoRawGazeEngineImpl implements JeoRawGazeEngine {
  private readonly smoothing = new GazeVectorMovingAverage(JEO_FILTER_LENGTH, MAX_GAZE_AVERAGE_AGE_MS);
  private readonly headFrameCalculator = new HeadCoordinateFrameCalculator();

  private eyeGeometryProfile: EyeGeometryProfile | null = null;
  private processedFrameCount = 0;
  private lastFrameId: number | null = null;
  private lastTrackingFrameId: number | null = null;
  private lastError: { code: RawGazeEngineErrorCode; message: string } | null = null;
  private lastObservation: RawGazeObservation | null = null;
  private lastTrackingTimestampMs: SessionTimeMs | null = null;

  public initializeEyeGeometry(frame: FaceLandmarkFrame): EyeGeometryProfile {
    const headFrame = this.computeHeadFrame(frame);

    const profile = initializeEyeGeometryCore(
      frame,
      {
        center: headFrame.center,
        faceScale: headFrame.faceScale,
        rotation: headFrame.rotation,
      },
      frame.frameId,
      frame.sourceCapturedAt,
    );

    this.eyeGeometryProfile = profile;
    this.resetTrackingState();
    this.lastError = null;
    return profile;
  }

  public processFrame(frame: FaceLandmarkFrame, timing: ProcessTiming): RawGazeEngineResult {
    this.processedFrameCount += 1;
    this.lastFrameId = frame.frameId;

    const gazeWindowTiming: RawGazeEngineTiming = {
      gazeComputationDurationMs: Math.max(0, asNumber(timing.processingCompletedAt) - asNumber(timing.processingStartedAt)),
      totalWorkerDurationMs: Math.max(0, asNumber(timing.processingCompletedAt) - asNumber(timing.processingStartedAt)),
    };

    if (frame.landmarks.length === 0) {
      this.onTrackingLost(frame.sourceCapturedAt);
      return this.makeNoFace(frame, "No landmarks were detected.", gazeWindowTiming);
    }

    const requiredIndex = Math.max(LEFT_IRIS_CENTER_INDEX, RIGHT_IRIS_CENTER_INDEX);
    if (frame.landmarks.length <= requiredIndex) {
      this.onTrackingLost(frame.sourceCapturedAt);
      return this.makeUnsupportedLayout(
        frame,
        `MediaPipe returned ${frame.landmarks.length} landmarks, but iris centers require index ${requiredIndex}.`,
        gazeWindowTiming,
      );
    }

    let headFrame: HeadCoordinateFrame;
    try {
      headFrame = this.computeHeadFrame(frame);
    } catch (error) {
      this.onTrackingLost(frame.sourceCapturedAt);
      return this.makeInvalidHeadFrame(
        frame,
        error instanceof Error ? error.message : "Failed to estimate head frame.",
        gazeWindowTiming,
      );
    }

    if (!this.eyeGeometryProfile) {
      return this.makeEyeGeometryRequired(frame, "Eye geometry is not initialized.", gazeWindowTiming);
    }

    let leftIrisWorld: { x: number; y: number; z: number };
    let rightIrisWorld: { x: number; y: number; z: number };

    try {
      leftIrisWorld = normalizeToWorldSpace(frame.landmarks[LEFT_IRIS_CENTER_INDEX], frame.frameWidth, frame.frameHeight);
      rightIrisWorld = normalizeToWorldSpace(frame.landmarks[RIGHT_IRIS_CENTER_INDEX], frame.frameWidth, frame.frameHeight);
    } catch (error) {
      return this.makeMathInvalid(
        frame,
        error instanceof Error ? error.message : "Failed to convert iris coordinates.",
        gazeWindowTiming,
      );
    }

    if (!isFiniteVector(leftIrisWorld) || !isFiniteVector(rightIrisWorld)) {
      return this.makeMathInvalid(frame, "Iris coordinates are non-finite.", gazeWindowTiming);
    }

    try {
      const eyeSpheres = computeEyeSpheres(
        this.eyeGeometryProfile,
        headFrame.center,
        headFrame.rotation,
        headFrame.faceScale,
      );

      const leftDirection = computeEyeDirection(leftIrisWorld, eyeSpheres.leftEyeSphereCenter);
      const rightDirection = computeEyeDirection(rightIrisWorld, eyeSpheres.rightEyeSphereCenter);

      if (isOpposingDirections(leftDirection, rightDirection)) {
        return this.makeInvalidEyeDirection(
          frame,
          "Left and right gaze directions are opposite.",
          gazeWindowTiming,
        );
      }

      const rawCombinedDirection = combineDirections(leftDirection, rightDirection);

      if (this.lastTrackingTimestampMs !== null) {
        if (
          asNumber(frame.sourceCapturedAt) - asNumber(this.lastTrackingTimestampMs) > STALE_TRACKING_RESET_MS
        ) {
          this.smoothing.clear();
          this.lastTrackingFrameId = null;
        }
      }

      this.smoothing.append(rawCombinedDirection, frame.sourceCapturedAt);

      const averaged = this.smoothing.getAverage();
      if (!averaged) {
        return this.makeMathInvalid(frame, "No averaged direction sample available.", gazeWindowTiming);
      }

      const smoothedCombinedDirection = normalize(averaged.vector);
      if (!smoothedCombinedDirection) {
        return this.makeMathInvalid(frame, "Smoothed direction is not normalizable.", gazeWindowTiming);
      }

      const observation: RawGazeObservation = {
        frameId: frame.frameId,
        sourceCapturedAt: frame.sourceCapturedAt,
        processingStartedAt: timing.processingStartedAt,
        processingCompletedAt: timing.processingCompletedAt,
        leftDirection,
        rightDirection,
        rawCombinedDirection,
        smoothedCombinedDirection,
        head: headFrame,
        smoothing: {
          sampleCount: this.smoothing.count,
          windowStartedAt: averaged.startedAt,
          windowEndedAt: averaged.endedAt,
        },
        quality: {
          faceDetected: true,
          leftEyeReady: true,
          rightEyeReady: true,
          trackingConfidence: frame.trackingConfidence,
        },
      };

      this.lastError = null;
      this.lastTrackingFrameId = frame.frameId;
      this.lastObservation = observation;
      this.lastTrackingTimestampMs = frame.sourceCapturedAt;

      return {
        kind: "tracking",
        frameId: frame.frameId,
        sourceCapturedAt: frame.sourceCapturedAt,
        observation,
        eyeSpheres,
        timingMs: gazeWindowTiming,
      };
    } catch (error) {
      return this.makeMathInvalid(
        frame,
        error instanceof Error ? error.message : "Failed to compute raw gaze vectors.",
        gazeWindowTiming,
      );
    }
  }

  public resetEyeGeometry(): void {
    this.eyeGeometryProfile = null;
    this.resetTrackingState();
  }

  public resetTrackingState(): void {
    this.smoothing.clear();
    this.lastError = null;
    this.lastTrackingFrameId = null;
    this.lastObservation = null;
    this.lastTrackingTimestampMs = null;
  }

  public getState(): RawGazeEngineState {
    return {
      status: this.resolveStatus(),
      processedFrameCount: this.processedFrameCount,
      lastFrameId: this.lastFrameId,
      lastTrackingFrameId: this.lastTrackingFrameId,
      eyeGeometryInitialized: this.eyeGeometryProfile !== null,
      eyeGeometryInitializedFromFrameId: this.eyeGeometryProfile?.initializedFromFrameId ?? null,
      eyeGeometryInitializedAt: this.eyeGeometryProfile?.initializedAt
        ? asNumber(this.eyeGeometryProfile.initializedAt)
        : null,
      lastError: this.lastError,
      lastObservation: this.lastObservation,
    };
  }

  private computeHeadFrame(frame: FaceLandmarkFrame): HeadCoordinateFrame {
    return this.headFrameCalculator.compute(frame);
  }

  private onTrackingLost(currentTime: SessionTimeMs): void {
    if (this.lastTrackingTimestampMs === null) {
      this.lastTrackingTimestampMs = currentTime;
      this.lastTrackingFrameId = null;
      return;
    }

    if (asNumber(currentTime) - asNumber(this.lastTrackingTimestampMs) > STALE_TRACKING_RESET_MS) {
      this.smoothing.clear();
      this.lastTrackingFrameId = null;
    }
  }

  private resolveStatus(): RawGazeEngineStatus {
    if (this.lastError) {
      return "error";
    }

    if (this.lastObservation !== null) {
      return "tracking";
    }

    return this.eyeGeometryProfile ? "eye-geometry-required" : "idle";
  }

  private makeNoFace(
    frame: FaceLandmarkFrame,
    message: string,
    timingMs: RawGazeEngineTiming,
  ): RawGazeEngineNoFaceResult {
    this.lastError = { code: "no-face", message };

    return {
      kind: "no-face",
      frameId: frame.frameId,
      sourceCapturedAt: frame.sourceCapturedAt,
      code: "no-face",
      message,
      timingMs,
    };
  }

  private makeUnsupportedLayout(
    frame: FaceLandmarkFrame,
    message: string,
    timingMs: RawGazeEngineTiming,
  ): RawGazeEngineUnsupportedLayoutResult {
    this.lastError = { code: "unsupported-landmark-layout", message };

    return {
      kind: "unsupported-landmark-layout",
      frameId: frame.frameId,
      sourceCapturedAt: frame.sourceCapturedAt,
      code: "unsupported-landmark-layout",
      message,
      timingMs,
    };
  }

  private makeInvalidHeadFrame(
    frame: FaceLandmarkFrame,
    message: string,
    timingMs: RawGazeEngineTiming,
  ): RawGazeEngineInvalidHeadFrameResult {
    this.lastError = { code: "invalid-head-frame", message };

    return {
      kind: "invalid-head-frame",
      frameId: frame.frameId,
      sourceCapturedAt: frame.sourceCapturedAt,
      code: "invalid-head-frame",
      message,
      timingMs,
    };
  }

  private makeInvalidEyeDirection(
    frame: FaceLandmarkFrame,
    message: string,
    timingMs: RawGazeEngineTiming,
  ): RawGazeEngineInvalidEyeDirectionResult {
    this.lastError = { code: "invalid-eye-direction", message };

    return {
      kind: "invalid-eye-direction",
      frameId: frame.frameId,
      sourceCapturedAt: frame.sourceCapturedAt,
      code: "invalid-eye-direction",
      message,
      timingMs,
    };
  }

  private makeMathInvalid(
    frame: FaceLandmarkFrame,
    message: string,
    timingMs: RawGazeEngineTiming,
  ): RawGazeEngineMathInvalidResult {
    this.lastError = { code: "math-invalid", message };

    return {
      kind: "math-invalid",
      frameId: frame.frameId,
      sourceCapturedAt: frame.sourceCapturedAt,
      code: "math-invalid",
      message,
      timingMs,
    };
  }

  private makeEyeGeometryRequired(
    frame: FaceLandmarkFrame,
    message: string,
    timingMs: RawGazeEngineTiming,
  ): RawGazeEngineEyeGeometryRequiredResult {
    this.lastError = { code: "missing-eye-geometry", message };

    return {
      kind: "eye-geometry-required",
      frameId: frame.frameId,
      sourceCapturedAt: frame.sourceCapturedAt,
      code: "missing-eye-geometry",
      message,
      timingMs,
    };
  }

  private makeTrackingError(
    code: RawGazeEngineErrorCode,
    frame: FaceLandmarkFrame,
    message: string,
    timingMs: RawGazeEngineTiming,
  ): RawGazeEngineStatusResult {
    switch (code) {
      case "no-face":
        return this.makeNoFace(frame, message, timingMs);
      case "unsupported-landmark-layout":
        return this.makeUnsupportedLayout(frame, message, timingMs);
      case "invalid-head-frame":
        return this.makeInvalidHeadFrame(frame, message, timingMs);
      case "invalid-eye-direction":
        return this.makeInvalidEyeDirection(frame, message, timingMs);
      case "missing-eye-geometry":
        return this.makeEyeGeometryRequired(frame, message, timingMs);
      case "math-invalid":
        return this.makeMathInvalid(frame, message, timingMs);
      case "tracking-lost":
        return this.makeNoFace(frame, message, timingMs);
      default: {
        const _exhaustive: never = code;
        throw new Error(`Unsupported gaze engine error code: ${String(_exhaustive)}`);
      }
    }
  }
}
