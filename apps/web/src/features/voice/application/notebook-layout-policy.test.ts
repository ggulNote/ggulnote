import { describe, expect, it } from "vitest";
import {
  NOTEBOOK_LAYOUT_POLICY,
  notebookEditableBounds,
} from "./notebook-layout-policy";

describe("notebook layout policy", () => {
  it("keeps the default writing origin and every page edge inside a shared safe inset", () => {
    expect(NOTEBOOK_LAYOUT_POLICY).toEqual({ safeInset: 24, naturalGap: 16 });
    expect(notebookEditableBounds({ width: 600, height: 800 })).toEqual({
      x: 24,
      y: 24,
      width: 552,
      height: 752,
    });
  });

  it("preserves a positive editable area on small pages and rejects invalid pages", () => {
    expect(notebookEditableBounds({ width: 20, height: 30 })).toEqual({
      x: 9.5,
      y: 14.5,
      width: 1,
      height: 1,
    });
    expect(() => notebookEditableBounds({ width: 0, height: 30 }))
      .toThrow("positive and finite");
  });
});
