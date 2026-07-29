import type { RawGazeObservation } from "@ggulnote/gaze-core";
import {
  GazeTimeline,
  InteractionClock,
  InteractionTimeline,
  toSessionTimeMs,
  type GazeConfidenceRoi,
  type GazeTimelineCalibrationMetadata,
  type TimedGazeSample,
} from "../src";
import { describe, expect, it } from "vitest";

function observation(time: number, frameId = time): RawGazeObservation {
  const sessionTime = toSessionTimeMs(time);
  return {
    frameId,
    sourceCapturedAt: sessionTime,
    processingStartedAt: sessionTime,
    processingCompletedAt: sessionTime,
    leftDirection: { x: 0, y: 0, z: 1 },
    rightDirection: { x: 0, y: 0, z: 1 },
    rawCombinedDirection: { x: 0, y: 0, z: 1 },
    smoothedCombinedDirection: { x: 0, y: 0, z: 1 },
    head: {
      center: { x: 0, y: 0, z: 0 },
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      faceScale: 1,
    },
    smoothing: {
      sampleCount: 1,
      windowStartedAt: sessionTime,
      windowEndedAt: sessionTime,
    },
    quality: {
      faceDetected: true,
      leftEyeReady: true,
      rightEyeReady: true,
      trackingConfidence: 1,
    },
  };
}

function confidenceRoi(coverageProbability: number): GazeConfidenceRoi {
  return {
    coverageProbability,
    shape: "ellipse",
    center: { x: 100, y: 200 },
    radiusMajor: 20,
    radiusMinor: 10,
    rotationRad: 0,
    axisAlignedBounds: { left: 80, top: 190, right: 120, bottom: 210 },
    covariance: { xx: 4, xy: 0, yy: 2 },
    scaleQuantile: 4,
    estimationMethod: "empirical-mahalanobis",
    source: "validation-residuals",
    calibrationVersion: "v1",
  };
}

function calibratedSample(
  time: number,
  calibrationMetadata: GazeTimelineCalibrationMetadata,
): TimedGazeSample {
  const roi = confidenceRoi(calibrationMetadata.coverageProbability);
  const pdfHit = {
    isInsidePdfViewport: true,
    localPoint: { x: 50, y: 100 },
    normalizedPoint: { x: 0.5, y: 0.5 },
  };
  return {
    time: toSessionTimeMs(time),
    observation: observation(time),
    calibratedViewportPoint: { x: 100, y: 200 },
    gazeRoi95: null,
    pdfHit,
    calibration: {
      profileId: calibrationMetadata.profileId,
      version: calibrationMetadata.version,
      quality: calibrationMetadata.quality,
    },
    confidenceRoi: roi,
    calibrationData: {
      viewportPoint: { x: 100, y: 200 },
      confidenceRoi: roi,
      pdfHit,
      calibration: calibrationMetadata,
    },
  };
}

function metadata(
  profileId: string,
  version: string,
  mode: GazeTimelineCalibrationMetadata["mode"],
  coverageProbability = 0.9,
): GazeTimelineCalibrationMetadata {
  return {
    profileId,
    version,
    mode,
    quality: "valid",
    coverageProbability,
    roiEstimationMethod: "empirical-mahalanobis",
    roiSource: "validation-residuals",
  };
}

describe("calibrated GazeTimeline", () => {
  it("keeps the legacy raw append behavior", () => {
    const timeline = new GazeTimeline(30_000);
    const sample = timeline.append(observation(10));

    expect(sample.calibrationData).toBeNull();
    expect(sample.confidenceRoi).toBeNull();
    expect(sample.observation.frameId).toBe(10);
  });

  it("stores and queries generic calibration metadata without recalculation", () => {
    const timeline = new GazeTimeline(30_000);
    const sample = calibratedSample(10, metadata("profile-a", "v1", "smooth-pursuit", 0.99));
    timeline.append(sample);

    const queried = timeline.query(toSessionTimeMs(10), toSessionTimeMs(10));
    expect(queried).toEqual([sample]);
    expect(queried[0].calibrationData?.calibration.coverageProbability).toBe(0.99);
    expect(queried[0]).toBe(sample);
  });

  it("preserves the 30-second retention boundary", () => {
    const timeline = new GazeTimeline(30_000);
    timeline.append(observation(0, 1));
    timeline.append(calibratedSample(30_000, metadata("a", "v1", "smooth-pursuit")));
    expect(timeline.size).toBe(2);

    timeline.append(calibratedSample(30_001, metadata("b", "v2", "fixed-grid")));
    expect(timeline.query(toSessionTimeMs(0), toSessionTimeMs(30_001))).toHaveLength(2);
  });

  it("keeps profile versions and modes attached to their original samples", () => {
    const timeline = new GazeTimeline(30_000);
    const first = calibratedSample(10, metadata("a", "v1", "smooth-pursuit", 0.9));
    const second = calibratedSample(20, metadata("b", "v2", "fixed-grid", 0.95));
    timeline.append(first);
    timeline.append(second);

    const queried = timeline.query(toSessionTimeMs(0), toSessionTimeMs(30));
    expect(queried.map((entry) => entry.calibrationData?.calibration)).toMatchObject([
      { profileId: "a", version: "v1", mode: "smooth-pursuit", coverageProbability: 0.9 },
      { profileId: "b", version: "v2", mode: "fixed-grid", coverageProbability: 0.95 },
    ]);
    expect(first.calibrationData?.calibration.profileId).toBe("a");
  });

  it("mixes calibrated inside/outside and raw-only samples in one range", () => {
    const timeline = new GazeTimeline(30_000);
    const inside = calibratedSample(10, metadata("a", "v1", "smooth-pursuit"));
    const outside: TimedGazeSample = {
      ...calibratedSample(20, metadata("a", "v1", "smooth-pursuit")),
      pdfHit: {
        isInsidePdfViewport: false,
        localPoint: { x: -10, y: 100 },
        normalizedPoint: { x: -0.1, y: 0.5 },
      },
    };
    timeline.append(inside);
    timeline.append(outside);
    timeline.append(observation(30));

    const queried = timeline.query(toSessionTimeMs(0), toSessionTimeMs(30));
    expect(queried).toHaveLength(3);
    expect(queried[0].pdfHit?.isInsidePdfViewport).toBe(true);
    expect(queried[1].pdfHit?.isInsidePdfViewport).toBe(false);
    expect(queried[2].calibrationData).toBeNull();
  });

  it("supports both InteractionTimeline append overloads without losing metadata", () => {
    let now = 20;
    const clock = new InteractionClock(() => now);
    const timeline = new InteractionTimeline(clock, { gazeRetentionDurationMs: 30_000 });
    const calibrated = calibratedSample(10, metadata("a", "v1", "smooth-pursuit"));

    timeline.append(calibrated);
    now = 30;
    timeline.append(observation(20));

    const queried = timeline.queryGaze(toSessionTimeMs(0), toSessionTimeMs(30));
    expect(queried).toHaveLength(2);
    expect(queried[0].calibrationData?.calibration.profileId).toBe("a");
    expect(queried[1].calibrationData).toBeNull();
  });
});
