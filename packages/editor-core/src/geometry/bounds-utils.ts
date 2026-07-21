import type { NormalizedPoint, NormalizedRect, Size } from "@ggulnote/shared-types";

export const normalizeTolerancePx = (pageSize: Size, tolerancePx: number): number => {
  if (!Number.isFinite(tolerancePx) || tolerancePx <= 0) {
    return 0;
  }

  const maxSide = Math.max(pageSize.width, pageSize.height, 1);
  return Math.min(0.05, Math.max(0.002, tolerancePx / maxSide));
};

export const distance = (a: NormalizedPoint, b: NormalizedPoint): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
};

export const distanceToSegment = (
  point: NormalizedPoint,
  start: NormalizedPoint,
  end: NormalizedPoint,
): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (!Number.isFinite(lengthSquared) || lengthSquared === 0) {
    return distance(point, start);
  }

  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const clampedT = Math.min(1, Math.max(0, t));

  const projection = {
    x: start.x + clampedT * dx,
    y: start.y + clampedT * dy,
  };

  return distance(point, projection);
};

export const isPointInRect = (point: NormalizedPoint, rect: NormalizedRect): boolean => {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
};

export const isPointNearRect = (
  point: NormalizedPoint,
  rect: NormalizedRect,
  tolerance: number,
): boolean => {
  const expanded = {
    x: rect.x - tolerance,
    y: rect.y - tolerance,
    width: rect.width + tolerance * 2,
    height: rect.height + tolerance * 2,
  };

  return isPointInRect(point, expanded);
};

export const isPointNearLineSegment = (
  point: NormalizedPoint,
  start: NormalizedPoint,
  end: NormalizedPoint,
  tolerance: number,
): boolean => distanceToSegment(point, start, end) <= tolerance;

export const lineAngle = (start: NormalizedPoint, end: NormalizedPoint): number => {
  return Math.atan2(end.y - start.y, end.x - start.x);
};
