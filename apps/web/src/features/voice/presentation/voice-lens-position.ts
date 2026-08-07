import {
  canonicalToNormalizedRect,
  pageRectToScreenRect,
  type CanonicalPageDimensions,
  type Rect,
  type ScreenViewport,
  type Size,
} from "@ggulnote/editor-core";

export type VoiceLensPlacement =
  | "right"
  | "left"
  | "above"
  | "below"
  | "bottom-center";

export interface VoiceLensPosition {
  x: number;
  y: number;
  placement: VoiceLensPlacement;
  isFallback: boolean;
}

export interface VoiceLensPositionInput {
  anchorRect?: Rect;
  lensSize: Size;
  safeRect: Rect;
  gap: number;
}

export interface VoiceLensSafeRectInput {
  viewportWidth: number;
  viewportHeight: number;
  toolbarBottom?: number;
  margin: number;
}

export type VoiceLensFallbackReason =
  | "NO_FROZEN_FOCUS"
  | "FROZEN_PAGE_NOT_VISIBLE"
  | "FOCUS_OFFSCREEN"
  | "INVALID_BOUNDS";

export interface VoiceLensPositionDebugInput extends VoiceLensPositionInput {
  fallbackReason?: VoiceLensFallbackReason;
}

export interface VoiceLensPositionDebugMetadata {
  anchorType: "frozen-focus" | "fallback";
  preferredPlacement: VoiceLensPlacement;
  anchorScreenRect?: Rect;
  lensSize: Size;
  safeRect: Rect;
  finalScreenPosition: Rect;
  clampOccurred: boolean;
  fallbackReason?: VoiceLensFallbackReason;
}

export function canonicalFocusToScreenRect(
  bounds: Rect,
  page: CanonicalPageDimensions,
  viewport: ScreenViewport,
): Rect {
  const normalized = canonicalToNormalizedRect(bounds, page);
  return pageRectToScreenRect(normalized, viewport);
}

export function createVoiceLensSafeRect(
  input: VoiceLensSafeRectInput,
): Rect {
  const margin = finiteNonNegative(input.margin);
  const viewportWidth = finiteNonNegative(input.viewportWidth);
  const viewportHeight = finiteNonNegative(input.viewportHeight);
  const toolbarBottom = Number.isFinite(input.toolbarBottom)
    ? Math.max(0, input.toolbarBottom ?? 0)
    : 0;
  const x = Math.min(margin, viewportWidth);
  const y = Math.min(
    Math.max(margin, toolbarBottom + margin),
    viewportHeight,
  );

  return {
    x,
    y,
    width: Math.max(0, viewportWidth - x - margin),
    height: Math.max(0, viewportHeight - y - margin),
  };
}

export function resolveVoiceLensPosition(
  input: VoiceLensPositionInput,
): VoiceLensPosition {
  const safeRect = normalizeRect(input.safeRect);
  const lensSize = {
    width: finiteNonNegative(input.lensSize.width),
    height: finiteNonNegative(input.lensSize.height),
  };
  const gap = finiteNonNegative(input.gap);
  const anchor = input.anchorRect
    ? normalizeRect(input.anchorRect)
    : undefined;

  if (!anchor || !rectsIntersect(anchor, safeRect)) {
    return resolveBottomCenter(lensSize, safeRect);
  }

  const candidates: Array<Omit<VoiceLensPosition, "isFallback">> = [
    {
      placement: "right",
      x: anchor.x + anchor.width + gap,
      y: anchor.y,
    },
    {
      placement: "left",
      x: anchor.x - lensSize.width - gap,
      y: anchor.y,
    },
    {
      placement: "above",
      x: anchor.x + (anchor.width - lensSize.width) / 2,
      y: anchor.y - lensSize.height - gap,
    },
    {
      placement: "below",
      x: anchor.x + (anchor.width - lensSize.width) / 2,
      y: anchor.y + anchor.height + gap,
    },
  ];

  const fitting = candidates.find((candidate) =>
    fitsInRect(candidate.x, candidate.y, lensSize, safeRect),
  );
  const preferred = fitting ?? candidates[0];

  return {
    x: clampAxis(
      preferred.x,
      safeRect.x,
      safeRect.x + Math.max(0, safeRect.width - lensSize.width),
    ),
    y: clampAxis(
      preferred.y,
      safeRect.y,
      safeRect.y + Math.max(0, safeRect.height - lensSize.height),
    ),
    placement: preferred.placement,
    isFallback: false,
  };
}

export function resolveVoiceLensPositionDebug(
  input: VoiceLensPositionDebugInput,
): VoiceLensPositionDebugMetadata {
  const safeRect = normalizeRect(input.safeRect);
  const lensSize = {
    width: finiteNonNegative(input.lensSize.width),
    height: finiteNonNegative(input.lensSize.height),
  };
  const anchor = input.anchorRect ? normalizeRect(input.anchorRect) : undefined;
  const hasValidAnchor = anchor !== undefined && anchor.width > 0 && anchor.height > 0;
  const anchorIsVisible = hasValidAnchor && rectsIntersect(anchor, safeRect);
  const forcedFallback = input.fallbackReason !== undefined;
  const resolved = resolveVoiceLensPosition({
    ...input,
    anchorRect: forcedFallback || !anchorIsVisible ? undefined : anchor,
  });
  const fallbackReason = forcedFallback
    ? input.fallbackReason
    : !anchor
      ? "NO_FROZEN_FOCUS"
      : !hasValidAnchor
        ? "INVALID_BOUNDS"
        : !anchorIsVisible
          ? "FOCUS_OFFSCREEN"
          : undefined;
  const preferred = anchorIsVisible && !forcedFallback
    ? resolvePreferredCandidate(anchor, lensSize, safeRect, finiteNonNegative(input.gap))
    : { x: resolved.x, y: resolved.y, placement: resolved.placement };

  return {
    anchorType: resolved.isFallback ? "fallback" : "frozen-focus",
    preferredPlacement: preferred.placement,
    ...(anchor ? { anchorScreenRect: { ...anchor } } : {}),
    lensSize,
    safeRect,
    finalScreenPosition: {
      x: resolved.x,
      y: resolved.y,
      width: lensSize.width,
      height: lensSize.height,
    },
    clampOccurred: preferred.x !== resolved.x || preferred.y !== resolved.y,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

function resolvePreferredCandidate(
  anchor: Rect,
  lensSize: Size,
  safeRect: Rect,
  gap: number,
): { x: number; y: number; placement: VoiceLensPlacement } {
  const candidates: Array<{ x: number; y: number; placement: VoiceLensPlacement }> = [
    { placement: "right", x: anchor.x + anchor.width + gap, y: anchor.y },
    { placement: "left", x: anchor.x - lensSize.width - gap, y: anchor.y },
    {
      placement: "above",
      x: anchor.x + (anchor.width - lensSize.width) / 2,
      y: anchor.y - lensSize.height - gap,
    },
    {
      placement: "below",
      x: anchor.x + (anchor.width - lensSize.width) / 2,
      y: anchor.y + anchor.height + gap,
    },
  ];
  return candidates.find((candidate) => fitsInRect(
    candidate.x,
    candidate.y,
    lensSize,
    safeRect,
  )) ?? candidates[0];
}

function resolveBottomCenter(
  lensSize: Size,
  safeRect: Rect,
): VoiceLensPosition {
  const x = safeRect.x + (safeRect.width - lensSize.width) / 2;
  const y = safeRect.y + safeRect.height - lensSize.height;
  return {
    x: clampAxis(
      x,
      safeRect.x,
      safeRect.x + Math.max(0, safeRect.width - lensSize.width),
    ),
    y: clampAxis(
      y,
      safeRect.y,
      safeRect.y + Math.max(0, safeRect.height - lensSize.height),
    ),
    placement: "bottom-center",
    isFallback: true,
  };
}

function fitsInRect(
  x: number,
  y: number,
  size: Size,
  container: Rect,
): boolean {
  return x >= container.x
    && y >= container.y
    && x + size.width <= container.x + container.width
    && y + size.height <= container.y + container.height;
}

function rectsIntersect(left: Rect, right: Rect): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function normalizeRect(rect: Rect): Rect {
  return {
    x: finite(rect.x),
    y: finite(rect.y),
    width: finiteNonNegative(rect.width),
    height: finiteNonNegative(rect.height),
  };
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteNonNegative(value: number): number {
  return Math.max(0, finite(value));
}

function clampAxis(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, finite(value)));
}
