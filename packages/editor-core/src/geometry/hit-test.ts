import type { NormalizedPoint, NormalizedRect, Size } from "@ggulnote/shared-types";
import {
  distanceToSegment,
  isPointNearRect,
  isPointInRect,
  lineAngle,
  normalizeTolerancePx,
} from "./bounds-utils";

export const DEFAULT_HIT_TOLERANCE_PX = 10;

export const hitTestRect = (
  point: NormalizedPoint,
  rect: NormalizedRect,
  pageSize: Size,
): boolean => {
  return isPointNearRect(point, rect, normalizeTolerancePx(pageSize, DEFAULT_HIT_TOLERANCE_PX));
};

export const hitTestLineSegment = (
  point: NormalizedPoint,
  start: NormalizedPoint,
  end: NormalizedPoint,
  pageSize: Size,
): boolean => {
  const tolerance = normalizeTolerancePx(pageSize, DEFAULT_HIT_TOLERANCE_PX);
  return distanceToSegment(point, start, end) <= tolerance;
};

export const hitTestArrowHead = (
  point: NormalizedPoint,
  start: NormalizedPoint,
  end: NormalizedPoint,
  pageSize: Size,
): boolean => {
  const tolerance = normalizeTolerancePx(pageSize, DEFAULT_HIT_TOLERANCE_PX);
  const angle = lineAngle(start, end);
  const headLength = 0.025;
  const halfSpread = Math.PI / 6;

  const head = [
    {
      x: end.x - headLength * Math.cos(angle - halfSpread),
      y: end.y - headLength * Math.sin(angle - halfSpread),
    },
    {
      x: end.x - headLength * Math.cos(angle + halfSpread),
      y: end.y - headLength * Math.sin(angle + halfSpread),
    },
  ];

  return (
    isPointNearRect(point, { x: end.x - tolerance, y: end.y - tolerance, width: tolerance * 2, height: tolerance * 2 }, tolerance) ||
    isPointNearTriangle(point, end, head[0], head[1], tolerance)
  );
};

const cross = (a: NormalizedPoint, b: NormalizedPoint): number => a.x * b.y - a.y * b.x;

const isPointNearTriangle = (
  point: NormalizedPoint,
  a: NormalizedPoint,
  b: NormalizedPoint,
  c: NormalizedPoint,
  tolerance: number,
): boolean => {
  const v0 = { x: b.x - a.x, y: b.y - a.y };
  const v1 = { x: c.x - a.x, y: c.y - a.y };
  const v2 = { x: point.x - a.x, y: point.y - a.y };

  const den = cross(v0, v1);
  if (den === 0) {
    return false;
  }

  const alpha = cross(v2, v1) / den;
  const beta = cross(v0, v2) / den;
  const gamma = 1 - alpha - beta;

  if (alpha < -tolerance || beta < -tolerance || gamma < -tolerance) {
    return false;
  }

  return alpha <= 1 + tolerance && beta <= 1 + tolerance && gamma <= 1 + tolerance;
};
