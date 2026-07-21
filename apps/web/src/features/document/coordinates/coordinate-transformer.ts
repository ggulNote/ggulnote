import type { NormalizedPoint, NormalizedRect } from "../model/document-types";
import type { DOMRectLike } from "./coordinate-types";

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

export function clientPointToNormalized(
  clientPoint: { x: number; y: number },
  pageRect: DOMRectLike,
): NormalizedPoint | null {
  if (!isFiniteNumber(clientPoint.x) || !isFiniteNumber(clientPoint.y)) {
    return null;
  }

  if (!isFiniteNumber(pageRect.width) || !isFiniteNumber(pageRect.height)) {
    return null;
  }

  if (pageRect.width <= 0 || pageRect.height <= 0) {
    return null;
  }

  const rawX = (clientPoint.x - pageRect.left) / pageRect.width;
  const rawY = (clientPoint.y - pageRect.top) / pageRect.height;

  if (!isFiniteNumber(rawX) || !isFiniteNumber(rawY)) {
    return null;
  }

  if (rawX < 0 || rawX > 1 || rawY < 0 || rawY > 1) {
    return null;
  }

  return {
    x: clamp(rawX),
    y: clamp(rawY),
  };
}

export function normalizedPointToCss(
  point: NormalizedPoint,
  pageSize: { width: number; height: number },
): { x: number; y: number } {
  if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
    return { x: 0, y: 0 };
  }

  if (!isFiniteNumber(pageSize.width) || !isFiniteNumber(pageSize.height)) {
    return { x: 0, y: 0 };
  }

  if (pageSize.width <= 0 || pageSize.height <= 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: clamp(point.x) * pageSize.width,
    y: clamp(point.y) * pageSize.height,
  };
}

export function normalizedRectToCss(
  rect: NormalizedRect,
  pageSize: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  if (!isFiniteNumber(rect.width) || !isFiniteNumber(rect.height)) {
    return {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };
  }

  if (!isFiniteNumber(pageSize.width) || !isFiniteNumber(pageSize.height)) {
    return {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };
  }

  if (pageSize.width <= 0 || pageSize.height <= 0) {
    return {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };
  }

  const x = clamp(rect.x);
  const y = clamp(rect.y);
  const width = clamp(rect.width);
  const height = clamp(rect.height);

  return {
    left: x * pageSize.width,
    top: y * pageSize.height,
    width: width * pageSize.width,
    height: height * pageSize.height,
  };
}
