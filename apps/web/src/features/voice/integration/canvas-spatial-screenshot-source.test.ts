import { describe, expect, it, vi } from "vitest";
import type { SpatialSceneSnapshot } from "../domain";
import { CanvasSpatialScreenshotSource } from "./canvas-spatial-screenshot-source";

const IMAGE = "data:image/png;base64,AA==";

function snapshot(mode: "PDF" | "BLANK" = "PDF"): SpatialSceneSnapshot {
  return {
    snapshotId: "snapshot-1",
    pageId: "page-1",
    sceneRevision: 7,
    mode,
    coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
    pageBounds: { x: 0, y: 0, width: 1_000, height: 1_400 },
    editableBounds: { x: 0, y: 0, width: 1_000, height: 1_400 },
    viewportBounds: { x: 0, y: 0, width: 1_000, height: 1_400 },
    objects: [],
    capturedAt: 1,
  };
}

function sourceCanvas(width = 1_000, height = 1_400): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement;
}

function targetCanvas(onEncode?: () => void) {
  const context = {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: "",
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => {
      onEncode?.();
      return IMAGE;
    }),
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

describe("CanvasSpatialScreenshotSource", () => {
  it("composes the existing PDF and Editor canvases on a bounded white canvas", async () => {
    const target = targetCanvas();
    const source = new CanvasSpatialScreenshotSource({
      getBaseCanvas: () => sourceCanvas(),
      getOverlayCanvas: () => sourceCanvas(2_000, 2_800),
      getCurrentPageId: () => "page-1",
      getCurrentSceneRevision: () => 7,
      createCanvas: () => target.canvas,
      now: () => 9,
      maxEdge: 2_048,
    });
    const result = await source.capture({ snapshot: snapshot() });
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(result.screenshot.pixelWidth).toBe(1_463);
    expect(result.screenshot.pixelHeight).toBe(2_048);
    expect(result.screenshot.canonicalPageBounds).toEqual(snapshot().pageBounds);
    expect(target.context.fillRect).toHaveBeenCalledTimes(1);
    expect(target.context.drawImage).toHaveBeenCalledTimes(2);
  });

  it("captures a blank page as white plus the existing Editor overlay", async () => {
    const target = targetCanvas();
    const source = new CanvasSpatialScreenshotSource({
      getBaseCanvas: () => null,
      getOverlayCanvas: () => sourceCanvas(),
      getCurrentPageId: () => "page-1",
      getCurrentSceneRevision: () => 7,
      createCanvas: () => target.canvas,
    });
    const result = await source.capture({ snapshot: snapshot("BLANK") });
    expect(result.status).toBe("READY");
    expect(target.context.drawImage).toHaveBeenCalledTimes(1);
  });

  it("does not pretend an overlay-only PDF capture contains the PDF base", async () => {
    const source = new CanvasSpatialScreenshotSource({
      getBaseCanvas: () => null,
      getOverlayCanvas: () => sourceCanvas(),
      getCurrentPageId: () => "page-1",
      getCurrentSceneRevision: () => 7,
      createCanvas: () => targetCanvas().canvas,
    });
    await expect(source.capture({ snapshot: snapshot("PDF") }))
      .resolves.toEqual({ status: "UNAVAILABLE" });
  });

  it("rejects page/revision changes before or after capture", async () => {
    let revision = 6;
    const sourceBefore = new CanvasSpatialScreenshotSource({
      getBaseCanvas: () => sourceCanvas(),
      getOverlayCanvas: () => null,
      getCurrentPageId: () => "page-1",
      getCurrentSceneRevision: () => revision,
      createCanvas: () => targetCanvas().canvas,
    });
    await expect(sourceBefore.capture({ snapshot: snapshot() }))
      .resolves.toEqual({ status: "STALE_SCENE" });

    revision = 7;
    const target = targetCanvas(() => {
      revision = 8;
    });
    const sourceAfter = new CanvasSpatialScreenshotSource({
      getBaseCanvas: () => sourceCanvas(),
      getOverlayCanvas: () => sourceCanvas(),
      getCurrentPageId: () => "page-1",
      getCurrentSceneRevision: () => revision,
      createCanvas: () => target.canvas,
    });
    await expect(sourceAfter.capture({ snapshot: snapshot() }))
      .resolves.toEqual({ status: "STALE_SCENE" });
  });

  it("normalizes AbortSignal without rendering", async () => {
    const controller = new AbortController();
    controller.abort();
    const createCanvas = vi.fn(() => targetCanvas().canvas);
    const source = new CanvasSpatialScreenshotSource({
      getBaseCanvas: () => sourceCanvas(),
      getOverlayCanvas: () => null,
      getCurrentPageId: () => "page-1",
      getCurrentSceneRevision: () => 7,
      createCanvas,
    });
    await expect(source.capture({ snapshot: snapshot(), signal: controller.signal }))
      .resolves.toEqual({ status: "CANCELLED" });
    expect(createCanvas).not.toHaveBeenCalled();
  });
});
