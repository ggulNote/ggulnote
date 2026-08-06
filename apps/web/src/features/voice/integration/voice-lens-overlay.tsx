"use client";

import type { Rect, Size } from "@ggulnote/editor-core";
import { useCallback, useEffect, useState } from "react";
import type { VoiceTurnController } from "../application";
import { useVoiceTurn } from "../hooks";
import {
  VoiceLens,
  canonicalFocusToScreenRect,
  createVoiceLensSafeRect,
  createVoiceLensViewModel,
  resolveVoiceLensPosition,
  type VoiceLensPosition,
} from "../presentation";

const VOICE_LENS_GAP_PX = 12;
const VOICE_LENS_SAFE_MARGIN_PX = 16;
const DEFAULT_VOICE_LENS_SIZE: Size = { width: 320, height: 80 };

export interface VoiceLensOverlayPage {
  id: string;
  width: number;
  height: number;
}

export interface VoiceLensOverlayProps {
  controller: VoiceTurnController;
  currentPage?: VoiceLensOverlayPage;
  pageElement: HTMLElement | null;
  toolbarElement: HTMLElement | null;
}

export function VoiceLensOverlay({
  controller,
  currentPage,
  pageElement,
  toolbarElement,
}: VoiceLensOverlayProps): React.ReactElement | null {
  const { state } = useVoiceTurn(controller);
  const viewModel = createVoiceLensViewModel(state);
  const frozenContext = viewModel.frozenContext;
  const focusBoundsX = frozenContext?.focusBounds?.x;
  const focusBoundsY = frozenContext?.focusBounds?.y;
  const focusBoundsWidth = frozenContext?.focusBounds?.width;
  const focusBoundsHeight = frozenContext?.focusBounds?.height;
  const [lensElement, setLensElement] = useState<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<VoiceLensPosition | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setLayoutVersion((value) => value + 1);
      });
    };
    const eventOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, eventOptions);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(schedule);
    if (pageElement) observer?.observe(pageElement);
    if (toolbarElement) observer?.observe(toolbarElement);
    if (lensElement) observer?.observe(lensElement);
    schedule();

    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, eventOptions);
      observer?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [lensElement, pageElement, toolbarElement]);

  useEffect(() => {
    if (viewModel.state === "hidden" || typeof window === "undefined") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const toolbarRect = toolbarElement?.getBoundingClientRect();
      const safeRect = createVoiceLensSafeRect({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        toolbarBottom: toolbarRect?.bottom,
        margin: VOICE_LENS_SAFE_MARGIN_PX,
      });
      const lensRect = lensElement?.getBoundingClientRect();
      const lensSize = readLensSize(lensRect);
      const anchorRect = resolveAnchorRect({
        frozenPageId: frozenContext?.pageId,
        focusBounds: focusBoundsX !== undefined
          && focusBoundsY !== undefined
          && focusBoundsWidth !== undefined
          && focusBoundsHeight !== undefined
          ? {
              x: focusBoundsX,
              y: focusBoundsY,
              width: focusBoundsWidth,
              height: focusBoundsHeight,
            }
          : undefined,
        focusStale: frozenContext?.focusStale ?? false,
        currentPage,
        pageElement,
      });
      setPosition(resolveVoiceLensPosition({
        ...(anchorRect ? { anchorRect } : {}),
        lensSize,
        safeRect,
        gap: VOICE_LENS_GAP_PX,
      }));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    currentPage,
    focusBoundsHeight,
    focusBoundsWidth,
    focusBoundsX,
    focusBoundsY,
    frozenContext?.focusStale,
    frozenContext?.pageId,
    layoutVersion,
    lensElement,
    pageElement,
    toolbarElement,
    viewModel.state,
  ]);

  const handleLensRef = useCallback((element: HTMLDivElement | null) => {
    setLensElement(element);
  }, []);

  return (
    <VoiceLens
      viewModel={viewModel}
      position={position}
      lensRef={handleLensRef}
    />
  );
}

interface ResolveAnchorRectInput {
  frozenPageId?: string;
  focusBounds?: Rect;
  focusStale: boolean;
  currentPage?: VoiceLensOverlayPage;
  pageElement: HTMLElement | null;
}

function resolveAnchorRect(
  input: ResolveAnchorRectInput,
): Rect | undefined {
  if (
    !input.frozenPageId
    || !input.focusBounds
    || input.focusStale
    || !input.currentPage
    || input.currentPage.id !== input.frozenPageId
    || !input.pageElement
  ) {
    return undefined;
  }
  if (
    input.currentPage.width <= 0
    || input.currentPage.height <= 0
  ) {
    return undefined;
  }

  const pageRect = input.pageElement.getBoundingClientRect();
  return canonicalFocusToScreenRect(
    input.focusBounds,
    {
      width: input.currentPage.width,
      height: input.currentPage.height,
    },
    {
      x: pageRect.left,
      y: pageRect.top,
      width: pageRect.width,
      height: pageRect.height,
    },
  );
}

function readLensSize(rect: DOMRect | undefined): Size {
  if (
    rect
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0
  ) {
    return { width: rect.width, height: rect.height };
  }
  return { ...DEFAULT_VOICE_LENS_SIZE };
}
