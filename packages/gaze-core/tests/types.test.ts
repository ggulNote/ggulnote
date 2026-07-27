import type { SessionTimeMs } from "@ggulnote/shared-types";
import { describe, expect, it } from "vitest";
import type { RawGazeObservation } from "../src";

const time = (value: number): SessionTimeMs => value as SessionTimeMs;

describe("gaze-core types", () => {
  it("represent an unavailable eye without fabricating a direction", () => {
    const observation: RawGazeObservation = {
      frameId: 1,
      sourceCapturedAt: time(10_000),
      processingStartedAt: time(10_004),
      processingCompletedAt: time(10_032),
      leftDirection: null,
      rightDirection: { x: 0.1, y: -0.2, z: 0.97 },
      rawCombinedDirection: null,
      smoothedCombinedDirection: null,
      quality: {
        faceDetected: true,
        leftEyeReady: false,
        rightEyeReady: true,
        trackingConfidence: 0.75,
      },
    };

    expect(observation.leftDirection).toBeNull();
    expect(observation.quality.leftEyeReady).toBe(false);
    expect(observation.processingCompletedAt).toBe(10_032);
  });
});
