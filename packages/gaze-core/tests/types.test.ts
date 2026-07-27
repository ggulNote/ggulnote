import type { SessionTimeMs } from "@ggulnote/shared-types";
import { describe, expect, it } from "vitest";
import type { RawGazeObservation } from "../src";
import { norm } from "../src/math/vector3";

const time = (value: number): SessionTimeMs => value as SessionTimeMs;

function normalize(value: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const length = norm(value);
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
  };
}

describe("gaze-core types", () => {
  it("represents a normalized raw gaze observation", () => {
    const leftDirection = normalize({ x: 0.1, y: -0.2, z: 0.9759 });
    const rightDirection = normalize({ x: -0.1, y: 0.2, z: 0.9759 });
    const rawCombined = normalize({ x: 0, y: 0, z: 1 });
    const smoothedCombined = normalize({ x: 0, y: 0, z: 1 });

    const observation: RawGazeObservation = {
      frameId: 1,
      sourceCapturedAt: time(10_000),
      processingStartedAt: time(10_004),
      processingCompletedAt: time(10_032),
      leftDirection,
      rightDirection,
      rawCombinedDirection: rawCombined,
      smoothedCombinedDirection: smoothedCombined,
      head: {
        center: { x: 0, y: 0, z: 1 },
        rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        faceScale: 1,
      },
      smoothing: {
        sampleCount: 1,
        windowStartedAt: time(10_000),
        windowEndedAt: time(10_032),
      },
      quality: {
        faceDetected: true,
        leftEyeReady: true,
        rightEyeReady: true,
        trackingConfidence: null,
      },
    };

    expect(norm(observation.leftDirection)).toBeCloseTo(1, 8);
    expect(norm(observation.rightDirection)).toBeCloseTo(1, 8);
    expect(norm(observation.smoothedCombinedDirection)).toBeCloseTo(1, 8);
    expect(observation.processingCompletedAt).toBe(10_032);
  });
});
