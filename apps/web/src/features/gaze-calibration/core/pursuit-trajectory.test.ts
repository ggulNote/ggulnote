import { describe, expect, it } from "vitest";

import {
  DEFAULT_PURSUIT_CALIBRATION_CONFIG,
  type PursuitCalibrationConfig,
} from "../config/pursuit-calibration-config";
import {
  CALIBRATION_PURSUIT_TRAJECTORY,
  VALIDATION_PURSUIT_TRAJECTORY,
} from "../domain/pursuit-trajectories";
import type { CalibrationTrajectory } from "../domain/pursuit-types";
import {
  getNextDirectionVector,
  getPursuitTrajectoryState,
  getSegmentDurationMs,
  getSegmentTargetCenter,
} from "./pursuit-trajectory";

const viewportRect = {
  left: 100,
  top: 50,
  width: 1000,
  height: 500,
};

const trajectory: CalibrationTrajectory = {
  id: "test-calibration",
  role: "calibration",
  segments: [
    {
      id: "horizontal",
      role: "calibration",
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
    },
    {
      id: "vertical",
      role: "calibration",
      from: { x: 1, y: 0 },
      to: { x: 1, y: 1 },
    },
  ],
};

const config: PursuitCalibrationConfig = {
  ...DEFAULT_PURSUIT_CALIBRATION_CONFIG,
  target: {
    ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.target,
    diameterPx: 20,
    centerDotDiameterPx: 4,
    viewportInsetPx: 10,
  },
  motion: {
    ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.motion,
    speedPxPerSecond: 960,
    movementWarmupMs: 100,
    movementCooldownMs: 100,
  },
  transition: {
    initialHoldMs: 100,
    segmentStopMs: 50,
    endpointHoldMs: 100,
    directionCueMs: 100,
    settleAfterCueMs: 100,
  },
};

const firstSegment = trajectory.segments[0];
if (firstSegment === undefined) {
  throw new Error("Test trajectory requires a first segment.");
}

const firstSegmentDurationMs = getSegmentDurationMs(firstSegment, viewportRect, config);
const firstSegmentStartsAtMs = config.transition.initialHoldMs;
const firstSegmentEndsAtMs = firstSegmentStartsAtMs + firstSegmentDurationMs;

describe("pursuit trajectory", () => {
  it("resolves the segment start position", () => {
    const state = getPursuitTrajectoryState({
      trajectory,
      viewportRect,
      config,
      elapsedMs: firstSegmentStartsAtMs,
    });

    expect(state.phase).toBe("moving");
    expect(state.segmentProgress).toBe(0);
    expect(state.targetCenter).toEqual({ x: 120, y: 70 });
  });

  it("interpolates the segment midpoint", () => {
    const state = getPursuitTrajectoryState({
      trajectory,
      viewportRect,
      config,
      elapsedMs: firstSegmentStartsAtMs + firstSegmentDurationMs / 2,
    });

    expect(state.phase).toBe("moving");
    expect(state.segmentProgress).toBeCloseTo(0.5);
    expect(state.targetCenter).toEqual({ x: 600, y: 70 });
  });

  it("resolves the segment endpoint and explicit stop phase", () => {
    const state = getPursuitTrajectoryState({
      trajectory,
      viewportRect,
      config,
      elapsedMs: firstSegmentEndsAtMs,
    });

    expect(state.phase).toBe("segment-stop");
    expect(state.segmentProgress).toBe(1);
    expect(state.targetCenter).toEqual({ x: 1080, y: 70 });
  });

  it("holds the endpoint during hold, cue, and settling phases", () => {
    const stopEndsAtMs = firstSegmentEndsAtMs + config.transition.segmentStopMs;
    const holdEndsAtMs = stopEndsAtMs + config.transition.endpointHoldMs;
    const cueEndsAtMs = holdEndsAtMs + config.transition.directionCueMs;
    const samples = [
      { elapsedMs: stopEndsAtMs + 1, phase: "endpoint-hold" },
      { elapsedMs: holdEndsAtMs + 1, phase: "direction-cue" },
      { elapsedMs: cueEndsAtMs + 1, phase: "settling" },
    ] as const;

    for (const sample of samples) {
      const state = getPursuitTrajectoryState({
        trajectory,
        viewportRect,
        config,
        elapsedMs: sample.elapsedMs,
      });
      expect(state.phase).toBe(sample.phase);
      expect(state.targetCenter).toEqual({ x: 1080, y: 70 });
    }
  });

  it("marks warmup, sampling, and cooldown within movement", () => {
    const warmup = getPursuitTrajectoryState({
      trajectory,
      viewportRect,
      config,
      elapsedMs: firstSegmentStartsAtMs + 50,
    });
    const sampling = getPursuitTrajectoryState({
      trajectory,
      viewportRect,
      config,
      elapsedMs: firstSegmentStartsAtMs + 500,
    });
    const cooldown = getPursuitTrajectoryState({
      trajectory,
      viewportRect,
      config,
      elapsedMs: firstSegmentEndsAtMs - 50,
    });

    expect(warmup.movementStage).toBe("warmup");
    expect(warmup.isSampleEligible).toBe(false);
    expect(sampling.movementStage).toBe("sampling");
    expect(sampling.isSampleEligible).toBe(true);
    expect(cooldown.movementStage).toBe("cooldown");
    expect(cooldown.isSampleEligible).toBe(false);
  });

  it("returns the normalized next segment direction", () => {
    expect(getNextDirectionVector(trajectory, 0)).toEqual({ x: 0, y: 1 });
    expect(getNextDirectionVector(trajectory, 1)).toBeNull();
  });

  it("keeps target bounds inside the PDF viewport", () => {
    const state = getPursuitTrajectoryState({
      trajectory: CALIBRATION_PURSUIT_TRAJECTORY,
      viewportRect,
      config,
      elapsedMs: config.transition.initialHoldMs,
    });

    expect(state.targetBounds.left).toBeGreaterThanOrEqual(viewportRect.left);
    expect(state.targetBounds.top).toBeGreaterThanOrEqual(viewportRect.top);
    expect(state.targetBounds.right).toBeLessThanOrEqual(viewportRect.left + viewportRect.width);
    expect(state.targetBounds.bottom).toBeLessThanOrEqual(viewportRect.top + viewportRect.height);
  });

  it("recalculates viewport coordinates after a viewport resize", () => {
    const pointBeforeResize = getSegmentTargetCenter(
      firstSegment,
      0.25,
      viewportRect,
      config.target,
    );
    const pointAfterResize = getSegmentTargetCenter(
      firstSegment,
      0.25,
      { ...viewportRect, width: 2000 },
      config.target,
    );

    expect(pointBeforeResize).toEqual({ x: 360, y: 70 });
    expect(pointAfterResize).toEqual({ x: 610, y: 70 });
  });

  it("keeps calibration and validation trajectories separate", () => {
    const calibrationSegments = new Set(
      CALIBRATION_PURSUIT_TRAJECTORY.segments.map(
        (segment) => `${segment.from.x},${segment.from.y}:${segment.to.x},${segment.to.y}`,
      ),
    );
    const validationSegments = VALIDATION_PURSUIT_TRAJECTORY.segments.map(
      (segment) => `${segment.from.x},${segment.from.y}:${segment.to.x},${segment.to.y}`,
    );

    expect(CALIBRATION_PURSUIT_TRAJECTORY.role).toBe("calibration");
    expect(VALIDATION_PURSUIT_TRAJECTORY.role).toBe("validation");
    expect(CALIBRATION_PURSUIT_TRAJECTORY.id).not.toBe(VALIDATION_PURSUIT_TRAJECTORY.id);
    expect(validationSegments.every((segment) => !calibrationSegments.has(segment))).toBe(true);
  });
});
