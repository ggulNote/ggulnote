import { describe, expect, it } from "vitest";
import { resolveVoiceLensPositionDebug } from "./voice-lens-position";

describe("resolveVoiceLensPositionDebug", () => {
  it("reports preferred placement and clamp metadata", () => {
    const result = resolveVoiceLensPositionDebug({
      anchorRect: { x: 90, y: 20, width: 20, height: 20 },
      lensSize: { width: 60, height: 30 },
      safeRect: { x: 0, y: 0, width: 120, height: 80 },
      gap: 8,
    });

    expect(result.anchorType).toBe("frozen-focus");
    expect(result.preferredPlacement).toBe("left");
    expect(result.clampOccurred).toBe(false);
    expect(result.finalScreenPosition).toMatchObject({ x: 22, y: 20 });
  });

  it("reports explicit page visibility fallback", () => {
    const result = resolveVoiceLensPositionDebug({
      lensSize: { width: 60, height: 30 },
      safeRect: { x: 0, y: 0, width: 120, height: 80 },
      gap: 8,
      fallbackReason: "FROZEN_PAGE_NOT_VISIBLE",
    });

    expect(result).toMatchObject({
      anchorType: "fallback",
      preferredPlacement: "bottom-center",
      fallbackReason: "FROZEN_PAGE_NOT_VISIBLE",
    });
  });

  it("classifies invalid and offscreen bounds", () => {
    expect(resolveVoiceLensPositionDebug({
      anchorRect: { x: 10, y: 10, width: 0, height: 20 },
      lensSize: { width: 60, height: 30 },
      safeRect: { x: 0, y: 0, width: 120, height: 80 },
      gap: 8,
    }).fallbackReason).toBe("INVALID_BOUNDS");

    expect(resolveVoiceLensPositionDebug({
      anchorRect: { x: 500, y: 500, width: 20, height: 20 },
      lensSize: { width: 60, height: 30 },
      safeRect: { x: 0, y: 0, width: 120, height: 80 },
      gap: 8,
    }).fallbackReason).toBe("FOCUS_OFFSCREEN");
  });
});
