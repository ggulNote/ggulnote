import { describe, expect, it } from "vitest";
import { nextMediaPipeTimestamp } from "./gaze-worker-protocol";

describe("nextMediaPipeTimestamp", () => {
  it("floors floating values and enforces monotonic growth", () => {
    const timestampA = nextMediaPipeTimestamp(1_000, 10_000.9);
    expect(timestampA).toBe(10_000);

    const timestampB = nextMediaPipeTimestamp(timestampA, 10_000.5);
    expect(timestampB).toBe(10_001);

    const timestampC = nextMediaPipeTimestamp(timestampB, 10_050.1);
    expect(timestampC).toBe(10_050);
  });
});
