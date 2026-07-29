import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toViewportRect, useViewportRect } from "./use-viewport-rect";

let resizeCallback: ResizeObserverCallback | null;
let animationFrames: Map<number, FrameRequestCallback>;
let nextFrameId: number;
const observe = vi.fn();
const disconnect = vi.fn();

class MockResizeObserver implements ResizeObserver {
  public constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
  public observe = observe;
  public unobserve = vi.fn();
  public disconnect = disconnect;
}

beforeEach(() => {
  resizeCallback = null;
  animationFrames = new Map();
  nextFrameId = 1;
  observe.mockClear();
  disconnect.mockClear();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    animationFrames.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
    animationFrames.delete(id);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function createElement(rect: DOMRect): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = vi.fn(() => rect);
  return element;
}

function flushFrame(): void {
  const entry = animationFrames.entries().next().value;
  if (entry === undefined) {
    throw new Error("Expected a scheduled viewport measurement.");
  }
  const [id, callback] = entry;
  animationFrames.delete(id);
  act(() => callback(16));
}

describe("useViewportRect", () => {
  it("starts without a rect", () => {
    const hook = renderHook(useViewportRect);
    expect(hook.result.current.viewportRect).toBeNull();
  });

  it("measures an attached PDF viewport in CSS pixels", () => {
    const hook = renderHook(useViewportRect);
    const element = createElement(DOMRect.fromRect({ x: 25, y: 40, width: 640, height: 480 }));
    act(() => hook.result.current.elementRef(element));
    expect(hook.result.current.viewportRect).toEqual({ left: 25, top: 40, width: 640, height: 480 });
    expect(observe).toHaveBeenCalledWith(element);
  });

  it("updates width and height after ResizeObserver notification", () => {
    const hook = renderHook(useViewportRect);
    const element = createElement(DOMRect.fromRect({ x: 10, y: 20, width: 500, height: 300 }));
    act(() => hook.result.current.elementRef(element));
    element.getBoundingClientRect = vi.fn(() => DOMRect.fromRect({ x: 10, y: 20, width: 700, height: 450 }));
    act(() => resizeCallback?.([], new MockResizeObserver(() => undefined)));
    flushFrame();
    expect(hook.result.current.viewportRect).toEqual({ left: 10, top: 20, width: 700, height: 450 });
  });

  it("updates left and top after a captured scroll event", () => {
    const hook = renderHook(useViewportRect);
    const element = createElement(DOMRect.fromRect({ x: 10, y: 20, width: 500, height: 300 }));
    act(() => hook.result.current.elementRef(element));
    element.getBoundingClientRect = vi.fn(() => DOMRect.fromRect({ x: -15, y: 75, width: 500, height: 300 }));
    act(() => window.dispatchEvent(new Event("scroll")));
    flushFrame();
    expect(hook.result.current.viewportRect).toEqual({ left: -15, top: 75, width: 500, height: 300 });
  });

  it("retains the same snapshot for duplicate measurements", () => {
    const hook = renderHook(useViewportRect);
    const element = createElement(DOMRect.fromRect({ x: 10, y: 20, width: 500, height: 300 }));
    act(() => hook.result.current.elementRef(element));
    const first = hook.result.current.viewportRect;
    act(() => resizeCallback?.([], new MockResizeObserver(() => undefined)));
    flushFrame();
    expect(hook.result.current.viewportRect).toBe(first);
  });

  it("disconnects observers, removes listeners, and cancels pending RAF", () => {
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const hook = renderHook(useViewportRect);
    const element = createElement(DOMRect.fromRect({ x: 10, y: 20, width: 500, height: 300 }));
    act(() => hook.result.current.elementRef(element));
    act(() => resizeCallback?.([], new MockResizeObserver(() => undefined)));
    hook.unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("rejects invalid DOM rects", () => {
    expect(toViewportRect(DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 100 }))).toBeNull();
    expect(toViewportRect(DOMRect.fromRect({ x: 0, y: 0, width: 100, height: 0 }))).toBeNull();
  });
});
