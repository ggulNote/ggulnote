import { describe, expect, it } from "vitest";
import { LEFT_IRIS_CENTER_INDEX, RIGHT_IRIS_CENTER_INDEX, adaptFaceLandmarkResult } from "./face-landmark-adapter";
import type { SessionTimeMs } from "@ggulnote/shared-types";

const sessionTime = (value: number): SessionTimeMs => value as SessionTimeMs;

function landmark(value: number) {
  return { x: value, y: value, z: value };
}

describe("FaceLandmark adapter", () => {
  it("returns no-face when there is no landmark", () => {
    const adapted = adaptFaceLandmarkResult({
      frameId: 1,
      sourceCapturedAt: sessionTime(1_000),
      frameWidth: 640,
      frameHeight: 480,
      rawResult: {
        landmarks: [],
        trackingConfidence: null,
      },
    });

    expect(adapted.kind).toBe("no-face");
  });

  it("converts MediaPipe landmarks and iris centers", () => {
    const landmarkCount = RIGHT_IRIS_CENTER_INDEX + 1;
    const landmarks = Array.from({ length: landmarkCount }, (_, index) => landmark(index / landmarkCount));
    landmarks[LEFT_IRIS_CENTER_INDEX] = { x: 0.11, y: 0.22, z: 0.33 };
    landmarks[RIGHT_IRIS_CENTER_INDEX] = { x: 0.44, y: 0.55, z: 0.66 };

    const adapted = adaptFaceLandmarkResult({
      frameId: 7,
      sourceCapturedAt: sessionTime(1_024),
      frameWidth: 640,
      frameHeight: 480,
      rawResult: {
        landmarks,
        trackingConfidence: null,
      },
    });

    if (adapted.kind !== "ok") {
      throw new Error("expected ok");
    }

    expect(adapted.frame.landmarks).toHaveLength(landmarkCount);
    expect(adapted.frame.leftIrisCenter).toEqual({ x: 0.11, y: 0.22, z: 0.33 });
    expect(adapted.frame.rightIrisCenter).toEqual({ x: 0.44, y: 0.55, z: 0.66 });
  });

  it("keeps tracking confidence null when MediaPipe has no reliable confidence", () => {
    const landmarks = Array.from({ length: RIGHT_IRIS_CENTER_INDEX + 1 }, (_, index) => landmark(index / 100));

    const adapted = adaptFaceLandmarkResult({
      frameId: 8,
      sourceCapturedAt: sessionTime(1_200),
      frameWidth: 640,
      frameHeight: 480,
      rawResult: {
        landmarks,
        trackingConfidence: null,
      },
    });

    if (adapted.kind !== "ok") {
      throw new Error("expected ok");
    }

    expect(adapted.frame.trackingConfidence).toBeNull();
  });

  it("rejects unsupported landmark layouts explicitly", () => {
    const landmarks = Array.from({ length: RIGHT_IRIS_CENTER_INDEX - 1 }, (_, index) => landmark(index / 100));
    const adapted = adaptFaceLandmarkResult({
      frameId: 9,
      sourceCapturedAt: sessionTime(1_200),
      frameWidth: 640,
      frameHeight: 480,
      rawResult: {
        landmarks,
        trackingConfidence: null,
      },
    });

    expect(adapted.kind).toBe("unsupported-landmark-layout");
  });
});
