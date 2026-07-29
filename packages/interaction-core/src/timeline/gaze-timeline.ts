import type { RawGazeObservation } from "@ggulnote/gaze-core";
import { toSessionTimeMs } from "../time/session-time";
import type { SessionTimeMs } from "../time/session-time";
import type { TimedGazeSample } from "../types/timed-gaze-sample";
import { RingBuffer } from "./ring-buffer";

/**
 * Stores gaze results at sourceCapturedAt, not at processing completion time.
 *
 * Example: a frame captured at 10,000ms and completed at 10,032ms is stored at
 * 10,000ms. processingCompletedAt is only a performance/latency measurement.
 */
export class GazeTimeline {
  private readonly buffer: RingBuffer<TimedGazeSample>;

  public constructor(retentionDurationMs: number) {
    this.buffer = new RingBuffer<TimedGazeSample>(retentionDurationMs);
  }

  public get size(): number {
    return this.buffer.size;
  }

  public append(observation: RawGazeObservation): TimedGazeSample;
  public append(sample: TimedGazeSample): TimedGazeSample;
  public append(payload: RawGazeObservation | TimedGazeSample): TimedGazeSample {
    const sample: TimedGazeSample =
      "observation" in payload && "time" in payload
        ? payload
        : {
            time: toSessionTimeMs((payload as RawGazeObservation).sourceCapturedAt),
            observation: payload as RawGazeObservation,
            calibratedViewportPoint: null,
            gazeRoi95: null,
            pdfHit: null,
            calibration: null,
            confidenceRoi: null,
            calibrationData: null,
          };

    this.buffer.append(sample);
    return sample;
  }

  public query(fromInclusive: SessionTimeMs, toInclusive: SessionTimeMs): readonly TimedGazeSample[] {
    return this.buffer.query(fromInclusive, toInclusive);
  }

  public clear(): void {
    this.buffer.clear();
  }
}
