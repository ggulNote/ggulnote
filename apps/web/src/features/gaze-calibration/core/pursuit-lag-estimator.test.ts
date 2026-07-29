import { describe, expect, it } from "vitest";

import {
  DEFAULT_PURSUIT_CALIBRATION_CONFIG,
  type PursuitLagConfig,
} from "../config/pursuit-calibration-config";
import type { PursuitRawSample, PursuitRawSampleWithBin } from "../domain/pursuit-types";
import { PursuitTargetHistory } from "./pursuit-target-history";
import {
  alignRawAndTargetWithLag,
  calculateCombinedCorrelationScore,
  calculatePearsonCorrelation,
  estimatePursuitLag,
  getLagCandidates,
  type AlignmentInput,
} from "./pursuit-lag-estimator";

const getSyntheticTargetCenter = (timestampMs: number) => ({
  x: Math.sin(timestampMs / 45) * 120 + timestampMs * 0.05,
  y: Math.cos(timestampMs / 70) * 90 - timestampMs * 0.03,
});

const createHistorySamples = (history: PursuitTargetHistory): void => {
  for (let timestampMs = 0; timestampMs <= 500; timestampMs += 10) {
    history.addSample({
      timestampMs,
      segmentId: "segment-1",
      role: "calibration",
      targetCenter: getSyntheticTargetCenter(timestampMs),
    });
  }
};

const createRawSamples = (lagMs: number, withNoise = 0): readonly PursuitRawSample[] => {
  const result: PursuitRawSample[] = [];
  for (let targetTimestampMs = 0; targetTimestampMs <= 500; targetTimestampMs += 50) {
    const targetCenter = getSyntheticTargetCenter(targetTimestampMs);
    const noise = targetTimestampMs / 50 % 2 === 0 ? withNoise : -withNoise;

    result.push({
      sessionId: "session-1",
      segmentId: "segment-1",
      role: "calibration",
      timestampMs: targetTimestampMs + lagMs,
      rawVector: {
        x: targetCenter.x + noise,
        y: targetCenter.y + noise,
        z: 1,
      },
      targetCenter: { x: 0, y: 0 },
      targetBounds: { left: 0, top: 0, right: 0, bottom: 0 },
      trackingQuality: 1,
    });
  }

  return result;
};

const createInput = (
  lagMs: number,
  lagConfig: Partial<PursuitLagConfig> = {},
): AlignmentInput => {
  const config = {
    ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.lagAlignment,
    ...lagConfig,
  };

  const history = new PursuitTargetHistory();
  createHistorySamples(history);

  return {
    rawSamples: createRawSamples(lagMs),
    targetHistory: history,
    lagConfig: config,
  };
};

describe("pursuit lag estimator", () => {
  it("generates lag candidates from minimum, maximum, and step", () => {
    expect(
      getLagCandidates({
        ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.lagAlignment,
        minimumLagMs: 0,
        maximumLagMs: 90,
        searchStepMs: 30,
      }),
    ).toEqual([0, 30, 60, 90]);
  });

  it("computes Pearson correlation for synthetic aligned data", () => {
    expect(calculatePearsonCorrelation([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(calculatePearsonCorrelation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
  });

  it("computes combined correlation score", () => {
    expect(calculateCombinedCorrelationScore(0.6, -0.8)).toBeCloseTo(Math.sqrt(0.6 * 0.8));
  });

  it("supports known fixed lag alignment", () => {
    const result = estimatePursuitLag(
      createInput(120, {
        mode: "fixed",
        fixedLagMs: 120,
        minimumLagMs: 50,
        maximumLagMs: 200,
      }),
    );

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.source).toBe("fixed");
      expect(result.value.lagMs).toBe(120);
      expect(result.value.pairedSampleCount).toBeGreaterThan(3);
      expect(result.value.correlationX).toBeGreaterThan(0.8);
      expect(result.value.correlationY).toBeGreaterThan(0.8);
    }
  });

  it("recovers estimated lag from synthetic shifted signal", () => {
    const result = estimatePursuitLag(
      createInput(40, {
        mode: "estimate",
        minimumLagMs: 0,
        maximumLagMs: 100,
        searchStepMs: 10,
      }),
    );

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.source).toBe("estimated");
      expect(result.value.lagMs).toBe(40);
      expect(result.value.pairedSampleCount).toBeGreaterThan(3);
      expect(result.value.correlationX).toBeGreaterThan(0.9);
      expect(result.value.correlationY).toBeGreaterThan(0.9);
    }
  });

  it("applies interpolation while aligning raw and target history", () => {
    const history = new PursuitTargetHistory();
    history.addSample({
      timestampMs: 0,
      segmentId: "segment-1",
      role: "calibration",
      targetCenter: { x: 0, y: 0 },
    });
    history.addSample({
      timestampMs: 100,
      segmentId: "segment-1",
      role: "calibration",
      targetCenter: { x: 100, y: 100 },
    });

    const sample: PursuitRawSampleWithBin = {
      sessionId: "session-1",
      segmentId: "segment-1",
      role: "calibration",
      timestampMs: 130,
      rawVector: { x: 0, y: 0, z: 1 },
      targetCenter: { x: 0, y: 0 },
      targetBounds: { left: 0, top: 0, right: 0, bottom: 0 },
      spatialBin: { x: 0, y: 0 },
    };

    const pairs = alignRawAndTargetWithLag(
      [sample],
      history.getTargetCenterAtTimestamp.bind(history),
      100,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      timestampMs: 130,
      targetX: 30,
      targetY: 30,
    });
  });

  it("returns fallback when minimum correlation threshold is not met", () => {
    const result = estimatePursuitLag({
      rawSamples: createRawSamples(20, 30),
      targetHistory: (() => {
        const history = new PursuitTargetHistory();
        createHistorySamples(history);
        return history;
      })(),
      lagConfig: {
        ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.lagAlignment,
        mode: "estimate",
        fixedLagMs: 20,
        minimumLagMs: 0,
        maximumLagMs: 80,
        searchStepMs: 10,
        minimumCorrelation: 0.999999,
      },
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.source).toBe("fallback");
      expect(result.value.lagMs).toBe(20);
    }
  });

  it("handles insufficient paired samples", () => {
    const result = estimatePursuitLag({
      rawSamples: createRawSamples(0).slice(0, 2),
      targetHistory: new PursuitTargetHistory(),
      lagConfig: {
        ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.lagAlignment,
        mode: "estimate",
        minimumLagMs: 0,
        maximumLagMs: 10,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "insufficient-paired-samples" },
    });
  });
});
