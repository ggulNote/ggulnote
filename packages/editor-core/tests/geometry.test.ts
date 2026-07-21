import { describe, expect, it } from "vitest";
import { distanceToSegment, isPointInRect, isPointNearRect } from "../src/geometry/bounds-utils";
import { hitTestLineSegment } from "../src/geometry/hit-test";

describe("Geometry utilities", () => {
  it("detects point inside and outside rect", () => {
    const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };

    expect(isPointInRect({ x: 0.2, y: 0.2 }, rect)).toBe(true);
    expect(isPointInRect({ x: 0, y: 0 }, rect)).toBe(false);
  });

  it("expands point hit area with tolerance", () => {
    const rect = { x: 0.5, y: 0.5, width: 0.01, height: 0.01 };
    expect(isPointNearRect({ x: 0.52, y: 0.5 }, rect, 0.02)).toBe(true);
    expect(isPointNearRect({ x: 0.8, y: 0.8 }, rect, 0.02)).toBe(false);
  });

  it("calculates line distance", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 1, y: 0 };

    expect(distanceToSegment({ x: 0.5, y: 0.5 }, start, end)).toBe(0.5);
    expect(hitTestLineSegment({ x: 0.5, y: 0.03 }, start, end, { width: 100, height: 100 })).toBe(true);
    expect(hitTestLineSegment({ x: 0.5, y: 0.5 }, start, end, { width: 100, height: 100 })).toBe(false);
  });
});
