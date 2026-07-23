import type { NormalizedPoint, NormalizedRect } from "@ggulnote/shared-types";

const clampUnit = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
};

export const clampToUnit = (value: number): number => clampUnit(value);

export const clampRect = (rect: NormalizedRect): NormalizedRect => {
  const x = clampUnit(rect.x);
  const y = clampUnit(rect.y);
  const right = clampUnit(rect.x + rect.width);
  const bottom = clampUnit(rect.y + rect.height);

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
};

export const isFiniteRect = (rect: NormalizedRect): boolean => {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height);
};

export const isValidBounds = (rect: NormalizedRect): boolean => {
  return isFiniteRect(rect)
    && rect.width > 0
    && rect.height > 0
    && rect.x + rect.width > 0
    && rect.y + rect.height > 0
    && rect.x < 1
    && rect.y < 1;
};

export const area = (rect: NormalizedRect): number => {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
};

export const unionBounds = (bounds: readonly NormalizedRect[]): NormalizedRect | null => {
  const normalized = bounds
    .filter((rect) => isValidBounds(rect))
    .map(clampRect)
    .filter((rect) => rect.width > 0 && rect.height > 0);

  if (normalized.length === 0) {
    return null;
  }

  const minX = Math.min(...normalized.map((rect) => rect.x));
  const minY = Math.min(...normalized.map((rect) => rect.y));
  const maxX = Math.max(...normalized.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...normalized.map((rect) => rect.y + rect.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

export const boundsFromPoints = (points: readonly NormalizedPoint[]): NormalizedRect | null => {
  const valid = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (valid.length === 0) {
    return null;
  }

  const minX = Math.min(...valid.map((point) => point.x));
  const minY = Math.min(...valid.map((point) => point.y));
  const maxX = Math.max(...valid.map((point) => point.x));
  const maxY = Math.max(...valid.map((point) => point.y));

  return clampRect({
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  });
};

export const intersectionArea = (left: NormalizedRect, right: NormalizedRect): number => {
  const normalizedLeft = clampRect(left);
  const normalizedRight = clampRect(right);
  if (
    normalizedLeft.width <= 0
    || normalizedLeft.height <= 0
    || normalizedRight.width <= 0
    || normalizedRight.height <= 0
  ) {
    return 0;
  }

  const x1 = Math.max(normalizedLeft.x, normalizedRight.x);
  const y1 = Math.max(normalizedLeft.y, normalizedRight.y);
  const x2 = Math.min(normalizedLeft.x + normalizedLeft.width, normalizedRight.x + normalizedRight.width);
  const y2 = Math.min(normalizedLeft.y + normalizedLeft.height, normalizedRight.y + normalizedRight.height);

  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
};

export const overlapRatio = (left: NormalizedRect, right: NormalizedRect): number => {
  const intersection = intersectionArea(left, right);
  if (intersection <= 0) {
    return 0;
  }

  const union = area(left) + area(right) - intersection;
  return union > 0 ? intersection / union : 0;
};

export const containsPoint = (rect: NormalizedRect, point: NormalizedPoint): boolean => {
  const normalizedRect = clampRect(rect);
  return point.x >= normalizedRect.x
    && point.x <= normalizedRect.x + normalizedRect.width
    && point.y >= normalizedRect.y
    && point.y <= normalizedRect.y + normalizedRect.height;
};

export const distancePointToRect = (point: NormalizedPoint, rect: NormalizedRect): number => {
  const normalizedRect = clampRect(rect);
  if (
    !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
    || normalizedRect.width <= 0
    || normalizedRect.height <= 0
  ) {
    return Number.POSITIVE_INFINITY;
  }

  if (containsPoint(normalizedRect, point)) {
    return 0;
  }

  const dx = point.x < normalizedRect.x
    ? normalizedRect.x - point.x
    : point.x > normalizedRect.x + normalizedRect.width
      ? point.x - (normalizedRect.x + normalizedRect.width)
      : 0;
  const dy = point.y < normalizedRect.y
    ? normalizedRect.y - point.y
    : point.y > normalizedRect.y + normalizedRect.height
      ? point.y - (normalizedRect.y + normalizedRect.height)
      : 0;

  return Math.hypot(dx, dy);
};

export const distancePointToRects = (
  point: NormalizedPoint,
  rects: readonly NormalizedRect[],
): number => {
  if (rects.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(...rects.map((rect) => distancePointToRect(point, rect)));
};

export const containsPointInRects = (
  rects: readonly NormalizedRect[],
  point: NormalizedPoint,
): boolean => rects.some((rect) => containsPoint(rect, point));

export const overlapRatioWithRects = (
  rect: NormalizedRect,
  fragments: readonly NormalizedRect[],
): number => {
  if (fragments.length === 0) {
    return 0;
  }

  return Math.max(...fragments.map((fragment) => overlapRatio(rect, fragment)));
};

export const yCenter = (rect: NormalizedRect): number => rect.y + rect.height * 0.5;
export const xCenter = (rect: NormalizedRect): number => rect.x + rect.width * 0.5;

export const verticalOverlapRatio = (left: NormalizedRect, right: NormalizedRect): number => {
  const top = Math.max(left.y, right.y);
  const bottom = Math.min(left.y + left.height, right.y + right.height);
  const minimumHeight = Math.min(left.height, right.height);

  return bottom > top && minimumHeight > 0 ? (bottom - top) / minimumHeight : 0;
};

export const horizontalOverlapRatio = (left: NormalizedRect, right: NormalizedRect): number => {
  const start = Math.max(left.x, right.x);
  const end = Math.min(left.x + left.width, right.x + right.width);
  const minimumWidth = Math.min(left.width, right.width);

  return end > start && minimumWidth > 0 ? (end - start) / minimumWidth : 0;
};

export const sortByReadingPoint = (
  left: { readingOrder: number },
  right: { readingOrder: number },
): number => left.readingOrder - right.readingOrder;
