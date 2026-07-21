import { describe, it, expect } from "vitest";

describe("shared-types", () => {
  it("geometry types support numeric fields", () => {
    const point = { x: 0.1, y: 0.2 };
    const rect = { x: 0, y: 0, width: 1, height: 1 };
    const size = { width: 612, height: 794 };

    expect(point.x).toBe(0.1);
    expect(rect.width + rect.height).toBe(2);
    expect(size.width).toBe(612);
  });
});
