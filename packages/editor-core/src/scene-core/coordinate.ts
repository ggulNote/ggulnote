import type { Point, Rect, Size } from "@ggulnote/shared-types";

export interface CanonicalPageDimensions {
  width: number;
  height: number;
}

export interface ScreenViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

const isFiniteNumber = (value: number): value is number =>
  Number.isFinite(value);

const sanitize = (value: number): number => (isFiniteNumber(value) ? value : 0);

const normalizeNonNegative = (value: number): number => {
  return sanitize(value) < 0 ? 0 : sanitize(value);
};

const normalizeSize = (size: Size): Size => ({
  width: Math.max(0, sanitize(size.width)),
  height: Math.max(0, sanitize(size.height)),
});

const isPositiveSize = (size: Size): boolean =>
  isFiniteNumber(size.width) && isFiniteNumber(size.height) && size.width > 0 && size.height > 0;

const toFinitePoint = (point: Point): Point => ({
  x: sanitize(point.x),
  y: sanitize(point.y),
});

const cloneRect = (rect: Rect): Rect => ({ ...rect });

export const normalizeRect = (rect: Rect): Rect => {
  const normalized = {
    x: sanitize(rect.x),
    y: sanitize(rect.y),
    width: normalizeNonNegative(rect.width),
    height: normalizeNonNegative(rect.height),
  };
  if (normalized.width >= 0 && normalized.height >= 0) {
    return normalized;
  }

  const width = normalized.width;
  const height = normalized.height;
  const next = { ...normalized };
  if (width < 0) {
    next.x = next.x - width;
    next.width = -width;
  }

  if (height < 0) {
    next.y = next.y - height;
    next.height = -height;
  }

  return next;
};

export const screenPointToPagePoint = (
  point: Point,
  viewport: ScreenViewport,
  zoom = 1,
): Point => {
  const safeZoom = isFiniteNumber(zoom) && zoom > 0 ? zoom : 1;
  const safeViewport = normalizeViewport(viewport);
  const safePoint = toFinitePoint(point);

  if (safeViewport.width <= 0 || safeViewport.height <= 0 || safeZoom <= 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: (safePoint.x - safeViewport.x) / (safeViewport.width * safeZoom),
    y: (safePoint.y - safeViewport.y) / (safeViewport.height * safeZoom),
  };
};

export const pagePointToScreenPoint = (
  point: Point,
  viewport: ScreenViewport,
  zoom = 1,
): Point => {
  const safeZoom = isFiniteNumber(zoom) && zoom > 0 ? zoom : 1;
  const safeViewport = normalizeViewport(viewport);
  const safePoint = toFinitePoint(point);
  return {
    x: safeViewport.x + safePoint.x * safeViewport.width * safeZoom,
    y: safeViewport.y + safePoint.y * safeViewport.height * safeZoom,
  };
};

export const screenRectToPageRect = (
  rect: Rect,
  viewport: ScreenViewport,
  zoom = 1,
): Rect => {
  const normalized = normalizeRect(rect);
  const topLeft = screenPointToPagePoint(
    { x: normalized.x, y: normalized.y },
    viewport,
    zoom,
  );
  const bottomRight = screenPointToPagePoint(
    { x: normalized.x + normalized.width, y: normalized.y + normalized.height },
    viewport,
    zoom,
  );
  return normalizeRect({
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  });
};

export const pageRectToScreenRect = (
  rect: Rect,
  viewport: ScreenViewport,
  zoom = 1,
): Rect => {
  const normalized = normalizeRect(rect);
  const topLeft = pagePointToScreenPoint(
    { x: normalized.x, y: normalized.y },
    viewport,
    zoom,
  );
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(0, normalized.width * viewport.width * zoom),
    height: Math.max(0, normalized.height * viewport.height * zoom),
  };
};

export const clampRectToPage = (
  rect: Rect,
  page: CanonicalPageDimensions,
): Rect => {
  const safeRect = normalizeRect(rect);
  const safePage = normalizeSize(page);

  if (!isPositiveSize(safePage)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const clampedWidth = Math.min(safeRect.width, safePage.width);
  const clampedHeight = Math.min(safeRect.height, safePage.height);

  let x = safeRect.x;
  let y = safeRect.y;

  if (x < 0) {
    x = 0;
  }
  if (y < 0) {
    y = 0;
  }

  if (x + clampedWidth > safePage.width) {
    x = Math.max(0, safePage.width - clampedWidth);
  }
  if (y + clampedHeight > safePage.height) {
    y = Math.max(0, safePage.height - clampedHeight);
  }

  return cloneRect({
    x,
    y,
    width: clampedWidth,
    height: clampedHeight,
  });
};

export const normalizedToCanonicalRect = (
  normalized: Rect,
  page: CanonicalPageDimensions,
): Rect => {
  const safePage = normalizeSize(page);
  const safeRect = normalizeRect(normalized);

  if (!isPositiveSize(safePage)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const clampedNormalized = clampRectToNormalized(safeRect);

  return {
    x: clampedNormalized.x * safePage.width,
    y: clampedNormalized.y * safePage.height,
    width: clampedNormalized.width * safePage.width,
    height: clampedNormalized.height * safePage.height,
  };
};

export const canonicalToNormalizedRect = (
  rect: Rect,
  page: CanonicalPageDimensions,
): Rect => {
  const safePage = normalizeSize(page);
  const safeRect = normalizeRect(rect);

  if (!isPositiveSize(safePage)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const clamped = clampRectToPage(safeRect, safePage);

  return {
    x: clamped.x / safePage.width,
    y: clamped.y / safePage.height,
    width: clamped.width / safePage.width,
    height: clamped.height / safePage.height,
  };
};

const clampRectToNormalized = (rect: Rect): Rect => {
  return {
    x: clamp01(rect.x),
    y: clamp01(rect.y),
    width: clamp01(rect.width),
    height: clamp01(rect.height),
  };
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, sanitize(value)));

const normalizeViewport = (viewport: ScreenViewport): ScreenViewport => ({
  x: sanitize(viewport.x),
  y: sanitize(viewport.y),
  width: normalizeNonNegative(viewport.width),
  height: normalizeNonNegative(viewport.height),
});
