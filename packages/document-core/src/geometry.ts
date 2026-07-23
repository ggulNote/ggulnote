import type { NormalizedPoint, NormalizedRect } from "@ggulnote/shared-types";

const clampUnit = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
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

export const area = (rect: NormalizedRect): number => {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
};

export const unionBounds = (bounds: readonly NormalizedRect[]): NormalizedRect | null => {
  const normalized = bounds
    .filter((rect) => isFiniteRect(rect))
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map(clampRect);

  if (normalized.length === 0) {
    return null;
  }

  let left = normalized[0].x;
  let top = normalized[0].y;
  let right = normalized[0].x + normalized[0].width;
  let bottom = normalized[0].y + normalized[0].height;

  for (const rect of normalized) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
};

export const intersectionArea = (left: NormalizedRect, right: NormalizedRect): number => {
  const normalizedLeft = clampRect(left);
  const normalizedRight = clampRect(right);

  if (normalizedLeft.width <= 0 || normalizedLeft.height <= 0 || normalizedRight.width <= 0 || normalizedRight.height <= 0) {
    return 0;
  }

  const x1 = Math.max(normalizedLeft.x, normalizedRight.x);
  const y1 = Math.max(normalizedLeft.y, normalizedRight.y);
  const x2 = Math.min(normalizedLeft.x + normalizedLeft.width, normalizedRight.x + normalizedRight.width);
  const y2 = Math.min(normalizedLeft.y + normalizedLeft.height, normalizedRight.y + normalizedRight.height);

  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);

  return width * height;
};

export const overlapRatio = (left: NormalizedRect, right: NormalizedRect): number => {
  const intersection = intersectionArea(left, right);
  if (intersection <= 0) {
    return 0;
  }

  const union = area(left) + area(right) - intersection;
  if (union <= 0) {
    return 0;
  }

  return intersection / union;
};

export const containsPoint = (rect: NormalizedRect, point: NormalizedPoint): boolean => {
  const normalizedRect = clampRect(rect);
  return (
    point.x >= normalizedRect.x
    && point.x <= normalizedRect.x + normalizedRect.width
    && point.y >= normalizedRect.y
    && point.y <= normalizedRect.y + normalizedRect.height
  );
};

export const distancePointToRect = (point: NormalizedPoint, rect: NormalizedRect): number => {
  const normalizedRect = clampRect(rect);

  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return Number.POSITIVE_INFINITY;
  }

  if (normalizedRect.width <= 0 || normalizedRect.height <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (containsPoint(normalizedRect, point)) {
    return 0;
  }

  let dx = 0;
  if (point.x < normalizedRect.x) {
    dx = normalizedRect.x - point.x;
  } else if (point.x > normalizedRect.x + normalizedRect.width) {
    dx = point.x - (normalizedRect.x + normalizedRect.width);
  }

  let dy = 0;
  if (point.y < normalizedRect.y) {
    dy = normalizedRect.y - point.y;
  } else if (point.y > normalizedRect.y + normalizedRect.height) {
    dy = point.y - (normalizedRect.y + normalizedRect.height);
  }

  return Math.hypot(dx, dy);
};

export const yCenter = (rect: NormalizedRect): number => rect.y + rect.height * 0.5;
export const xCenter = (rect: NormalizedRect): number => rect.x + rect.width * 0.5;

export const verticalOverlapRatio = (left: NormalizedRect, right: NormalizedRect): number => {
  const top = Math.max(left.y, right.y);
  const bottom = Math.min(left.y + left.height, right.y + right.height);

  if (bottom <= top) {
    return 0;
  }

  const overlap = bottom - top;
  const minHeight = Math.min(left.height, right.height);
  if (minHeight <= 0) {
    return 0;
  }

  return overlap / minHeight;
};

export const sortByReadingPoint = (left: { readingOrder: number }, right: { readingOrder: number }) => {
  return left.readingOrder - right.readingOrder;
};
