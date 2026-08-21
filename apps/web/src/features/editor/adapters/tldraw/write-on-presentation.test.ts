import { describe, expect, it, vi } from "vitest";
import {
  WRITE_ON_DURATION_POLICY,
  computeWriteOnDuration,
  finishWriteOn,
  readWriteOn,
  startWriteOn,
} from "./write-on-presentation";

describe("write-on presentation", () => {
  it("scales with complete Unicode glyphs and caps long content", () => {
    expect(computeWriteOnDuration("안녕하세요"))
      .toBe(computeWriteOnDuration("hello"));
    expect(computeWriteOnDuration("x+1"))
      .toBeGreaterThanOrEqual(WRITE_ON_DURATION_POLICY.minimumMs);
    expect(computeWriteOnDuration("가".repeat(1_000)))
      .toBe(WRITE_ON_DURATION_POLICY.maximumMs);
  });

  it("continues from the original start across rerenders and never persists progress", () => {
    startWriteOn("text:one", "안녕하세요", 1_000);
    const first = readWriteOn("text:one", 1_100);
    const second = readWriteOn("text:one", 1_250);

    expect(first?.elapsedMs).toBe(100);
    expect(second?.elapsedMs).toBe(250);
    expect(second?.durationMs).toBe(first?.durationMs);
    expect(readWriteOn("text:one", 3_000)).toBeUndefined();
  });

  it("can be cancelled for replace, update, and delete", () => {
    startWriteOn("math:one", "x^2+1", 1_000);
    expect(readWriteOn("math:one", 1_010)).toBeDefined();
    finishWriteOn("math:one");
    expect(readWriteOn("math:one", 1_011)).toBeUndefined();
  });

  it("releases completed ephemeral state without requiring a rerender", () => {
    vi.useFakeTimers();
    try {
      const duration = computeWriteOnDuration("안녕하세요");
      startWriteOn("text:cleanup", "안녕하세요", 1_000);
      expect(readWriteOn("text:cleanup", 1_001)).toBeDefined();

      vi.advanceTimersByTime(duration);

      expect(readWriteOn("text:cleanup", 1_001)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
