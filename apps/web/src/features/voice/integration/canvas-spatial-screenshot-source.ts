import { buildCompositeRenderSnapshot, type Rect } from "@ggulnote/editor-core";
import type {
  SpatialScreenshotMarker,
  SpatialScreenshotSource,
  SpatialScreenshotSourceResult,
} from "../application";

export const MAX_SPATIAL_SCREENSHOT_EDGE = 1_280;
export const VISUAL_CONTEXT_CAPTURE_TIMEOUT_MS = 1_200;

export interface CanvasSpatialTldrawOverlay {
  readonly imageDataUrl: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

export interface CanvasSpatialScreenshotSourceOptions {
  readonly getBaseCanvas: () => HTMLCanvasElement | null;
  readonly getOverlayCanvas: () => HTMLCanvasElement | null;
  readonly getTldrawOverlay?: () => Promise<CanvasSpatialTldrawOverlay | undefined>;
  readonly getCurrentPageId: () => string | undefined;
  readonly getCurrentSceneRevision: () => number;
  readonly createCanvas?: () => HTMLCanvasElement;
  readonly now?: () => number;
  readonly maxEdge?: number;
  readonly captureTimeoutMs?: number;
  readonly loadImage?: (imageDataUrl: string) => Promise<CanvasImageSource>;
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
  private readonly captureTimeoutMs: number;
  private readonly loadImage: (imageDataUrl: string) => Promise<CanvasImageSource>;

  public constructor(private readonly options: CanvasSpatialScreenshotSourceOptions) {
    this.createCanvas = options.createCanvas
      ?? (() => document.createElement("canvas"));
    this.now = options.now ?? Date.now;
    this.maxEdge = normalizeMaximumEdge(options.maxEdge);
    this.captureTimeoutMs = normalizeCaptureTimeout(options.captureTimeoutMs);
    this.loadImage = options.loadImage ?? loadBrowserImage;
  }

  public async capture(
    input: Parameters<SpatialScreenshotSource["capture"]>[0],
  ): Promise<SpatialScreenshotSourceResult> {
    if (input.signal?.aborted) return { status: "CANCELLED" };
    return settleCaptureWithin(
      this.captureCurrent(input),
      this.captureTimeoutMs,
      input.signal,
    );
  }

  private async captureCurrent(
    input: Parameters<SpatialScreenshotSource["capture"]>[0],
  ): Promise<SpatialScreenshotSourceResult> {
    if (input.signal?.aborted) return { status: "CANCELLED" };
    if (!this.isCurrent(input.snapshot.pageId, input.snapshot.sceneRevision)) {
      return { status: "STALE_SCENE" };
    }

    const baseCanvas = this.options.getBaseCanvas();
    const overlayCanvas = this.options.getOverlayCanvas();
    let tldrawOverlay: CanvasSpatialTldrawOverlay | undefined;
    let tldrawImage: CanvasImageSource | undefined;
    try {
      tldrawOverlay = await this.options.getTldrawOverlay?.();
      throwIfAborted(input.signal);
      if (tldrawOverlay !== undefined) {
        tldrawImage = await this.loadImage(tldrawOverlay.imageDataUrl);
      }
    } catch (error) {
      if (input.signal?.aborted) return { status: "CANCELLED" };
      return { status: "UNAVAILABLE", error };
    }
    if (input.snapshot.mode === "PDF" && !isRenderableCanvas(baseCanvas)) {
      return { status: "UNAVAILABLE" };
    }

    const pageBounds = input.snapshot.pageBounds;
    const markers = normalizeMarkers(input.markers ?? []);
    const pixelSize = capturePixelSize(
      pageBounds,
      [
        sizeOfCanvas(baseCanvas),
        sizeOfCanvas(overlayCanvas),
        tldrawOverlay === undefined
          ? undefined
          : { width: tldrawOverlay.pixelWidth, height: tldrawOverlay.pixelHeight },
      ],
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
        if (tldrawImage !== undefined) {
          context.drawImage(
            tldrawImage,
            0,
            0,
            target.width,
            target.height,
          );
        }
        drawAgentObjectMarkers(context, markers, target.width, target.height);
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
        markers,
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
  sources: readonly ({ readonly width: number; readonly height: number } | undefined)[],
  maxEdge: number,
): { width: number; height: number } {
  if (!Number.isFinite(pageBounds.width) || !Number.isFinite(pageBounds.height)
    || pageBounds.width <= 0 || pageBounds.height <= 0) {
    throw new Error("A positive canonical page is required for capture.");
  }
  const availableMaxEdge = Math.max(
    pageBounds.width,
    pageBounds.height,
    ...sources.flatMap((source) => source === undefined
      ? []
      : [source.width, source.height]).filter((value) => value > 0),
  );
  const targetMaxEdge = Math.min(maxEdge, availableMaxEdge);
  const scale = targetMaxEdge / Math.max(pageBounds.width, pageBounds.height);
  return {
    width: Math.max(1, Math.round(pageBounds.width * scale)),
    height: Math.max(1, Math.round(pageBounds.height * scale)),
  };
}

/** Pure normalized-to-pixel transform shared by rendering and tests. */
export function markerPixelBounds(
  marker: SpatialScreenshotMarker,
  pixelWidth: number,
  pixelHeight: number,
): Rect {
  return {
    x: marker.bounds.x * pixelWidth,
    y: marker.bounds.y * pixelHeight,
    width: marker.bounds.width * pixelWidth,
    height: marker.bounds.height * pixelHeight,
  };
}

function drawAgentObjectMarkers(
  context: CanvasRenderingContext2D,
  markers: readonly SpatialScreenshotMarker[],
  pixelWidth: number,
  pixelHeight: number,
): void {
  if (markers.length === 0) return;
  const fontSize = Math.max(14, Math.min(26, Math.round(Math.max(pixelWidth, pixelHeight) * 0.018)));
  const paddingX = Math.max(4, Math.round(fontSize * 0.35));
  const paddingY = Math.max(2, Math.round(fontSize * 0.2));
  context.save();
  context.font = `700 ${fontSize}px sans-serif`;
  context.textBaseline = "top";
  context.lineWidth = Math.max(2, Math.round(Math.max(pixelWidth, pixelHeight) / 640));
  for (const marker of markers) {
    const bounds = markerPixelBounds(marker, pixelWidth, pixelHeight);
    context.strokeStyle = "rgba(220, 38, 38, 0.92)";
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

    const label = `[${marker.id}]`;
    const labelWidth = Math.ceil(context.measureText(label).width) + paddingX * 2;
    const labelHeight = fontSize + paddingY * 2;
    const labelX = Math.max(0, Math.min(pixelWidth - labelWidth, bounds.x));
    const labelY = bounds.y >= labelHeight
      ? bounds.y - labelHeight
      : Math.max(0, Math.min(pixelHeight - labelHeight, bounds.y));
    context.fillStyle = "rgba(220, 38, 38, 0.94)";
    context.fillRect(labelX, labelY, labelWidth, labelHeight);
    context.fillStyle = "#ffffff";
    context.fillText(label, labelX + paddingX, labelY + paddingY);
  }
  context.restore();
}

function normalizeMarkers(
  markers: readonly SpatialScreenshotMarker[],
): readonly SpatialScreenshotMarker[] {
  const ids = new Set<string>();
  return Object.freeze(markers.map((marker, index) => {
    const id = marker.id.trim();
    if (id.length === 0 || ids.has(id)) {
      throw new Error(`Screenshot marker ${index} requires a unique non-empty id.`);
    }
    ids.add(id);
    const bounds = marker.bounds;
    if ([bounds.x, bounds.y, bounds.width, bounds.height].some((value) =>
      !Number.isFinite(value))
      || bounds.x < 0 || bounds.y < 0 || bounds.width < 0 || bounds.height < 0
      || bounds.x > 1 || bounds.y > 1
      || bounds.x + bounds.width > 1 + Number.EPSILON
      || bounds.y + bounds.height > 1 + Number.EPSILON) {
      throw new Error(`Screenshot marker ${id} requires page-normalized bounds.`);
    }
    return Object.freeze({
      id,
      ...(marker.kind === undefined ? {} : { kind: marker.kind }),
      bounds: Object.freeze({ ...bounds }),
    });
  }));
}

function sizeOfCanvas(
  canvas: HTMLCanvasElement | null,
): { readonly width: number; readonly height: number } | undefined {
  return canvas === null ? undefined : { width: canvas.width, height: canvas.height };
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

function normalizeCaptureTimeout(value: number | undefined): number {
  if (value === undefined) return VISUAL_CONTEXT_CAPTURE_TIMEOUT_MS;
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError("captureTimeoutMs must be a positive integer.");
  }
  return value;
}

function settleCaptureWithin(
  capture: Promise<SpatialScreenshotSourceResult>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<SpatialScreenshotSourceResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SpatialScreenshotSourceResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = () => finish({ status: "CANCELLED" });
    const timer = setTimeout(() => finish({
      status: "UNAVAILABLE",
      error: new Error("Visual context capture timed out."),
    }), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    void capture.then(
      finish,
      (error: unknown) => finish({ status: "UNAVAILABLE", error }),
    );
  });
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

async function loadBrowserImage(imageDataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = imageDataUrl;
  if (typeof image.decode === "function") {
    await image.decode();
    return image;
  }
  await new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("Unable to decode tldraw image.")), {
      once: true,
    });
  });
  return image;
}
