import type { RawGazeObservation } from "@ggulnote/gaze-core";
import { describe, expect, it } from "vitest";
import { GazeTimeline, toSessionTimeMs } from "../src";

const observation = (
  sourceCapturedAt: number,
  processingCompletedAt: number,
): RawGazeObservation => ({
  frameId: 7,
  sourceCapturedAt: toSessionTimeMs(sourceCapturedAt),
  processingStartedAt: toSessionTimeMs(sourceCapturedAt + 4),
  processingCompletedAt: toSessionTimeMs(processingCompletedAt),
  leftDirection: { x: 0.1, y: -0.2, z: 0.97 },
  rightDirection: { x: 0.12, y: -0.18, z: 0.97 },
  rawCombinedDirection: { x: 0.11, y: -0.19, z: 0.97 },
  smoothedCombinedDirection: { x: 0.1, y: -0.2, z: 0.97 },
  quality: {
    faceDetected: true,
    leftEyeReady: true,
    rightEyeReady: true,
    trackingConfidence: 0.94,
  },
});

describe("GazeTimeline", () => {
  it("stores an observation at sourceCapturedAt", () => {
    const timeline = new GazeTimeline(1_000);
    const sample = timeline.append(observation(10_000, 10_032));

    expect(sample.time).toBe(10_000);
    expect(timeline.query(toSessionTimeMs(10_000), toSessionTimeMs(10_000)))
      .toEqual([sample]);
  });

  it("does not use processingCompletedAt as the Timeline time", () => {
    const timeline = new GazeTimeline(1_000);
    const sample = timeline.append(observation(10_000, 10_032));

    expect(timeline.query(toSessionTimeMs(10_032), toSessionTimeMs(10_032)))
      .toEqual([]);
    expect(sample.observation.processingCompletedAt).toBe(10_032);
  });
});
