import { describe, expect, it } from "vitest";

import type { PursuitTargetHistorySample } from "../domain/pursuit-types";
import { PursuitTargetHistory } from "./pursuit-target-history";

const createSample = (
  timestampMs: number,
  segmentId = "segment-1",
  role: "calibration" | "validation" = "calibration",
  x = timestampMs,
): PursuitTargetHistorySample => ({
  timestampMs,
  segmentId,
  role,
  targetCenter: { x, y: timestampMs },
});

describe("pursuit target history", () => {
  it("stores samples in timestamp order", () => {
    const history = new PursuitTargetHistory();

    const samples = [
      createSample(300),
      createSample(100),
      createSample(200),
    ];

    for (const sample of samples) {
      const result = history.addSample(sample);
      expect(result.ok).toBe(true);
    }

    expect(history.getSamples("calibration", "segment-1")).toEqual([
      createSample(100),
      createSample(200),
      createSample(300),
    ]);
  });

  it("rejects duplicate timestamps", () => {
    const history = new PursuitTargetHistory();
    const sample = createSample(100);
    expect(history.addSample(sample)).toMatchObject({ ok: true });
    expect(history.addSample(sample)).toMatchObject({
      ok: false,
      reason: "duplicate-timestamp",
    });
  });

  it("returns exact timestamp lookup", () => {
    const history = new PursuitTargetHistory();
    const sample = createSample(128);

    history.addSample(sample);
    const exact = history.getTargetCenterAtTimestamp("calibration", "segment-1", 128);

    expect(exact.ok).toBe(true);
    expect(exact).toMatchObject({
      ok: true,
      sample: {
        timestampMs: 128,
        segmentId: "segment-1",
        role: "calibration",
        targetCenter: { x: 128, y: 128 },
      },
    });
  });

  it("interpolates between timestamps", () => {
    const history = new PursuitTargetHistory();

    history.addSample(createSample(0, "segment-1", "calibration", 0));
    history.addSample(createSample(10, "segment-1", "calibration", 20));

    const result = history.getTargetCenterAtTimestamp("calibration", "segment-1", 5);
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      sample: {
        timestampMs: 5,
        targetCenter: { x: 10, y: 5 },
      },
    });
  });

  it("returns out-of-range when lookup is outside history", () => {
    const history = new PursuitTargetHistory();
    history.addSample(createSample(10));

    expect(history.getTargetCenterAtTimestamp("calibration", "segment-1", 0).ok).toBe(false);
    expect(history.getTargetCenterAtTimestamp("calibration", "segment-1", 20).ok).toBe(false);
  });

  it("rejects mixed role and segment queries", () => {
    const history = new PursuitTargetHistory();
    history.addSample(createSample(100, "segment-1", "calibration"));

    expect(history.getTargetCenterAtTimestamp("validation", "segment-1", 100)).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(history.getTargetCenterAtTimestamp("calibration", "segment-2", 100)).toMatchObject({
      ok: false,
      reason: "not-found",
    });
  });

  it("removes old samples when history exceeds retention window", () => {
    const history = new PursuitTargetHistory({ keepSampleAgeMs: 80 });

    history.addSample(createSample(0));
    history.addSample(createSample(30));
    history.addSample(createSample(120));

    expect(history.getTargetCenterAtTimestamp("calibration", "segment-1", 0).ok).toBe(false);
    expect(history.getTargetCenterAtTimestamp("calibration", "segment-1", 120).ok).toBe(true);
  });

  it("returns exact sample only for existing history timestamps", () => {
    const history = new PursuitTargetHistory();
    history.addSample(createSample(100));

    expect(history.getExactSample("calibration", "segment-1", 100).ok).toBe(true);
    expect(history.getExactSample("calibration", "segment-1", 99).ok).toBe(false);
  });
});
