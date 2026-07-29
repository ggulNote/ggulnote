import type { RawGazeObservation } from "@ggulnote/gaze-core";
import { InteractionClock, toSessionTimeMs } from "@ggulnote/interaction-core";
import { describe, expect, it } from "vitest";

import type { PursuitCalibrationConfig } from "../config/pursuit-calibration-config";
import type { ViewportRect } from "../domain/calibration-types";
import type {
  CalibrationTrajectory,
  ValidationTrajectory,
} from "../domain/pursuit-types";
import {
  PursuitCalibrationController,
  type PursuitCalibrationPhase,
  type PursuitCalibrationSnapshot,
  type PursuitTargetSnapshot,
} from "./pursuit-calibration-controller";

type MutableTime = { current: number };

const VIEWPORT = { left: 0, top: 0, width: 100, height: 100 } as const;
const CALIBRATION_TRAJECTORY: CalibrationTrajectory = {
  id: "controller-calibration",
  role: "calibration",
  segments: [
    {
      id: "cal-horizontal",
      role: "calibration",
      from: { x: 0.1, y: 0.2 },
      to: { x: 0.9, y: 0.2 },
    },
    {
      id: "cal-vertical",
      role: "calibration",
      from: { x: 0.9, y: 0.2 },
      to: { x: 0.9, y: 0.9 },
    },
    {
      id: "cal-diagonal",
      role: "calibration",
      from: { x: 0.9, y: 0.9 },
      to: { x: 0.2, y: 0.7 },
    },
  ],
};
const VALIDATION_TRAJECTORY: ValidationTrajectory = {
  id: "controller-validation",
  role: "validation",
  segments: [
    {
      id: "val-diagonal",
      role: "validation",
      from: { x: 0.15, y: 0.8 },
      to: { x: 0.85, y: 0.3 },
    },
    {
      id: "val-horizontal",
      role: "validation",
      from: { x: 0.85, y: 0.3 },
      to: { x: 0.2, y: 0.3 },
    },
  ],
};

const BASE_CONFIG: PursuitCalibrationConfig = {
  target: {
    diameterPx: 10,
    centerDotDiameterPx: 2,
    borderWidthPx: 1,
    viewportInsetPx: 0,
  },
  motion: {
    speedPxPerSecond: 1_000,
    samplingIntervalMs: 3,
    movementWarmupMs: 0,
    movementCooldownMs: 0,
  },
  transition: {
    initialHoldMs: 2,
    segmentStopMs: 2,
    endpointHoldMs: 2,
    directionCueMs: 2,
    settleAfterCueMs: 2,
  },
  lagAlignment: {
    mode: "fixed",
    fixedLagMs: 0,
    minimumLagMs: 0,
    maximumLagMs: 20,
    searchStepMs: 10,
    minimumCorrelation: 0,
  },
  sampleSelection: {
    minimumCalibrationSamples: 6,
    minimumValidationSamples: 6,
    spatialBinSizePx: 10,
    maximumSamplesPerSpatialBin: 100,
    trimRatio: 0,
  },
  roi: {
    coverageProbability: 0.9,
    estimationMethod: "empirical-mahalanobis",
    minimumResidualCount: 6,
    minimumRadiusPx: 0,
    maximumRadiusPx: 100,
    clampBoundsToViewport: true,
  },
};

type ControllerFixture = Readonly<{
  readonly controller: PursuitCalibrationController;
  readonly time: MutableTime;
}>;
type DriveOptions = Readonly<{
  readonly rawPoint?: (
    target: PursuitTargetSnapshot,
    timeMs: number,
    targetHistory: ReadonlyMap<string, PursuitTargetSnapshot>,
    frameId: number,
  ) => Readonly<{ x: number; y: number }> | null;
  readonly maximumTicks?: number;
}>;

function createFixture(
  config: PursuitCalibrationConfig = BASE_CONFIG,
  viewportRect: ViewportRect = VIEWPORT,
): ControllerFixture {
  const time = { current: 0 };
  let sessionCounter = 0;
  let profileCounter = 0;
  const controller = new PursuitCalibrationController({
    clock: new InteractionClock(() => time.current),
    config,
    viewportRect,
    calibrationTrajectory: CALIBRATION_TRAJECTORY,
    validationTrajectory: VALIDATION_TRAJECTORY,
    createSessionId: () => `session-${sessionCounter += 1}`,
    createProfileId: () => `profile-${profileCounter += 1}`,
    createVersion: () => "controller-test-v1",
  });
  return { controller, time };
}

function makeObservation(
  timeMs: number,
  frameId: number,
  point: Readonly<{ x: number; y: number }>,
  tracking = true,
): RawGazeObservation {
  const timestamp = toSessionTimeMs(timeMs);
  const vector = { x: point.x, y: point.y, z: 0 };
  return {
    frameId,
    sourceCapturedAt: timestamp,
    processingStartedAt: timestamp,
    processingCompletedAt: timestamp,
    leftDirection: vector,
    rightDirection: vector,
    rawCombinedDirection: vector,
    smoothedCombinedDirection: vector,
    head: {
      center: { x: 0, y: 0, z: 0 },
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      faceScale: 1,
    },
    smoothing: {
      sampleCount: 1,
      windowStartedAt: timestamp,
      windowEndedAt: timestamp,
    },
    quality: {
      faceDetected: tracking,
      leftEyeReady: tracking,
      rightEyeReady: tracking,
      trackingConfidence: tracking ? 1 : 0,
    },
  };
}

function targetKey(target: PursuitTargetSnapshot, timeMs: number): string {
  return `${target.role}:${target.segmentId}:${timeMs}`;
}

function driveToTerminal(
  fixture: ControllerFixture,
  options: DriveOptions = {},
): Readonly<{
  readonly phases: ReadonlySet<PursuitCalibrationPhase>;
  readonly snapshot: PursuitCalibrationSnapshot;
}> {
  const phases = new Set<PursuitCalibrationPhase>();
  const targetHistory = new Map<string, PursuitTargetSnapshot>();
  let frameId = 1;
  const maximumTicks = options.maximumTicks ?? 2_000;

  for (let index = 0; index < maximumTicks; index += 1) {
    const beforeTick = fixture.controller.getSnapshot();
    phases.add(beforeTick.phase);
    if (
      beforeTick.phase === "completed"
      || beforeTick.phase === "failed"
      || beforeTick.phase === "cancelled"
    ) {
      return { phases, snapshot: beforeTick };
    }
    fixture.time.current += 1;
    fixture.controller.tick();
    const snapshot = fixture.controller.getSnapshot();
    phases.add(snapshot.phase);
    const target = snapshot.currentTarget;
    if (target === null) {
      continue;
    }
    targetHistory.set(targetKey(target, fixture.time.current), target);
    if (!target.shouldCollectSample) {
      continue;
    }
    const defaultPoint = target.role === "calibration"
      ? target.center
      : {
          x: target.center.x + 3 + [-2, 2, -1, 1][frameId % 4],
          y: target.center.y - 2 + [-1, -2, 2, 1][frameId % 4],
        };
    const rawPoint = options.rawPoint?.(
      target,
      fixture.time.current,
      targetHistory,
      frameId,
    ) ?? defaultPoint;
    if (rawPoint !== null) {
      fixture.controller.pushRawGazeObservation(
        makeObservation(fixture.time.current, frameId, rawPoint),
      );
      frameId += 1;
    }
  }
  throw new Error("Pursuit controller did not reach a terminal phase.");
}

describe("PursuitCalibrationController", () => {
  it("runs every phase and creates a generic ROI profile", () => {
    const fixture = createFixture();
    expect(fixture.controller.getSnapshot().phase).toBe("idle");
    expect(fixture.controller.start().ok).toBe(true);
    expect(fixture.controller.getSnapshot().phase).toBe("preparing");

    const result = driveToTerminal(fixture);
    expect(result.snapshot.phase).toBe("completed");
    const expectedPhases: readonly PursuitCalibrationPhase[] = [
      "preparing",
      "initial-hold",
      "direction-cue",
      "settling",
      "moving",
      "segment-stop",
      "fitting",
      "validation-preparing",
      "validation-direction-cue",
      "validation-settling",
      "validation-moving",
      "validation-segment-stop",
      "validating",
      "completed",
    ];
    for (const phase of expectedPhases) {
      expect(result.phases.has(phase), `missing phase ${phase}`).toBe(true);
    }
    expect(result.snapshot.profile).toMatchObject({
      id: "profile-1",
      version: "controller-test-v1",
      mode: "smooth-pursuit",
      pursuit: {
        calibrationTrajectoryId: CALIBRATION_TRAJECTORY.id,
        validationTrajectoryId: VALIDATION_TRAJECTORY.id,
        targetDiameterPx: BASE_CONFIG.target.diameterPx,
      },
      roiTemplate: {
        coverageProbability: BASE_CONFIG.roi.coverageProbability,
        estimationMethod: "empirical-mahalanobis",
      },
    });
    expect(result.snapshot.profile?.model.biasCorrection).toBeDefined();
    expect(result.snapshot.profile?.roiTemplate.metrics.totalResidualCount)
      .toBe(result.snapshot.profile?.pursuit.validationSampleCount);
    const totalSegments = CALIBRATION_TRAJECTORY.segments.length
      + VALIDATION_TRAJECTORY.segments.length;
    expect(result.snapshot.progress).toEqual({
      completedSegments: totalSegments,
      totalSegments,
      overallRatio: 1,
    });
  });

  it("collects only stable movement and reports collector rejections", () => {
    const fixture = createFixture();
    fixture.controller.start();
    fixture.controller.tick();
    const holdTarget = fixture.controller.getSnapshot().currentTarget;
    if (holdTarget === null) {
      throw new Error("Initial hold target is missing.");
    }
    const rejected = fixture.controller.pushRawGazeObservation(
      makeObservation(fixture.time.current, 1, holdTarget.center),
    );
    expect(rejected).toEqual({
      ok: false,
      reason: "outside-collection-window",
    });

    const terminal = driveToTerminal(fixture).snapshot;
    expect(terminal.collection.calibrationAcceptedCount).toBeGreaterThanOrEqual(
      BASE_CONFIG.sampleSelection.minimumCalibrationSamples,
    );
    expect(terminal.collection.validationAcceptedCount).toBeGreaterThanOrEqual(
      BASE_CONFIG.sampleSelection.minimumValidationSamples,
    );
    expect(terminal.collection.rejectionCounts["outside-collection-window"]).toBe(1);
  });

  it("uses configured fixed lag for affine fitting and validation", () => {
    const fixture = createFixture();
    fixture.controller.start();
    const result = driveToTerminal(fixture);
    expect(result.snapshot.phase).toBe("completed");
    expect(result.snapshot.lagEstimate).toMatchObject({ lagMs: 0, source: "fixed" });
    expect(result.snapshot.profile?.pursuit.lagEstimate).toEqual(result.snapshot.lagEstimate);
    expect(result.snapshot.affineModelAvailable).toBe(true);
  });

  it("runs estimated alignment with the known configured lag", () => {
    const lagMs = 10;
    const config: PursuitCalibrationConfig = {
      ...BASE_CONFIG,
      lagAlignment: {
        mode: "estimate",
        fixedLagMs: lagMs,
        minimumLagMs: lagMs,
        maximumLagMs: lagMs,
        searchStepMs: 1,
        minimumCorrelation: 0,
      },
    };
    const fixture = createFixture(config);
    fixture.controller.start();
    const result = driveToTerminal(fixture, {
      rawPoint: (target, timeMs, history) => {
        const delayed = history.get(targetKey(target, timeMs - lagMs));
        return delayed?.center ?? null;
      },
    });
    expect(result.snapshot.phase).toBe("completed");
    expect(result.snapshot.lagEstimate).toMatchObject({ lagMs, source: "estimated" });
  });

  it("forwards Gaussian ROI config and marks fallback degraded", () => {
    const gaussianConfig: PursuitCalibrationConfig = {
      ...BASE_CONFIG,
      roi: {
        ...BASE_CONFIG.roi,
        coverageProbability: 0.99,
        estimationMethod: "gaussian-chi-square",
      },
    };
    const gaussianFixture = createFixture(gaussianConfig);
    gaussianFixture.controller.start();
    const gaussian = driveToTerminal(gaussianFixture).snapshot;
    expect(gaussian.profile?.roiTemplate).toMatchObject({
      coverageProbability: gaussianConfig.roi.coverageProbability,
      estimationMethod: "gaussian-chi-square",
    });

    const fallbackConfig: PursuitCalibrationConfig = {
      ...BASE_CONFIG,
      roi: { ...BASE_CONFIG.roi, minimumResidualCount: 1_000 },
    };
    const fallbackFixture = createFixture(fallbackConfig);
    fallbackFixture.controller.start();
    const fallback = driveToTerminal(fallbackFixture).snapshot;
    expect(fallback.profile?.roiTemplate.source).toBe("fallback");
    expect(fallback.profile?.roiTemplate.fallbackReason).toBe("insufficient-residuals");
    expect(fallback.profile?.quality).toBe("degraded");
  });

  it("fails explicitly when the affine system is singular", () => {
    const fixture = createFixture();
    fixture.controller.start();
    const result = driveToTerminal(fixture, {
      rawPoint: (target) => target.role === "calibration"
        ? { x: 1, y: 1 }
        : target.center,
    });
    expect(result.snapshot.phase).toBe("failed");
    expect(result.snapshot.error?.code).toBe("affine-fitting-failed");
  });

  it("guards cancel, dispose, subscriptions, and listener errors", () => {
    const fixture = createFixture();
    let listenerCalls = 0;
    fixture.controller.subscribe(() => {
      throw new Error("listener failure");
    });
    const unsubscribe = fixture.controller.subscribe(() => {
      listenerCalls += 1;
    });
    fixture.controller.start();
    fixture.controller.tick();
    const target = fixture.controller.getSnapshot().currentTarget;
    if (target === null) {
      throw new Error("Target is missing.");
    }

    unsubscribe();
    const callsBeforeCancel = listenerCalls;
    fixture.controller.cancel();
    const afterCancel = fixture.controller.pushRawGazeObservation(
      makeObservation(fixture.time.current, 1, target.center),
    );
    expect(afterCancel).toEqual({ ok: false, reason: "collector-inactive" });
    expect(fixture.controller.getSnapshot().phase).toBe("cancelled");
    expect(listenerCalls).toBe(callsBeforeCancel);

    const beforeDispose = fixture.controller.getSnapshot();
    fixture.controller.dispose();
    fixture.controller.tick();
    fixture.controller.cancel();
    expect(fixture.controller.start()).toMatchObject({
      ok: false,
      error: { kind: "disposed" },
    });
    expect(fixture.controller.getSnapshot()).toEqual(beforeDispose);
  });

  it("recalculates target position for movement and rejects basis changes", () => {
    const fixture = createFixture();
    fixture.controller.start();
    fixture.controller.tick();
    const before = fixture.controller.getSnapshot().currentTarget;
    if (before === null) {
      throw new Error("Target is missing.");
    }
    expect(fixture.controller.updateViewportRect({
      ...VIEWPORT,
      left: 10,
      top: 20,
    }).ok).toBe(true);
    const moved = fixture.controller.getSnapshot().currentTarget;
    expect(moved?.center.x).toBeCloseTo(before.center.x + 10);
    expect(moved?.center.y).toBeCloseTo(before.center.y + 20);

    const resized = fixture.controller.updateViewportRect({ ...VIEWPORT, width: 120 });
    expect(resized).toMatchObject({
      ok: false,
      error: { kind: "viewport-changed" },
    });
    expect(fixture.controller.getSnapshot()).toMatchObject({
      phase: "failed",
      error: { code: "viewport-changed" },
    });
  });

  it("fails invalid viewport input without starting a session", () => {
    const fixture = createFixture(BASE_CONFIG, {
      left: 0,
      top: 0,
      width: 0,
      height: 100,
    });
    expect(fixture.controller.start()).toMatchObject({
      ok: false,
      error: { kind: "invalid-viewport" },
    });
    expect(fixture.controller.getSnapshot()).toMatchObject({
      phase: "failed",
      error: { code: "invalid-viewport" },
    });
  });
});
