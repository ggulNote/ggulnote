import type { Rect, Size } from "@ggulnote/editor-core";

/** Shared notebook spacing for every voice-created object. */
export const NOTEBOOK_LAYOUT_POLICY = Object.freeze({
  safeInset: 24,
  naturalGap: 16,
});

export function notebookEditableBounds(page: Size): Rect {
  if (!Number.isFinite(page.width) || page.width <= 0
    || !Number.isFinite(page.height) || page.height <= 0) {
    throw new RangeError("Notebook page size must be positive and finite.");
  }
  const insetX = Math.min(NOTEBOOK_LAYOUT_POLICY.safeInset, (page.width - 1) / 2);
  const insetY = Math.min(NOTEBOOK_LAYOUT_POLICY.safeInset, (page.height - 1) / 2);
  return Object.freeze({
    x: insetX,
    y: insetY,
    width: page.width - insetX * 2,
    height: page.height - insetY * 2,
  });
}
