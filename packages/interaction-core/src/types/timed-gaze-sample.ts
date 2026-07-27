import type { RawGazeObservation } from "@ggulnote/gaze-core";
import type { SessionTimeMs } from "../time/session-time";

/**
 * A gaze observation positioned by source frame capture time.
 *
 * processingCompletedAt remains available on observation for latency analysis,
 * but it must never become this Timeline time.
 */
export interface TimedGazeSample {
  readonly time: SessionTimeMs;
  readonly observation: RawGazeObservation;
}
