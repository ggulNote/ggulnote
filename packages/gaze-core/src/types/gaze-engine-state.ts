import type { RawGazeObservation } from "./raw-gaze-observation";

export type RawGazeEngineStatus =
  | "idle"
  | "tracking"
  | "eye-geometry-required"
  | "error";

export type RawGazeEngineError = {
  readonly code:
    | "unsupported-landmark-layout"
    | "invalid-head-frame"
    | "invalid-eye-direction"
    | "missing-eye-geometry"
    | "tracking-lost"
    | "math-invalid"
    | "no-face";
  readonly message: string;
};

export interface RawGazeEngineState {
  readonly status: RawGazeEngineStatus;
  readonly processedFrameCount: number;
  readonly lastFrameId: number | null;
  readonly lastTrackingFrameId: number | null;
  readonly eyeGeometryInitialized: boolean;
  readonly eyeGeometryInitializedFromFrameId: number | null;
  readonly eyeGeometryInitializedAt: number | null;
  readonly lastError: RawGazeEngineError | null;
  readonly lastObservation: RawGazeObservation | null;
}
