import { buildCompositeRenderSnapshot, type Rect } from "@ggulnote/editor-core";
import type {
  SpatialScreenshotSource,
  SpatialScreenshotSourceResult,
} from "../application";

export const MAX_SPATIAL_SCREENSHOT_EDGE = 2_048;

export interface CanvasSpatialScreenshotSourceOptions {
  readonly getBaseCanvas: () => HTMLCanvasElement | null;
  readonly getOverlayCanvas: () => HTMLCanvasElement | null;
  readonly getCurrentPageId: () => string | undefined;
  readonly getCurrentSceneRevision: () => number;
  readonly createCanvas?: () => HTMLCanvasElement;
  readonly now?: () => number;
  readonly maxEdge?: number;
}

/**
 * Thin adapter over the existing PDF base and Editor overlay canvases.
 * It does not render scene objects itself and never exposes screenshot pixels
 * as executable geometry.
 */
export class CanvasSpatialScreenshotSource implements SpatialScreenshotSource {
  private readonly createCanvas: () => HTMLCanvasElement;
  private readonly now: () => number;
  private readonly maxEdge: number;

  public constructor(private readonly options: CanvasSpatialScreenshotSourceOptions) {
    this.createCanvas = options.createCanvas
      ?? (() => document.createElement("canvas"));
    this.now = options.now ?? Date.now;
    this.maxEdge = normalizeMaximumEdge(options.maxEdge);
  }

  public async capture(
    input: Parameters<SpatialScreenshotSource["capture"]>[0],
  ): Promise<SpatialScreenshotSourceResult> {
    if (input.signal?.aborted) return { status: "CANCELLED" };
    if (!this.isCurrent(input.snapshot.pageId, input.snapshot.sceneRevision)) {
      return { status: "STALE_SCENE" };
    }

    const baseCanvas = this.options.getBaseCanvas();
    const overlayCanvas = this.options.getOverlayCanvas();
    if (!isRenderableCanvas(overlayCanvas)
      || input.snapshot.mode === "PDF" && !isRenderableCanvas(baseCanvas)) {
      return { status: "UNAVAILABLE" };
    }

    const pageBounds = input.snapshot.pageBounds;
    const pixelSize = capturePixelSize(
      pageBounds,
      [baseCanvas, overlayCanvas],
      this.maxEdge,
    );
    let renderedPixelWidth = pixelSize.width;
    let renderedPixelHeight = pixelSize.height;

    const result = await buildCompositeRenderSnapshot({
      pageId: input.snapshot.pageId,
      page: {
        id: input.snapshot.pageId,
        index: 0,
        width: pageBounds.width,
        height: pageBounds.height,
      },
      sceneRevision: input.snapshot.sceneRevision,
      getCurrentSceneRevision: this.options.getCurrentSceneRevision,
      renderImage: async () => {
        throwIfAborted(input.signal);
        const target = this.createCanvas();
        target.width = pixelSize.width;
        target.height = pixelSize.height;
        const context = target.getContext("2d");
        if (context === null) throw new Error("A 2D canvas context is required.");
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, target.width, target.height);
        if (baseCanvas !== null && baseCanvas.width > 0 && baseCanvas.height > 0) {
          context.drawImage(
            baseCanvas,
            0,
            0,
            baseCanvas.width,
            baseCanvas.height,
            0,
            0,
            target.width,
            target.height,
          );
        }
        if (overlayCanvas !== null && overlayCanvas.width > 0 && overlayCanvas.height > 0) {
          context.drawImage(
            overlayCanvas,
            0,
            0,
            overlayCanvas.width,
            overlayCanvas.height,
            0,
            0,
            target.width,
            target.height,
          );
        }
        throwIfAborted(input.signal);
        renderedPixelWidth = target.width;
        renderedPixelHeight = target.height;
        return target.toDataURL("image/png");
      },
    });

    if (input.signal?.aborted) return { status: "CANCELLED" };
    if (result.failure !== undefined) {
      return { status: "UNAVAILABLE", error: result.failure.error };
    }
    const rendered = result.snapshot;
    if (rendered === undefined
      || rendered.stale
      || !this.isCurrent(input.snapshot.pageId, input.snapshot.sceneRevision)) {
      return { status: "STALE_SCENE" };
    }
    if (typeof rendered.image !== "string" || !rendered.image.startsWith("data:image/")) {
      return { status: "UNAVAILABLE" };
    }

    return {
      status: "READY",
      screenshot: Object.freeze({
        pageId: input.snapshot.pageId,
        sceneRevision: input.snapshot.sceneRevision,
        canonicalPageBounds: Object.freeze({ ...pageBounds }),
        pixelWidth: renderedPixelWidth,
        pixelHeight: renderedPixelHeight,
        imageDataUrl: rendered.image,
        byteLength: dataUrlByteLength(rendered.image),
        capturedAt: this.now(),
      }),
    };
  }

  private isCurrent(pageId: string, sceneRevision: number): boolean {
    return this.options.getCurrentPageId() === pageId
      && this.options.getCurrentSceneRevision() === sceneRevision;
  }
}

function capturePixelSize(
  pageBounds: Rect,
  canvases: readonly (HTMLCanvasElement | null)[],
  maxEdge: number,
): { width: number; height: number } {
  if (!Number.isFinite(pageBounds.width) || !Number.isFinite(pageBounds.height)
    || pageBounds.width <= 0 || pageBounds.height <= 0) {
    throw new Error("A positive canonical page is required for capture.");
  }
  const availableMaxEdge = Math.max(
    1,
    ...canvases.flatMap((canvas) => canvas === null
      ? []
      : [canvas.width, canvas.height]).filter((value) => value > 0),
  );
  const targetMaxEdge = Math.min(maxEdge, availableMaxEdge);
  const scale = targetMaxEdge / Math.max(pageBounds.width, pageBounds.height);
  return {
    width: Math.max(1, Math.round(pageBounds.width * scale)),
    height: Math.max(1, Math.round(pageBounds.height * scale)),
  };
}

function isRenderableCanvas(
  canvas: HTMLCanvasElement | null,
): canvas is HTMLCanvasElement {
  return canvas !== null && canvas.width > 0 && canvas.height > 0;
}

function normalizeMaximumEdge(value: number | undefined): number {
  if (value === undefined) return MAX_SPATIAL_SCREENSHOT_EDGE;
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError("maxEdge must be a positive integer.");
  }
  return value;
}

function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const base64Length = dataUrl.length - comma - 1;
  const padding = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(base64Length * 3 / 4) - padding);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DOMException("The screenshot capture was aborted.", "AbortError");
}
