import { describe, expect, it } from "vitest";

import {
  DEFAULT_PURSUIT_CALIBRATION_CONFIG,
  type PursuitMotionConfig,
  type PursuitSampleSelectionConfig,
} from "../config/pursuit-calibration-config";
import type { PursuitRawSample, PursuitTrajectoryState } from "../domain/pursuit-types";
import { PursuitSampleCollector } from "./pursuit-sample-collector";

const baseBounds = {
  left: 0,
  top: 0,
  right: 200,
  bottom: 200,
};

const baseSelectionConfig: PursuitSampleSelectionConfig = {
  ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.sampleSelection,
};

const baseMotionConfig: PursuitMotionConfig = {
  ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.motion,
};

const createState = (
  overrides: Readonly<Partial<PursuitTrajectoryState>> = {},
): PursuitTrajectoryState => ({
  trajectoryId: "trajectory",
  role: "calibration",
  phase: "moving",
  elapsedMs: 0,
  segmentIndex: 0,
  segmentId: "segment-1",
  segmentElapsedMs: 60,
  segmentDurationMs: 500,
  segmentProgress: 0.5,
  targetCenter: {
    x: 150,
    y: 150,
  },
  targetBounds: baseBounds,
  nextDirection: null,
  movementStage: "sampling",
  isSampleEligible: true,
  isComplete: false,
  ...overrides,
});

const createInput = (
  sampleOverrides: Readonly<Partial<PursuitRawSample>> = {},
  overrides: Readonly<Partial<{
    segmentState: PursuitTrajectoryState;
    expectedRole: "calibration" | "validation";
    isCollecting: boolean;
    sampleSelectionConfig: PursuitSampleSelectionConfig;
    motionConfig: PursuitMotionConfig;
    trackingQualityThreshold: number;
  }>> = {},
) => {
  const sample = {
    sessionId: "session-1",
    segmentId: "segment-1",
    role: "calibration" as const,
    timestampMs: 1000,
    rawVector: { x: 0.12, y: 0.22, z: 0.32 },
    targetCenter: { x: 150, y: 150 },
    targetBounds: baseBounds,
    trackingQuality: 0.9,
    ...sampleOverrides,
  };

  return {
    sample,
    activeSegmentId: overrides.segmentState?.segmentId ?? "segment-1",
    expectedSessionId: "session-1",
    expectedRole: overrides.expectedRole ?? "calibration",
    trajectoryState: overrides.segmentState,
    isCollecting: overrides.isCollecting ?? true,
    trackingQualityThreshold: overrides.trackingQualityThreshold ?? 0.5,
    collectionConfig: overrides.sampleSelectionConfig ?? baseSelectionConfig,
    motionConfig: overrides.motionConfig ?? baseMotionConfig,
  };
};

const withResult = (
  collector: PursuitSampleCollector,
  params: ReturnType<typeof createInput>,
) => collector.collect({
  ...params,
  trajectoryState: params.trajectoryState ?? createState(),
});

describe("pursuit sample collector", () => {
  it("accepts samples in moving sampling stage", () => {
    const collector = new PursuitSampleCollector();

    const input = createInput();
    const result = withResult(collector, input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected accepted sample.");
    }
    expect(result.sample.spatialBin).toEqual({ x: 2, y: 2 });
    expect(collector.getSamples("calibration", "segment-1")).toHaveLength(1);
  });

  it("rejects non-moving phases", () => {
    const collector = new PursuitSampleCollector();
    const state = createState({ phase: "initial-hold", movementStage: null });

    const result = withResult(collector, createInput({}, { segmentState: state }));

    expect(result).toMatchObject({ ok: false, reason: "outside-collection-window" });
  });

  it("rejects direction cue phase", () => {
    const collector = new PursuitSampleCollector();
    const state = createState({ phase: "direction-cue", movementStage: null });

    const result = withResult(collector, createInput({}, { segmentState: state }));

    expect(result).toMatchObject({ ok: false, reason: "outside-collection-window" });
  });

  it("rejects settling phase", () => {
    const collector = new PursuitSampleCollector();
    const state = createState({ phase: "settling", movementStage: null });

    const result = withResult(collector, createInput({}, { segmentState: state }));

    expect(result).toMatchObject({ ok: false, reason: "outside-collection-window" });
  });

  it("rejects segment stop phase", () => {
    const collector = new PursuitSampleCollector();
    const state = createState({ phase: "segment-stop", movementStage: null });

    const result = withResult(collector, createInput({}, { segmentState: state }));

    expect(result).toMatchObject({ ok: false, reason: "outside-collection-window" });
  });

  it("rejects warmup stage", () => {
    const collector = new PursuitSampleCollector();
    const state = createState({ phase: "moving", movementStage: "warmup" });

    const result = withResult(collector, createInput({}, { segmentState: state }));

    expect(result).toMatchObject({ ok: false, reason: "movement-warmup" });
  });

  it("rejects cooldown stage", () => {
    const collector = new PursuitSampleCollector();
    const state = createState({ phase: "moving", movementStage: "cooldown" });

    const result = withResult(collector, createInput({}, { segmentState: state }));

    expect(result).toMatchObject({ ok: false, reason: "movement-cooldown" });
  });

  it("rejects samples from another session", () => {
    const collector = new PursuitSampleCollector();

    const result = withResult(
      collector,
      createInput({
        sessionId: "other-session",
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "wrong-session" });
  });

  it("rejects samples from another segment", () => {
    const collector = new PursuitSampleCollector();
    const state = createState();

    const result = withResult(
      collector,
      createInput({ segmentId: "segment-2" }, { segmentState: state }),
    );

    expect(result).toMatchObject({ ok: false, reason: "wrong-segment" });
  });

  it("rejects role mismatch", () => {
    const collector = new PursuitSampleCollector();

    const result = withResult(
      collector,
      createInput(
        { role: "validation" },
        { expectedRole: "calibration" },
      ),
    );

    expect(result).toMatchObject({ ok: false, reason: "wrong-role" });
  });

  it("rejects duplicated frame IDs", () => {
    const collector = new PursuitSampleCollector();

    const first = withResult(
      collector,
      createInput({
        frameId: 10,
      }),
    );

    expect(first.ok).toBe(true);

    const second = withResult(
      collector,
      createInput({
        timestampMs: 1100,
        frameId: 10,
      }),
    );

    expect(second).toMatchObject({ ok: false, reason: "duplicate-frame" });
  });

  it("rejects duplicated sequence IDs", () => {
    const collector = new PursuitSampleCollector();

    const first = withResult(
      collector,
      createInput({
        sequenceId: 7,
      }),
    );
    expect(first.ok).toBe(true);

    const second = withResult(
      collector,
      createInput({
        timestampMs: 1100,
        sequenceId: 7,
      }),
    );
    expect(second).toMatchObject({ ok: false, reason: "duplicate-sequence" });
  });

  it("rejects late samples", () => {
    const collector = new PursuitSampleCollector();

    const first = withResult(
      collector,
      createInput({
        timestampMs: 1100,
      }),
    );
    expect(first.ok).toBe(true);

    const second = withResult(
      collector,
      createInput({
        timestampMs: 1050,
      }),
    );

    expect(second).toMatchObject({ ok: false, reason: "late-sample" });
  });

  it("applies sampling interval filtering", () => {
    const collector = new PursuitSampleCollector();

    const first = withResult(
      collector,
      createInput({
        timestampMs: 1000,
      }),
    );
    expect(first.ok).toBe(true);

    const second = withResult(
      collector,
      createInput({
        timestampMs: 1025,
      }),
    );
    expect(second).toMatchObject({ ok: false, reason: "sampling-interval" });

    const third = withResult(
      collector,
      createInput({
        timestampMs: 1000 + baseMotionConfig.samplingIntervalMs,
      }),
    );
    expect(third.ok).toBe(true);
  });

  it("enforces spatial-bin capacity", () => {
    const collector = new PursuitSampleCollector();
    const config: PursuitSampleSelectionConfig = {
      ...baseSelectionConfig,
      maximumSamplesPerSpatialBin: 1,
    };

    const first = withResult(
      collector,
      createInput({}, { sampleSelectionConfig: config }),
    );
    expect(first.ok).toBe(true);

    const second = withResult(
      collector,
      createInput(
        { timestampMs: 1100 },
        { sampleSelectionConfig: config },
      ),
    );
    expect(second).toMatchObject({ ok: false, reason: "spatial-bin-limit" });
  });

  it("rejects invalid vector values", () => {
    const collector = new PursuitSampleCollector();

    const result = withResult(
      collector,
      createInput({
        rawVector: { x: Number.NaN, y: 0.2, z: 0.3 },
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid-vector" });
  });

  it("rejects samples after collector inactive", () => {
    const collector = new PursuitSampleCollector();

    const result = withResult(
      collector,
      createInput({}, { isCollecting: false }),
    );

    expect(result).toMatchObject({ ok: false, reason: "collector-inactive" });
  });

  it("tracks collection state per role and segment", () => {
    const collector = new PursuitSampleCollector();

    withResult(collector, createInput());
    withResult(
      collector,
      createInput(
        { segmentId: "segment-2" },
        {
          segmentState: createState({ segmentId: "segment-2" }),
        },
      ),
    );

    const calibrationStats = collector.getSegmentCollectionStats("calibration", "segment-1");
    const segment2Stats = collector.getSegmentCollectionStats("calibration", "segment-2");

    expect(calibrationStats?.acceptedCount).toBe(1);
    expect(segment2Stats?.acceptedCount).toBe(1);
  });
});
