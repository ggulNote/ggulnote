import type { RawGazeObservation } from "@ggulnote/gaze-core";
import { toSessionTimeMs, type TimedGazeSample } from "@ggulnote/interaction-core";
import { describe, expect, it } from "vitest";
import type {
  AffineCalibrationModel,
  GazeConfidenceRoiTemplate,
} from "../domain/calibration-types";
import {
  createGazeTimelineSampleTransformer,
  toPdfViewportHit,
  transformGazeTimelineSample,
  type GazeTimelineCalibrationContext,
  type GazeTimelineCalibrationProfile,
} from "./timeline-calibration-transformer";

function createObservation(rawX = 1, rawY = 2): RawGazeObservation {
  return {
    frameId: 1,
    sourceCapturedAt: toSessionTimeMs(10),
    processingStartedAt: toSessionTimeMs(12),
    processingCompletedAt: toSessionTimeMs(15),
    leftDirection: { x: rawX, y: rawY, z: 1 },
    rightDirection: { x: rawX, y: rawY, z: 1 },
    rawCombinedDirection: { x: rawX, y: rawY, z: 1 },
    smoothedCombinedDirection: { x: 99, y: 99, z: 1 },
    head: {
      center: { x: 0, y: 0, z: 0 },
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      faceScale: 1,
    },
    smoothing: {
      sampleCount: 1,
      windowStartedAt: toSessionTimeMs(10),
      windowEndedAt: toSessionTimeMs(10),
    },
    quality: {
      faceDetected: true,
      leftEyeReady: true,
      rightEyeReady: true,
      trackingConfidence: 1,
    },
  };
}

function createSample(rawX = 1, rawY = 2): TimedGazeSample {
  return {
    time: toSessionTimeMs(10),
    observation: createObservation(rawX, rawY),
    calibratedViewportPoint: null,
    gazeRoi95: null,
    pdfHit: null,
    calibration: null,
    confidenceRoi: null,
    calibrationData: null,
  };
}

function createModel(
  coefficientsX: readonly [number, number, number] = [100, 10, 2],
): AffineCalibrationModel {
  return {
    method: "affine-2d",
    coefficientsX,
    coefficientsY: [200, 3, 20],
    viewportBasis: { width: 800, height: 600 },
    biasCorrection: { x: 999, y: 999 },
    version: "model-v1",
    createdAtMs: 1,
  };
}

function createTemplate(
  coverageProbability = 0.9,
  estimationMethod: GazeConfidenceRoiTemplate["estimationMethod"] =
    "empirical-mahalanobis",
): GazeConfidenceRoiTemplate {
  return {
    coverageProbability,
    radiusMajor: coverageProbability * 100,
    radiusMinor: coverageProbability * 50,
    rotationRad: Math.PI / 6,
    covariance: { xx: 4, xy: 1, yy: 2 },
    scaleQuantile: coverageProbability * 6,
    estimationMethod,
    source: "validation-residuals",
    clampBoundsToViewport: true,
    metrics: {
      requestedCoverage: coverageProbability,
      empiricalCoverage: coverageProbability,
      coveredResidualCount: 9,
      totalResidualCount: 10,
      roiAreaPx2: Math.PI * coverageProbability * 100 * coverageProbability * 50,
      scaleQuantile: coverageProbability * 6,
      radiusMajor: coverageProbability * 100,
      radiusMinor: coverageProbability * 50,
      majorRadiusClamped: false,
      minorRadiusClamped: false,
    },
  };
}

function createSmoothProfile(
  id = "smooth-a",
  version = "smooth-v1",
  coverageProbability = 0.9,
  estimationMethod: GazeConfidenceRoiTemplate["estimationMethod"] =
    "empirical-mahalanobis",
  model = createModel(),
): GazeTimelineCalibrationProfile {
  return {
    id,
    version,
    mode: "smooth-pursuit",
    model,
    quality: "valid",
    residualDistribution: {
      bias: { x: 5, y: 7 },
      covariance: { xx: 4, xy: 1, yy: 2 },
    },
    roiTemplate: createTemplate(coverageProbability, estimationMethod),
  };
}

function createFixedProfile(): GazeTimelineCalibrationProfile {
  return {
    id: "fixed-a",
    version: "fixed-v1",
    model: createModel(),
    quality: "degraded",
    residualDistribution: {
      bias: { x: 5, y: 7 },
      covariance: { xx: 4, xy: 0, yy: 2 },
    },
    roiTemplate95: {
      radiusMajor: 30,
      radiusMinor: 15,
      rotationRad: 0,
      covariance: { xx: 4, xy: 0, yy: 2 },
      source: "fallback",
    },
  };
}

function context(
  profile: GazeTimelineCalibrationProfile | null,
  pdfViewportRect: GazeTimelineCalibrationContext["pdfViewportRect"] = null,
): GazeTimelineCalibrationContext {
  return { profile, pdfViewportRect };
}

describe("transformGazeTimelineSample", () => {
  it("keeps a raw-only sample unchanged when no profile is active", () => {
    const sample = createSample();
    const result = transformGazeTimelineSample(sample, context(null));

    expect(result).toEqual({ ok: true, kind: "raw-only", sample });
    expect(result.ok && result.sample).toBe(sample);
  });

  it("projects rawCombinedDirection and applies validation bias exactly once", () => {
    const sample = createSample();
    const result = transformGazeTimelineSample(sample, context(createSmoothProfile()));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected calibrated transform.");
    }
    expect(result.sample.calibratedViewportPoint).toEqual({ x: 109, y: 236 });
    expect(result.sample.calibrationData?.viewportPoint).toEqual({ x: 109, y: 236 });
  });

  it("combines the corrected point with the generic ROI template and metadata", () => {
    const result = transformGazeTimelineSample(
      createSample(),
      context(createSmoothProfile("profile-99", "version-99", 0.99, "gaussian-chi-square")),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected calibrated transform.");
    }
    expect(result.sample.confidenceRoi).toMatchObject({
      center: { x: 109, y: 236 },
      coverageProbability: 0.99,
      estimationMethod: "gaussian-chi-square",
      source: "validation-residuals",
      calibrationVersion: "version-99",
    });
    expect(result.sample.calibrationData?.calibration).toEqual({
      profileId: "profile-99",
      version: "version-99",
      mode: "smooth-pursuit",
      quality: "valid",
      coverageProbability: 0.99,
      roiEstimationMethod: "gaussian-chi-square",
      roiSource: "validation-residuals",
    });
    expect(result.sample.gazeRoi95).toBeNull();
  });

  it.each([0.9, 0.99])("preserves generic coverage %s", (coverageProbability) => {
    const result = transformGazeTimelineSample(
      createSample(),
      context(createSmoothProfile("smooth", "v", coverageProbability)),
    );
    expect(result.ok && result.sample.confidenceRoi?.coverageProbability)
      .toBe(coverageProbability);
  });

  it("adapts a legacy fixed-grid profile without losing its legacy ROI", () => {
    const result = transformGazeTimelineSample(
      createSample(),
      context(createFixedProfile()),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected fixed-grid transform.");
    }
    expect(result.sample.calibrationData?.calibration).toMatchObject({
      mode: "fixed-grid",
      coverageProbability: 0.95,
      roiEstimationMethod: "gaussian-chi-square",
      roiSource: "fallback",
    });
    expect(result.sample.gazeRoi95?.confidence).toBe(0.95);
  });

  it("keeps raw data on missing vectors, invalid profiles, and failed projection", () => {
    const sample = createSample();
    const observation = { ...sample.observation };
    Object.defineProperty(observation, "rawCombinedDirection", { value: undefined });
    const missing = transformGazeTimelineSample(
      { ...sample, observation },
      context(createSmoothProfile()),
    );
    const invalid = transformGazeTimelineSample(
      sample,
      context(createSmoothProfile(" ", "v")),
    );
    const failed = transformGazeTimelineSample(
      sample,
      context(createSmoothProfile(
        "profile",
        "v",
        0.9,
        "empirical-mahalanobis",
        createModel([Number.POSITIVE_INFINITY, 1, 1]),
      )),
    );

    expect(missing).toMatchObject({ ok: false, reason: "raw-vector-unavailable" });
    expect(invalid).toMatchObject({ ok: false, reason: "invalid-profile" });
    expect(failed).toMatchObject({ ok: false, reason: "projection-failed" });
    expect(missing.sample.calibrationData).toBeNull();
    expect(invalid.sample.calibrationData).toBeNull();
    expect(failed.sample.calibrationData).toBeNull();
  });

  it("does not mutate the input sample or retain a live profile reference", () => {
    const sample = createSample();
    const before = {
      calibratedViewportPoint: sample.calibratedViewportPoint,
      calibrationData: sample.calibrationData,
    };
    const result = transformGazeTimelineSample(
      sample,
      context(createSmoothProfile()),
    );

    expect(sample.calibratedViewportPoint).toBe(before.calibratedViewportPoint);
    expect(sample.calibrationData).toBe(before.calibrationData);
    expect(result.ok && result.sample).not.toBe(sample);
  });

  it("reads the active context at each sample without changing past samples", () => {
    let activeContext = context(createSmoothProfile("a", "v1"));
    const transformer = createGazeTimelineSampleTransformer({
      getCalibrationContext: () => activeContext,
    });
    const first = transformer(createSample());
    activeContext = context(createSmoothProfile("b", "v2"));
    const second = transformer(createSample());
    activeContext = context(null);
    const third = transformer(createSample());

    expect(first.calibrationData?.calibration.profileId).toBe("a");
    expect(first.calibrationData?.calibration.version).toBe("v1");
    expect(second.calibrationData?.calibration.profileId).toBe("b");
    expect(second.calibrationData?.calibration.version).toBe("v2");
    expect(third.calibrationData).toBeNull();
    expect(first.calibrationData?.calibration.profileId).toBe("a");
  });
});

describe("toPdfViewportHit", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };

  it("returns null without a valid CSS-pixel viewport rect", () => {
    expect(toPdfViewportHit({ x: 100, y: 50 }, { ...rect, width: 0 })).toBeNull();
    expect(toPdfViewportHit({ x: Number.NaN, y: 50 }, rect)).toBeNull();
  });

  it("returns local and normalized coordinates for an inside point", () => {
    expect(toPdfViewportHit({ x: 300, y: 150 }, rect)).toEqual({
      isInsidePdfViewport: true,
      localPoint: { x: 200, y: 100 },
      normalizedPoint: { x: 0.5, y: 0.5 },
    });
  });

  it("includes rect boundaries", () => {
    expect(toPdfViewportHit({ x: 100, y: 50 }, rect)?.isInsidePdfViewport).toBe(true);
    expect(toPdfViewportHit({ x: 500, y: 250 }, rect)?.isInsidePdfViewport).toBe(true);
  });

  it("preserves unclamped outside coordinates", () => {
    expect(toPdfViewportHit({ x: 50, y: 300 }, rect)).toEqual({
      isInsidePdfViewport: false,
      localPoint: { x: -50, y: 250 },
      normalizedPoint: { x: -0.125, y: 1.25 },
    });
  });

  it("stores null pdfHit without a rect and a hit with a rect", () => {
    const withoutRect = transformGazeTimelineSample(
      createSample(),
      context(createSmoothProfile()),
    );
    const withRect = transformGazeTimelineSample(
      createSample(),
      context(createSmoothProfile(), { left: 0, top: 0, width: 800, height: 600 }),
    );
    expect(withoutRect.ok && withoutRect.sample.pdfHit).toBeNull();
    expect(withRect.ok && withRect.sample.pdfHit?.isInsidePdfViewport).toBe(true);
  });
});
