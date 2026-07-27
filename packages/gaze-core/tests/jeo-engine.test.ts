import { describe, expect, it } from "vitest";
import type { FaceLandmarkFrame } from "../src/types/landmark-frame";
import type { SessionTimeMs } from "@ggulnote/shared-types";
import { JeoRawGazeEngineImpl, JEO_FILTER_LENGTH, LEFT_IRIS_CENTER_INDEX, RIGHT_IRIS_CENTER_INDEX, NOSE_LANDMARK_INDICES } from "../src";
import { GazeVectorMovingAverage } from "../src/filters/gaze-vector-moving-average";
import { computeEyeDirection, combineDirections, isOpposingDirections } from "../src/jeo/eye-gaze-direction";
import { estimateHeadCoordinateFrame } from "../src/jeo/head-coordinate-frame";
import { hasFiniteLength, norm, normalize } from "../src/math/vector3";
import type { Vector3 } from "../src/types/vector";

const time = (value: number): SessionTimeMs => value as SessionTimeMs;

function buildLandmarks(size: number): FaceLandmarkFrame["landmarks"] {
  const landmarks = Array.from({ length: size }, (_, index) => ({
    x: ((index * 37) % 97) / 100,
    y: ((index * 23) % 89) / 100,
    z: (((index * 41) % 100) - 50) / 200,
  }));

  for (let i = 0; i < NOSE_LANDMARK_INDICES.length; i += 1) {
    const idx = NOSE_LANDMARK_INDICES[i];
    landmarks[idx] = {
      x: 0.42 + (i % 6) * 0.004,
      y: 0.45 + Math.floor(i / 6) * 0.004,
      z: (i % 4) * 0.001,
    };
  }

  landmarks[LEFT_IRIS_CENTER_INDEX] = {
    x: 0.34,
    y: 0.42,
    z: 0.01,
  };

  landmarks[RIGHT_IRIS_CENTER_INDEX] = {
    x: 0.66,
    y: 0.42,
    z: 0.01,
  };

  return landmarks;
}

function makeFaceFrame(frameId: number, sourceAt: number): FaceLandmarkFrame {
  return {
    frameId,
    sourceCapturedAt: time(sourceAt),
    frameWidth: 640,
    frameHeight: 480,
    landmarks: buildLandmarks(500),
    trackingConfidence: null,
  };
}

describe("gaze-core math", () => {
  it("normalizes vectors and rejects zero vectors", () => {
    expect(normalize({ x: 3, y: 4, z: 0 })?.x).toBeCloseTo(0.6);
    expect(normalize({ x: 3, y: 4, z: 0 })?.y).toBeCloseTo(0.8);
    expect(normalize({ x: 0, y: 0, z: 0 })).toBeNull();
  });

  it("checks finite length and vector directions", () => {
    const a: Vector3 = { x: 1, y: 0, z: 0 };
    const b: Vector3 = { x: 0, y: 1, z: 0 };
    const cross = {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };

    expect(cross).toEqual({ x: 0, y: 0, z: 1 });
    expect(hasFiniteLength(cross)).toBe(true);
    expect(norm(cross)).toBeCloseTo(1);
  });

  it("computes head frame from nose landmarks and keeps orthonormal rotation", () => {
    const frame = makeFaceFrame(1, 1000);
    const headFrame = estimateHeadCoordinateFrame(frame);

    expect(headFrame.center.x).toBeGreaterThan(0);
    expect(headFrame.faceScale).toBeGreaterThan(0);
    expect(Number.isFinite(headFrame.faceScale)).toBe(true);
    expect(headFrame.rotation.length).toBe(9);
    expect(
      Math.abs(
        headFrame.rotation[0] * headFrame.rotation[0] +
          headFrame.rotation[3] * headFrame.rotation[3] +
          headFrame.rotation[6] * headFrame.rotation[6] -
          1,
      ),
    ).toBeLessThan(1e-3);
  });

  it("combines opposite gaze directions as invalid", () => {
    const left = { x: 0, y: 0, z: 1 };
    const right = { x: 0, y: 0, z: -1 };
    expect(isOpposingDirections(left, right)).toBe(true);
    expect(() => combineDirections(left, right)).toThrow();
  });
});

describe("GazeVectorMovingAverage", () => {
  it("keeps fixed window size and prunes by age", () => {
    const avg = new GazeVectorMovingAverage(3, 1_000);
    avg.append({ x: 1, y: 0, z: 0 }, time(0));
    avg.append({ x: 0, y: 1, z: 0 }, time(100));
    avg.append({ x: 0, y: 0, z: 1 }, time(200));
    avg.append({ x: 1, y: 1, z: 0 }, time(300));

    expect(avg.count).toBe(3);

    expect(avg.getAverage()?.vector).toBeDefined();
    avg.prune(time(2_000));
    expect(avg.count).toBe(0);
  });
});

describe("JeoRawGazeEngine", () => {
  it("returns eye-geometry-required before initialize and tracking after initialize", () => {
    const engine = new JeoRawGazeEngineImpl();
    const frame = makeFaceFrame(1, 1_000);

    const first = engine.processFrame(frame, {
      processingStartedAt: time(1_010),
      processingCompletedAt: time(1_020),
    });

    expect(first.kind).toBe("eye-geometry-required");

    const profile = engine.initializeEyeGeometry(frame);
    expect(profile.leftEyeLocalOffset.x).not.toBe(0);
    expect(profile.rightEyeLocalOffset.x).not.toBe(0);

    const second = engine.processFrame(frame, {
      processingStartedAt: time(1_030),
      processingCompletedAt: time(1_040),
    });

    expect(second.kind).toBe("tracking");
    if (second.kind === "tracking") {
      expect(norm(second.observation.leftDirection)).toBeCloseTo(1);
      expect(norm(second.observation.rawCombinedDirection)).toBeCloseTo(1);
    }
  });

  it("returns explicit errors for unsupported landmark layout and clear no-face", () => {
    const engine = new JeoRawGazeEngineImpl();
    const unsupported = makeFaceFrame(2, 2_000);
    unsupported.landmarks = unsupported.landmarks.slice(0, RIGHT_IRIS_CENTER_INDEX);

    const short = engine.processFrame(unsupported, {
      processingStartedAt: time(2_010),
      processingCompletedAt: time(2_020),
    });
    expect(short.kind).toBe("unsupported-landmark-layout");

    const noFace = engine.processFrame({
      ...makeFaceFrame(3, 2_100),
      landmarks: [],
    }, {
      processingStartedAt: time(2_110),
      processingCompletedAt: time(2_120),
    });

    expect(noFace.kind).toBe("no-face");
    const trackedAfterLoss = engine.processFrame(makeFaceFrame(4, 2_700), {
      processingStartedAt: time(2_710),
      processingCompletedAt: time(2_720),
    });
    expect(trackedAfterLoss.kind).toBe("eye-geometry-required");
  });

  it("resets smoothing buffer on eye-geometry reset", () => {
    const engine = new JeoRawGazeEngineImpl();
    const frame = makeFaceFrame(10, 10_000);

    engine.initializeEyeGeometry(frame);
    const r1 = engine.processFrame(frame, {
      processingStartedAt: time(10_010),
      processingCompletedAt: time(10_020),
    });
    expect(r1.kind).toBe("tracking");

    if (r1.kind !== "tracking") {
      throw new Error("expected tracking");
    }
    expect(r1.observation.smoothing.sampleCount).toBeGreaterThan(0);

    engine.resetTrackingState();
    const state = engine.getState();
    expect(state.processedFrameCount).toBeGreaterThan(0);

    const r2 = engine.processFrame(frame, {
      processingStartedAt: time(10_030),
      processingCompletedAt: time(10_040),
    });

    expect(r2.kind).toBe("tracking");
    if (r2.kind === "tracking") {
      expect(r2.observation.smoothing.sampleCount).toBe(1);
    }
  });

  it("can compute gaze directions with non-zero norm", () => {
    const irisVector = {
      a: { x: 1, y: 0, z: 0 },
      b: { x: 0, y: 1, z: 0 },
    };
    expect(computeEyeDirection({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: 0 });

    const combined = combineDirections(irisVector.a, irisVector.b);
    expect(combined.x).toBeCloseTo(0.70710678);
    expect(combined.y).toBeCloseTo(0.70710678);
    expect(combined.z).toBeCloseTo(0);
    expect(isFinite(combined.x)).toBe(true);
    expect(norm(combined)).toBeCloseTo(1);
  });
});

describe("JeoRawGazeEngine filter window length", () => {
  it("uses configured smoothing window", () => {
    expect(JEO_FILTER_LENGTH).toBeGreaterThan(0);
  });
});
