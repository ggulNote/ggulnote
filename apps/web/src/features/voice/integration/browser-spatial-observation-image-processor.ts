import type {
  MultimodalPlacementRenderPlan,
  SpatialEncodedImage,
  SpatialObservationImageProcessor,
} from "../application";
import { MULTIMODAL_OBSERVATION_CONFIG } from "../application";

const MARK_COLORS = [
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
] as const;

export interface BrowserSpatialObservationImageProcessorOptions {
  readonly createCanvas?: () => HTMLCanvasElement;
  readonly loadImage?: (
    dataUrl: string,
    signal?: AbortSignal,
  ) => Promise<CanvasImageSource>;
}

export class BrowserSpatialObservationImageProcessor
implements SpatialObservationImageProcessor {
  private readonly createCanvas: () => HTMLCanvasElement;
  private readonly loadImage: NonNullable<
    BrowserSpatialObservationImageProcessorOptions["loadImage"]
  >;

  public constructor(options: BrowserSpatialObservationImageProcessorOptions = {}) {
    this.createCanvas = options.createCanvas
      ?? (() => document.createElement("canvas"));
    this.loadImage = options.loadImage ?? loadBrowserImage;
  }

  public async render(
    input: Parameters<SpatialObservationImageProcessor["render"]>[0],
  ): ReturnType<SpatialObservationImageProcessor["render"]> {
    throwIfAborted(input.signal);
    const image = await this.loadImage(input.screenshot.imageDataUrl, input.signal);
    throwIfAborted(input.signal);
    const globalOverview = this.renderGlobal(image, input.plan);
    const localCandidateCrop = this.renderLocal(image, input.plan);
    throwIfAborted(input.signal);
    return { globalOverview, localCandidateCrop };
  }

  private renderGlobal(
    image: CanvasImageSource,
    plan: MultimodalPlacementRenderPlan,
  ): SpatialEncodedImage {
    const canvas = this.createSizedCanvas(
      plan.globalOverview.outputSize.width,
      plan.globalOverview.outputSize.height,
    );
    const context = requireContext(canvas);
    const source = plan.globalOverview.sourcePixels;
    context.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return encodeCanvas(canvas);
  }

  private renderLocal(
    image: CanvasImageSource,
    plan: MultimodalPlacementRenderPlan,
  ): SpatialEncodedImage {
    const local = plan.localCandidateCrop;
    const canvas = this.createSizedCanvas(local.outputSize.width, local.outputSize.height);
    const context = requireContext(canvas);
    const source = local.sourcePixels;
    context.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    local.marks.forEach((mark, index) => {
      const color = MARK_COLORS[index % MARK_COLORS.length]!;
      context.save();
      context.strokeStyle = color;
      context.lineWidth = MULTIMODAL_OBSERVATION_CONFIG.markStrokeWidth;
      context.setLineDash([8, 5]);
      context.strokeRect(
        mark.footprint.x,
        mark.footprint.y,
        mark.footprint.width,
        mark.footprint.height,
      );
      context.setLineDash([]);
      context.fillStyle = color;
      context.fillRect(mark.badge.x, mark.badge.y, mark.badge.width, mark.badge.height);
      context.fillStyle = "#ffffff";
      context.font = "bold 13px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(
        mark.alias,
        mark.badge.x + mark.badge.width / 2,
        mark.badge.y + mark.badge.height / 2,
      );
      context.restore();
    });
    return encodeCanvas(canvas);
  }

  private createSizedCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = this.createCanvas();
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }
}

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("A 2D canvas context is required.");
  return context;
}

function encodeCanvas(canvas: HTMLCanvasElement): SpatialEncodedImage {
  const dataUrl = canvas.toDataURL("image/png");
  return Object.freeze({
    dataUrl,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    byteLength: dataUrlByteLength(dataUrl),
  });
}

function loadBrowserImage(
  dataUrl: string,
  signal?: AbortSignal,
): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const image = new Image();
    const abort = () => {
      cleanup();
      reject(new DOMException("The observation image load was aborted.", "AbortError"));
    };
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", abort);
    };
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("The composed screenshot could not be decoded."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    image.src = dataUrl;
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
  throw new DOMException("The observation image operation was aborted.", "AbortError");
}
