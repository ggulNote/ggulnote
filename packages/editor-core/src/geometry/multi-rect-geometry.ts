import type { NormalizedPoint, NormalizedRect } from "@ggulnote/shared-types";
import { MAX_ANNOTATION_RECT_COUNT } from "../annotations/annotation-types";
import { clampRectToBounds, translateRect } from "./geometry-utils";

export function normalizeAnnotationRects(
  rects: readonly NormalizedRect[],
): NormalizedRect[] {
  if (rects.length === 0 || rects.length > MAX_ANNOTATION_RECT_COUNT) {
    throw new Error("Invalid annotation rect count");
  }

  return rects.map((rect, index) => {
    if (
      !Number.isFinite(rect.x)
      || !Number.isFinite(rect.y)
      || !Number.isFinite(rect.width)
      || !Number.isFinite(rect.height)
      || rect.width <= 0
      || rect.height <= 0
    ) {
      throw new Error(`Invalid annotation rect at index ${index}`);
    }
    return clampRectToBounds({ ...rect });
  });
}

export function unionAnnotationRects(
  rects: readonly NormalizedRect[],
): NormalizedRect {
  if (rects.length === 0) {
    throw new Error("Annotation rects are required");
  }

  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function translateAnnotationRects(
  rects: readonly NormalizedRect[],
  delta: NormalizedPoint,
): NormalizedRect[] {
  return rects.map((rect) => translateRect(rect, delta));
}

export function clampAnnotationRectGroupToBounds(
  rects: readonly NormalizedRect[],
): NormalizedRect[] {
  const bounds = unionAnnotationRects(rects);
  const clampedBounds = clampRectToBounds(bounds);
  return translateAnnotationRects(rects, {
    x: clampedBounds.x - bounds.x,
    y: clampedBounds.y - bounds.y,
  });
}
