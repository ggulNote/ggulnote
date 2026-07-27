import type { SessionTimeMs } from "@ggulnote/shared-types";
import type { RawGazeObservation } from "./raw-gaze-observation";

export type RawGazeEngineErrorCode =
  | "no-face"
  | "unsupported-landmark-layout"
  | "invalid-head-frame"
  | "invalid-eye-direction"
  | "missing-eye-geometry"
  | "tracking-lost"
  | "math-invalid";

export type RawGazeEngineError = {
  readonly code: RawGazeEngineErrorCode;
  readonly message: string;
};

export type RawGazeEngineResultKind =
  | "tracking"
  | "eye-geometry-required"
  | "no-face"
  | "unsupported-landmark-layout"
  | "invalid-head-frame"
  | "invalid-eye-direction"
  | "math-invalid";

export interface RawGazeEyeSphereState {
  readonly leftEyeSphereCenter: { readonly x: number; readonly y: number; readonly z: number };
  readonly rightEyeSphereCenter: { readonly x: number; readonly y: number; readonly z: number };
}

export interface RawGazeEngineTiming {
  readonly gazeComputationDurationMs: number;
  readonly totalWorkerDurationMs: number;
}

export interface RawGazeEngineTrackingResult {
  readonly kind: "tracking";
  readonly frameId: number;
  readonly sourceCapturedAt: SessionTimeMs;
  readonly observation: RawGazeObservation;
  readonly eyeSpheres: RawGazeEyeSphereState;
  readonly timingMs: RawGazeEngineTiming;
}

interface RawGazeEngineBaseStatusResult {
  readonly frameId: number;
  readonly sourceCapturedAt: SessionTimeMs;
  readonly message: string;
  readonly timingMs: RawGazeEngineTiming;
}

export interface RawGazeEngineNoFaceResult extends RawGazeEngineBaseStatusResult {
  readonly kind: "no-face";
  readonly code: "no-face";
}

export interface RawGazeEngineUnsupportedLayoutResult extends RawGazeEngineBaseStatusResult {
  readonly kind: "unsupported-landmark-layout";
  readonly code: "unsupported-landmark-layout";
}

export interface RawGazeEngineInvalidHeadFrameResult extends RawGazeEngineBaseStatusResult {
  readonly kind: "invalid-head-frame";
  readonly code: "invalid-head-frame";
}

export interface RawGazeEngineInvalidEyeDirectionResult extends RawGazeEngineBaseStatusResult {
  readonly kind: "invalid-eye-direction";
  readonly code: "invalid-eye-direction";
}

export interface RawGazeEngineMathInvalidResult extends RawGazeEngineBaseStatusResult {
  readonly kind: "math-invalid";
  readonly code: "math-invalid";
}

export interface RawGazeEngineEyeGeometryRequiredResult extends RawGazeEngineBaseStatusResult {
  readonly kind: "eye-geometry-required";
  readonly code: "missing-eye-geometry";
}

export interface RawGazeEngineTrackingLostResult extends RawGazeEngineBaseStatusResult {
  readonly kind: "no-face";
  readonly code: "tracking-lost";
}

export type RawGazeEngineStatusResult =
  | RawGazeEngineNoFaceResult
  | RawGazeEngineUnsupportedLayoutResult
  | RawGazeEngineInvalidHeadFrameResult
  | RawGazeEngineInvalidEyeDirectionResult
  | RawGazeEngineMathInvalidResult
  | RawGazeEngineEyeGeometryRequiredResult;

export type RawGazeEngineResult =
  | RawGazeEngineTrackingResult
  | RawGazeEngineStatusResult;
