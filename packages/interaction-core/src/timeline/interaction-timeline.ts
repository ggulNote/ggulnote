import type { InteractionClock } from "../clock/interaction-clock";
import type { RawGazeObservation } from "@ggulnote/gaze-core";
import type { SessionTimeMs } from "../time/session-time";
import { toSessionTimeMs } from "../time/session-time";
import { GazeTimeline } from "./gaze-timeline";
import type { TimedGazeSample } from "../types/timed-gaze-sample";

export interface InteractionTimelineOptions {
  readonly gazeRetentionDurationMs: number;
}

/**
 * Owns modality-specific buffers that share one InteractionClock.
 *
 * Speech and view-state timelines can be added as separate buffers. They must
 * not be mixed with gaze samples in one union array.
 */
export class InteractionTimeline {
  public readonly gaze: GazeTimeline;

  public constructor(
    public readonly clock: InteractionClock,
    options: InteractionTimelineOptions,
  ) {
    this.gaze = new GazeTimeline(options.gazeRetentionDurationMs);
  }

  public get gazeSize(): number {
    return this.gaze.size;
  }

  public get sessionTime(): SessionTimeMs {
    return this.clock.now();
  }

  public append(observation: RawGazeObservation): TimedGazeSample {
    return this.gaze.append(observation);
  }

  public queryGaze(
    startAt: ReturnType<typeof toSessionTimeMs>,
    endAt: ReturnType<typeof toSessionTimeMs>,
  ): readonly TimedGazeSample[] {
    return this.gaze.query(startAt, endAt);
  }

  public queryRecentGaze(durationMs: number): readonly TimedGazeSample[] {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError("durationMs must be a finite non-negative number.");
    }

    const endAt = this.clock.now();
    const startAt = Math.max(0, Number(endAt) - durationMs);
    return this.gaze.query(toSessionTimeMs(startAt), endAt);
  }

  public clear(): void {
    this.gaze.clear();
  }
}
