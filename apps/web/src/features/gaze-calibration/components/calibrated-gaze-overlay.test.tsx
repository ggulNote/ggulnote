import type { RawGazeObservation } from "@ggulnote/gaze-core";
import { toSessionTimeMs, type TimedGazeSample } from "@ggulnote/interaction-core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CalibratedGazeOverlay } from "./calibrated-gaze-overlay";

afterEach(cleanup);

function createObservation(): RawGazeObservation {
  return {
    frameId: 7,
    sourceCapturedAt: toSessionTimeMs(10),
    processingStartedAt: toSessionTimeMs(12),
    processingCompletedAt: toSessionTimeMs(15),
    leftDirection: { x: 1, y: 2, z: 1 },
    rightDirection: { x: 1, y: 2, z: 1 },
    rawCombinedDirection: { x: 1, y: 2, z: 1 },
    smoothedCombinedDirection: { x: 1, y: 2, z: 1 },
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

function createSample(source: "validation-residuals" | "fallback" = "validation-residuals"): TimedGazeSample {
  const confidenceRoi = {
    coverageProbability: 0.9,
    shape: "ellipse" as const,
    center: { x: 240, y: 180 },
    radiusMajor: 40,
    radiusMinor: 20,
    rotationRad: Math.PI / 4,
    axisAlignedBounds: { left: 200, top: 150, right: 280, bottom: 210 },
    covariance: { xx: 4, xy: 1, yy: 2 },
    scaleQuantile: 4.6,
    estimationMethod: "empirical-mahalanobis" as const,
    source,
    fallbackReason: source === "fallback" ? "singular-covariance" as const : undefined,
    calibrationVersion: "v2",
  };
  return {
    time: toSessionTimeMs(10),
    observation: createObservation(),
    calibratedViewportPoint: { x: 240, y: 180 },
    gazeRoi95: null,
    pdfHit: {
      isInsidePdfViewport: true,
      localPoint: { x: 140, y: 130 },
      normalizedPoint: { x: 0.35, y: 0.65 },
    },
    calibration: { profileId: "profile-b", version: "v2", quality: "valid" },
    confidenceRoi,
    calibrationData: {
      viewportPoint: { x: 240, y: 180 },
      confidenceRoi,
      pdfHit: {
        isInsidePdfViewport: true,
        localPoint: { x: 140, y: 130 },
        normalizedPoint: { x: 0.35, y: 0.65 },
      },
      calibration: {
        profileId: "profile-b",
        version: "v2",
        mode: "smooth-pursuit",
        quality: "valid",
        coverageProbability: 0.9,
        roiEstimationMethod: "empirical-mahalanobis",
        roiSource: source,
      },
    },
  };
}

describe("CalibratedGazeOverlay", () => {
  it("does not render for a missing or raw-only sample", () => {
    const { rerender } = render(<CalibratedGazeOverlay sample={null} />);
    expect(screen.queryByTestId("calibrated-gaze-overlay")).not.toBeInTheDocument();
    rerender(<CalibratedGazeOverlay sample={{ ...createSample(), calibrationData: null }} />);
    expect(screen.queryByTestId("calibrated-gaze-overlay")).not.toBeInTheDocument();
  });

  it("renders the stored calibrated point without coordinate conversion", () => {
    render(<CalibratedGazeOverlay sample={createSample()} />);
    expect(screen.getByTestId("calibrated-gaze-point")).toHaveAttribute("cx", "240");
    expect(screen.getByTestId("calibrated-gaze-point")).toHaveAttribute("cy", "180");
  });

  it("renders generic ROI radii and rotation", () => {
    render(<CalibratedGazeOverlay sample={createSample()} />);
    const roi = screen.getByTestId("calibrated-confidence-roi");
    expect(roi).toHaveAttribute("rx", "40");
    expect(roi).toHaveAttribute("ry", "20");
    expect(roi).toHaveAttribute("transform", "rotate(45 240 180)");
  });

  it("exposes coverage and profile metadata", () => {
    render(<CalibratedGazeOverlay sample={createSample()} />);
    const overlay = screen.getByTestId("calibrated-gaze-overlay");
    expect(overlay).toHaveAttribute("data-roi-coverage", "0.9");
    expect(overlay).toHaveAttribute("data-profile-id", "profile-b");
    expect(overlay).toHaveAttribute("data-profile-version", "v2");
  });

  it("distinguishes fallback ROI", () => {
    render(<CalibratedGazeOverlay sample={createSample("fallback")} />);
    expect(screen.getByTestId("calibrated-gaze-overlay")).toHaveAttribute("data-roi-source", "fallback");
    expect(screen.getByTestId("calibrated-confidence-roi")).toHaveAttribute("stroke-dasharray", "6 4");
  });

  it("never receives pointer events", () => {
    render(<CalibratedGazeOverlay sample={createSample()} />);
    expect(screen.getByTestId("calibrated-gaze-overlay")).toHaveStyle({ pointerEvents: "none" });
  });
});
