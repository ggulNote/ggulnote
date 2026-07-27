import { describe, expect, it } from "vitest";
import {
  RingBuffer,
  toSessionTimeMs,
  type TimedTimelineEntry,
} from "../src";

interface TestEntry extends TimedTimelineEntry {
  readonly value: string;
}

const entry = (time: number, value: string): TestEntry => ({
  time: toSessionTimeMs(time),
  value,
});

describe("RingBuffer", () => {
  it("appends, queries inclusive ranges, and clears entries", () => {
    const buffer = new RingBuffer<TestEntry>(1_000);

    buffer.append(entry(100, "first"));
    buffer.append(entry(200, "second"));
    buffer.append(entry(300, "third"));

    expect(buffer.size).toBe(3);
    expect(buffer.query(toSessionTimeMs(200), toSessionTimeMs(300)).map((item) => item.value))
      .toEqual(["second", "third"]);

    buffer.clear();

    expect(buffer.size).toBe(0);
    expect(buffer.query(toSessionTimeMs(0), toSessionTimeMs(1_000))).toEqual([]);
  });

  it("evicts entries older than the retention duration", () => {
    const buffer = new RingBuffer<TestEntry>(100);

    buffer.append(entry(100, "expired"));
    buffer.append(entry(150, "boundary"));
    buffer.append(entry(250, "latest"));

    expect(buffer.size).toBe(2);
    expect(buffer.query(toSessionTimeMs(0), toSessionTimeMs(300)).map((item) => item.value))
      .toEqual(["boundary", "latest"]);
  });

  it("rejects entries appended out of time order", () => {
    const buffer = new RingBuffer<TestEntry>(1_000);
    buffer.append(entry(200, "newer"));

    expect(() => buffer.append(entry(199, "older"))).toThrow(
      "non-decreasing time order",
    );
  });
});
