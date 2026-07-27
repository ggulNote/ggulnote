import type { RawGazeObservation } from "./raw-gaze-observation";

export type RawGazeEngineStatus = "idle" | "running" | "stopped" | "error";

/**
 * Serializable state exposed by a future raw gaze engine implementation.
 */
export interface RawGazeEngineState {
  readonly status: RawGazeEngineStatus;
  readonly processedFrameCount: number;
  readonly lastObservation: RawGazeObservation | null;
  readonly errorMessage: string | null;
}
