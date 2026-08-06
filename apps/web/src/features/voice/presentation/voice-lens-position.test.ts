import { describe, expect, it } from "vitest";
import {
  canonicalFocusToScreenRect,
  createVoiceLensSafeRect,
  resolveVoiceLensPosition,
} from "./voice-lens-position";

describe("voice lens position", () => {
  it("converts canonical bounds through the shared page coordinate helpers", () => {
    expect(canonicalFocusToScreenRect(
      { x: 100, y: 200, width: 200, height: 400 },
      { width: 1_000, height: 2_000 },
      { x: 10, y: 20, width: 500, height: 1_000 },
    )).toEqual({
      x: 60,
      y: 120,
      width: 100,
      height: 200,
    });
  });

  it("uses right, left, above, and below in deterministic order", () => {
    const common = {
      lensSize: { width: 80, height: 40 },
      gap: 10,
    };

    expect(resolveVoiceLensPosition({
      ...common,
      anchorRect: { x: 100, y: 100, width: 30, height: 20 },
      safeRect: { x: 0, y: 0, width: 300, height: 240 },
    }).placement).toBe("right");

    expect(resolveVoiceLensPosition({
      ...common,
      anchorRect: { x: 250, y: 100, width: 30, height: 20 },
      safeRect: { x: 0, y: 0, width: 300, height: 240 },
    }).placement).toBe("left");

    expect(resolveVoiceLensPosition({
      ...common,
      anchorRect: { x: 45, y: 100, width: 210, height: 20 },
      safeRect: { x: 0, y: 0, width: 300, height: 240 },
    }).placement).toBe("above");

    expect(resolveVoiceLensPosition({
      ...common,
      anchorRect: { x: 45, y: 10, width: 210, height: 20 },
      safeRect: { x: 0, y: 0, width: 300, height: 240 },
    }).placement).toBe("below");
  });

  it("falls back to bottom center for missing or offscreen focus", () => {
    const missing = resolveVoiceLensPosition({
      lensSize: { width: 100, height: 40 },
      safeRect: { x: 10, y: 20, width: 300, height: 200 },
      gap: 12,
    });
    const offscreen = resolveVoiceLensPosition({
      anchorRect: { x: 500, y: 500, width: 20, height: 20 },
      lensSize: { width: 100, height: 40 },
      safeRect: { x: 10, y: 20, width: 300, height: 200 },
      gap: 12,
    });

    expect(missing).toEqual({
      x: 110,
      y: 180,
      placement: "bottom-center",
      isFallback: true,
    });
    expect(offscreen).toEqual(missing);
  });

  it("clamps to every safe edge and handles zero or oversized lens sizes", () => {
    const clamped = resolveVoiceLensPosition({
      anchorRect: { x: 95, y: 95, width: 10, height: 10 },
      lensSize: { width: 300, height: 200 },
      safeRect: { x: 10, y: 20, width: 100, height: 80 },
      gap: 10,
    });
    expect(clamped.x).toBe(10);
    expect(clamped.y).toBe(20);

    const zero = resolveVoiceLensPosition({
      lensSize: { width: 0, height: 0 },
      safeRect: { x: 10, y: 20, width: 100, height: 80 },
      gap: 10,
    });
    expect(zero).toMatchObject({ x: 60, y: 100, isFallback: true });
  });

  it("reserves viewport and toolbar safe areas", () => {
    expect(createVoiceLensSafeRect({
      viewportWidth: 1_000,
      viewportHeight: 800,
      toolbarBottom: 120,
      margin: 16,
    })).toEqual({
      x: 16,
      y: 136,
      width: 968,
      height: 648,
    });
  });
});
