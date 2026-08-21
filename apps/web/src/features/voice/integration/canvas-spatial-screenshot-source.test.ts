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
    save: vi.fn(),
    restore: vi.fn(),
    strokeRect: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    fillText: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textBaseline: "alphabetic",
    lineWidth: 1,
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

  it("captures an empty blank page as an agent-only white scene", async () => {
    const target = targetCanvas();
    const source = new CanvasSpatialScreenshotSource({
      getBaseCanvas: () => null,
      getOverlayCanvas: () => null,
      getCurrentPageId: () => "page-1",
      getCurrentSceneRevision: () => 7,
      createCanvas: () => target.canvas,
    });

    const result = await source.capture({ snapshot: snapshot("BLANK") });

    expect(result.status).toBe("READY");
    expect(target.context.fillRect).toHaveBeenCalledOnce();
    expect(target.context.drawImage).not.toHaveBeenCalled();
  });

  it("draws and returns the exact catalog handle on the offscreen screenshot", async () => {
    const target = targetCanvas();
    const source = new CanvasSpatialScreenshotSource({
      getBaseCanvas: () => sourceCanvas(),
      getOverlayCanvas: () => null,
      getCurrentPageId: () => "page-1",
      getCurrentSceneRevision: () => 7,
      createCanvas: () => target.canvas,
    });
    const marker = {
      id: "O7",
      kind: "IMAGE",
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    } as const;

    const result = await source.capture({ snapshot: snapshot(), markers: [marker] });

    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(result.screenshot.markers).toEqual([marker]);
    expect(target.context.strokeRect).toHaveBeenCalledWith(
      result.screenshot.pixelWidth * 0.1,
      result.screenshot.pixelHeight * 0.2,
      result.screenshot.pixelWidth * 0.3,
      result.screenshot.pixelHeight * 0.4,
    );
    expect(target.context.fillText).toHaveBeenCalledWith(
      "[O7]",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("composes a full-page tldraw export when the legacy overlay canvas is absent", async () => {
    const target = targetCanvas();
    const tldrawImage = { width: 1_000, height: 1_400 } as CanvasImageSource;
    const source = new CanvasSpatialScreenshotSource({
      getBaseCanvas: () => null,
      getOverlayCanvas: () => null,
      getTldrawOverlay: async () => ({
        imageDataUrl: IMAGE,
        pixelWidth: 1_000,
        pixelHeight: 1_400,
      }),
      getCurrentPageId: () => "page-1",
      getCurrentSceneRevision: () => 7,
      createCanvas: () => target.canvas,
      loadImage: async () => tldrawImage,
    });

    const result = await source.capture({ snapshot: snapshot("BLANK") });

    expect(result.status).toBe("READY");
    expect(target.context.drawImage).toHaveBeenCalledWith(
      tldrawImage,
      0,
      0,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("degrades an unavailable tldraw export without throwing", async () => {
    const source = new CanvasSpatialScreenshotSource({
      getBaseCanvas: () => null,
      getOverlayCanvas: () => null,
      getTldrawOverlay: async () => {
        throw new Error("export failed");
      },
      getCurrentPageId: () => "page-1",
      getCurrentSceneRevision: () => 7,
      createCanvas: () => targetCanvas().canvas,
    });

    await expect(source.capture({ snapshot: snapshot("BLANK") }))
      .resolves.toMatchObject({ status: "UNAVAILABLE" });
  });

  it("bounds a stalled visual export and degrades to unavailable", async () => {
    const source = new CanvasSpatialScreenshotSource({
      getBaseCanvas: () => null,
      getOverlayCanvas: () => null,
      getTldrawOverlay: () => new Promise(() => undefined),
      getCurrentPageId: () => "page-1",
      getCurrentSceneRevision: () => 7,
      createCanvas: () => targetCanvas().canvas,
      captureTimeoutMs: 5,
    });

    await expect(source.capture({ snapshot: snapshot("BLANK") }))
      .resolves.toMatchObject({ status: "UNAVAILABLE" });
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
