import { InteractionClock, toSessionTimeMs } from "@ggulnote/interaction-core";
import { describe, expect, it } from "vitest";

import type {
  CalibrationRawSample,
  CalibrationTarget,
  CalibrationTargetSet,
  RawGazeVector,
  ViewportPoint,
} from "../domain/calibration-types";
import { generateCalibrationTargets } from "../domain/calibration-targets";
import { CalibrationSessionController } from "./calibration-session-controller";

type MutableCounter = { current: number };

const viewportRect = { left: 0, top: 0, width: 1000, height: 1000 };

function createRawGazeSample(input: {
  sampleAtMs: number;
  rawVector: RawGazeVector;
  sequenceId: number;
  sessionId: number;
  targetId: string;
}): CalibrationRawSample {
  return {
    targetId: input.targetId,
    sessionId: input.sessionId,
    timestampMs: toSessionTimeMs(input.sampleAtMs),
    rawVector: input.rawVector,
    smoothedVector: input.rawVector,
    sequenceId: input.sequenceId,
    trackingQuality: 1,
  };
}

function rawFromPoint(point: ViewportPoint, offsetX = 0, offsetY = 0): RawGazeVector {
  return {
    x: point.x + offsetX,
    y: point.y + offsetY,
    z: 0,
  };
}

function advanceToCollectingWindow(
  controller: CalibrationSessionController,
  time: MutableCounter,
  maxTicks = 64,
): void {
  for (let index = 0; index < maxTicks; index += 1) {
    const state = controller.state;
    if (
      (state.phase === "collecting" || state.phase === "validating")
      && state.collectingWindowStartMs !== null
      && state.collectingWindowEndMs !== null
    ) {
      return;
    }

    if (state.phase === "failed") {
      throw new Error(state.error?.message ?? "Calibration failed before collecting.");
    }

    time.current += 1;
    controller.tick();
  }

  throw new Error("Timed out waiting for a collecting window.");
}

function collectActiveTargetSample(
  controller: CalibrationSessionController,
  time: MutableCounter,
  sequenceId: MutableCounter,
  getRawVector: (target: CalibrationTarget, index: number) => RawGazeVector,
): CalibrationTarget {
  advanceToCollectingWindow(controller, time);

  const state = controller.state;
  const activeTarget = state.activeTarget;
  if (activeTarget === null || state.sessionId === null) {
    throw new Error("Session or active target is missing while collecting.");
  }

  controller.submitRawGazeSample(createRawGazeSample({
    sampleAtMs: time.current,
    rawVector: getRawVector(activeTarget, sequenceId.current),
    sequenceId: sequenceId.current,
    sessionId: state.sessionId,
    targetId: activeTarget.id,
  }));
  sequenceId.current += 1;

  time.current += 2;
  controller.tick();
  return activeTarget;
}

function createController(overrides?: {
  collectionConfig?: { minimumSamplesPerTarget?: number; trimRatio?: number };
  timingConfig?: {
    prepareDurationMs?: number;
    settleDurationMs?: number;
    collectDurationMs?: number;
    transitionDurationMs?: number;
  };
}): {
  controller: CalibrationSessionController;
  clockTime: MutableCounter;
  targetSet: CalibrationTargetSet;
} {
  const clockTime = { current: 0 };
  const clock = new InteractionClock(() => clockTime.current);
  const controller = new CalibrationSessionController({
    clock,
    collectionConfig: {
      minimumSamplesPerTarget: 1,
      trimRatio: 0,
      ...overrides?.collectionConfig,
    },
    timingConfig: {
      prepareDurationMs: 1,
      settleDurationMs: 1,
      collectDurationMs: 1,
      transitionDurationMs: 1,
      ...overrides?.timingConfig,
    },
  });

  const targetSetResult = generateCalibrationTargets({
    viewportRect,
    rows: 3,
    columns: 3,
    edgeInsetRatio: 0.07,
  });
  if (!targetSetResult.ok) {
    throw new Error(targetSetResult.error.message);
  }

  return {
    controller,
    clockTime,
    targetSet: targetSetResult.value,
  };
}

function submitForCurrentTarget(
  controller: CalibrationSessionController,
  time: MutableCounter,
  sequenceId: number,
  overrides: Partial<Pick<CalibrationRawSample, "sessionId" | "targetId" | "timestampMs">> = {},
): CalibrationTarget {
  advanceToCollectingWindow(controller, time);
  const state = controller.state;
  if (state.activeTarget === null || state.sessionId === null) {
    throw new Error("Session or target is missing.");
  }

  controller.submitRawGazeSample(createRawGazeSample({
    sampleAtMs: overrides.timestampMs === undefined ? time.current : Number(overrides.timestampMs),
    rawVector: rawFromPoint(state.activeTarget.viewportPoint),
    sequenceId,
    sessionId: overrides.sessionId ?? state.sessionId,
    targetId: overrides.targetId ?? state.activeTarget.id,
  }));
  return state.activeTarget;
}

describe("CalibrationSessionController", () => {
  it("completes calibration, validation, bias correction, and ROI profile creation", () => {
    const { controller, clockTime, targetSet } = createController();
    const sequenceId = { current: 1 };

    controller.start(viewportRect);

    for (const target of targetSet.calibrationTargets) {
      collectActiveTargetSample(
        controller,
        clockTime,
        sequenceId,
        (activeTarget) => rawFromPoint(activeTarget.viewportPoint),
      );
      expect(target.role).toBe("calibration");
    }

    const validationOffsets = [
      [2, -2],
      [2, 2],
      [-2, -2],
      [-2, 2],
    ] as const;

    for (let index = 0; index < targetSet.validationTargets.length; index += 1) {
      collectActiveTargetSample(
        controller,
        clockTime,
        sequenceId,
        (target) => rawFromPoint(
          target.viewportPoint,
          validationOffsets[index]?.[0] ?? 0,
          validationOffsets[index]?.[1] ?? 0,
        ),
      );
    }

    for (let index = 0; index < 32; index += 1) {
      const phase = controller.state.phase;
      if (phase === "completed" || phase === "failed") {
        break;
      }

      clockTime.current += 1;
      controller.tick();
    }

    const state = controller.state;
    expect(state.phase).toBe("completed");
    expect(state.activeProfile).not.toBeNull();
    expect(state.activeProfile?.model.biasCorrection).toBeDefined();
    expect(state.activeProfile?.roiTemplate95.radiusMajor).toBeGreaterThan(0);
    expect(state.validationMetrics?.sampleCount).toBe(targetSet.validationTargets.length);
    expect(state.activeProfileQuality === "valid" || state.activeProfileQuality === "degraded").toBe(true);
  });

  it("rejects samples from another session", () => {
    const { controller, clockTime } = createController();
    controller.start(viewportRect);

    const target = submitForCurrentTarget(controller, clockTime, 1, {
      sessionId: (controller.state.sessionId ?? 0) + 1,
    });

    expect(controller.state.collectedTargetSampleCount.get(target.id) ?? 0).toBe(0);
    expect(controller.state.excludedSampleCountByReason.get("session-mismatch")).toBe(1);
  });

  it("rejects samples tagged for the previous target", () => {
    const { controller, clockTime } = createController();
    const sequenceId = { current: 1 };
    controller.start(viewportRect);

    const previousTarget = collectActiveTargetSample(
      controller,
      clockTime,
      sequenceId,
      (target) => rawFromPoint(target.viewportPoint),
    );
    advanceToCollectingWindow(controller, clockTime);

    const activeTarget = controller.state.activeTarget;
    const sessionId = controller.state.sessionId;
    if (activeTarget === null || sessionId === null) {
      throw new Error("Next target was not activated.");
    }

    controller.submitRawGazeSample(createRawGazeSample({
      sampleAtMs: clockTime.current,
      rawVector: rawFromPoint(previousTarget.viewportPoint),
      sequenceId: sequenceId.current,
      sessionId,
      targetId: previousTarget.id,
    }));

    expect(controller.state.collectedTargetSampleCount.get(activeTarget.id) ?? 0).toBe(0);
    expect(controller.state.excludedSampleCountByReason.get("not-collecting")).toBe(1);
  });

  it("rejects duplicate and late samples", () => {
    const { controller, clockTime } = createController({
      collectionConfig: { minimumSamplesPerTarget: 2 },
      timingConfig: { collectDurationMs: 10 },
    });
    controller.start(viewportRect);
    advanceToCollectingWindow(controller, clockTime);

    const state = controller.state;
    if (state.activeTarget === null || state.sessionId === null || state.collectingWindowEndMs === null) {
      throw new Error("Collecting state was not initialized.");
    }

    const accepted = createRawGazeSample({
      sampleAtMs: clockTime.current,
      rawVector: rawFromPoint(state.activeTarget.viewportPoint),
      sequenceId: 1,
      sessionId: state.sessionId,
      targetId: state.activeTarget.id,
    });
    controller.submitRawGazeSample(accepted);
    controller.submitRawGazeSample(accepted);
    controller.submitRawGazeSample(createRawGazeSample({
      sampleAtMs: Number(state.collectingWindowEndMs) + 1,
      rawVector: rawFromPoint(state.activeTarget.viewportPoint),
      sequenceId: 2,
      sessionId: state.sessionId,
      targetId: state.activeTarget.id,
    }));

    expect(controller.state.collectedTargetSampleCount.get(state.activeTarget.id)).toBe(1);
    expect(controller.state.excludedSampleCountByReason.get("duplicate-sequence")).toBe(1);
    expect(controller.state.excludedSampleCountByReason.get("late-response")).toBe(1);
  });

  it("fails when target sample count is below minimum", () => {
    const { controller, clockTime } = createController({
      collectionConfig: {
        minimumSamplesPerTarget: 2,
        trimRatio: 0,
      },
    });
    controller.start(viewportRect);
    submitForCurrentTarget(controller, clockTime, 1);

    clockTime.current += 2;
    controller.tick();

    expect(controller.state.phase).toBe("failed");
    expect(controller.state.error?.kind).toBe("sample-count");
  });

  it("ignores samples after cancellation and disposal", () => {
    const { controller, clockTime } = createController();
    controller.start(viewportRect);
    advanceToCollectingWindow(controller, clockTime);

    const state = controller.state;
    if (state.activeTarget === null || state.sessionId === null) {
      throw new Error("Collecting state was not initialized.");
    }

    const sample = createRawGazeSample({
      sampleAtMs: clockTime.current,
      rawVector: rawFromPoint(state.activeTarget.viewportPoint),
      sequenceId: 1,
      sessionId: state.sessionId,
      targetId: state.activeTarget.id,
    });

    controller.cancel();
    controller.submitRawGazeSample(sample);
    expect(controller.state.phase).toBe("cancelled");
    expect(controller.state.error).toBeNull();
    expect(controller.state.collectedTargetSampleCount.get(state.activeTarget.id) ?? 0).toBe(0);

    controller.dispose();
    controller.submitRawGazeSample({ ...sample, sequenceId: 2 });
    expect(controller.state.collectedTargetSampleCount.get(state.activeTarget.id) ?? 0).toBe(0);
  });

  it("unsubscribes listeners and stops callback updates", () => {
    const { controller, clockTime } = createController();
    let callbackCount = 0;
    const unsubscribe = controller.subscribe(() => {
      callbackCount += 1;
    });

    expect(callbackCount).toBe(1);
    unsubscribe();
    const baseline = callbackCount;

    controller.start(viewportRect);
    clockTime.current += 1;
    controller.tick();

    expect(callbackCount).toBe(baseline);
  });
});
