import type { InteractionClock } from "../clock/interaction-clock";
import { GazeTimeline } from "./gaze-timeline";

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

  public clear(): void {
    this.gaze.clear();
  }
}
