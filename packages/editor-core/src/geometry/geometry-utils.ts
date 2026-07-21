import type { NormalizedPoint, NormalizedRect } from "@ggulnote/shared-types";

export const MIN_NORMALIZED = 0;
export const MAX_NORMALIZED = 1;

export const isFiniteNormalized = (value: number): boolean => Number.isFinite(value);

export const clampNormalized = (value: number): number => {
  if (!isFiniteNormalized(value)) {
    return 0;
  }

  return Math.min(MAX_NORMALIZED, Math.max(MIN_NORMALIZED, value));
};

export const clampPoint = (point: NormalizedPoint): NormalizedPoint => ({
  x: clampNormalized(point.x),
  y: clampNormalized(point.y),
});

export const isValidNormalizedNumber = (value: number): boolean => Number.isFinite(value);

export const isValidSize = (size: { width: number; height: number }): boolean =>
  isValidNormalizedNumber(size.width) && isValidNormalizedNumber(size.height) && size.width > 0 && size.height > 0;

export const clampRect = (rect: NormalizedRect): NormalizedRect => ({
  x: clampNormalized(rect.x),
  y: clampNormalized(rect.y),
  width: clampNormalized(rect.width),
  height: clampNormalized(rect.height),
});

export const ensureRectArea = (rect: NormalizedRect): NormalizedRect => ({
  x: clampNormalized(rect.x),
  y: clampNormalized(rect.y),
  width: isValidNormalizedNumber(rect.width) ? Math.max(0, rect.width) : 0,
  height: isValidNormalizedNumber(rect.height) ? Math.max(0, rect.height) : 0,
});

export const movePoint = (point: NormalizedPoint, delta: NormalizedPoint): NormalizedPoint => ({
  x: point.x + delta.x,
  y: point.y + delta.y,
});

export const translatePoint = movePoint;

export const rectFromPoints = (start: NormalizedPoint, end: NormalizedPoint): NormalizedRect => {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
};

export const rectCenter = (rect: NormalizedRect): NormalizedPoint => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

export const translateRect = (rect: NormalizedRect, delta: NormalizedPoint): NormalizedRect => ({
  x: rect.x + delta.x,
  y: rect.y + delta.y,
  width: rect.width,
  height: rect.height,
});

export const clampRectToBounds = (rect: NormalizedRect): NormalizedRect => {
  const width = clampNormalized(Math.max(0, rect.width));
  const height = clampNormalized(Math.max(0, rect.height));
  let x = clampNormalized(rect.x);
  let y = clampNormalized(rect.y);

  if (x + width > 1) {
    x = Math.max(0, 1 - width);
  }

  if (y + height > 1) {
    y = Math.max(0, 1 - height);
  }

  return {
    x,
    y,
    width,
    height,
  };
};

export const toCssPoint = (point: NormalizedPoint, pageSize: { width: number; height: number }): { x: number; y: number } => ({
  x: point.x * pageSize.width,
  y: point.y * pageSize.height,
});

export const toCssRect = (rect: NormalizedRect, pageSize: { width: number; height: number }) => ({
  left: rect.x * pageSize.width,
  top: rect.y * pageSize.height,
  width: rect.width * pageSize.width,
  height: rect.height * pageSize.height,
});
