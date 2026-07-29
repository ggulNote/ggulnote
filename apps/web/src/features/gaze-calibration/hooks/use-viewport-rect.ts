"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ViewportRect } from "../domain/calibration-types";

export type UseViewportRectResult = Readonly<{
  readonly viewportRect: ViewportRect | null;
  readonly elementRef: (element: HTMLElement | null) => void;
}>;

/**
 * Measures a rendered viewport in browser CSS pixels. DOM reads are limited to
 * attachment, ResizeObserver notifications, window resize, and captured scroll
 * events, with event bursts collapsed into one animation frame.
 */
export function useViewportRect(): UseViewportRectResult {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [viewportRect, setViewportRect] = useState<ViewportRect | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const elementRef = useCallback((nextElement: HTMLElement | null): void => {
    setElement((currentElement) =>
      currentElement === nextElement ? currentElement : nextElement);
    if (nextElement === null) {
      setViewportRect((current) => current === null ? current : null);
    }
  }, []);

  useEffect(() => {
    if (element === null) {
      return;
    }

    const measure = (): void => {
      animationFrameRef.current = null;
      const nextRect = toViewportRect(element.getBoundingClientRect());
      setViewportRect((current) =>
        areViewportRectsEqual(current, nextRect) ? current : nextRect);
    };
    const scheduleMeasure = (): void => {
      if (animationFrameRef.current !== null) {
        return;
      }
      animationFrameRef.current = window.requestAnimationFrame(measure);
    };

    measure();

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(element);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [element]);

  return { viewportRect, elementRef };
}

export function toViewportRect(rect: DOMRectReadOnly): ViewportRect | null {
  if (
    !Number.isFinite(rect.left)
    || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
    || rect.width <= 0
    || rect.height <= 0
  ) {
    return null;
  }

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function areViewportRectsEqual(
  left: ViewportRect | null,
  right: ViewportRect | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  return left.left === right.left
    && left.top === right.top
    && left.width === right.width
    && left.height === right.height;
}
