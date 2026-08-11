import {
  AnnotationFactory,
  type CreateAnnotationInput,
  type NormalizedRect,
  type Rect,
} from "@ggulnote/editor-core";
import { NativeCanvasRenderer } from "../../editor/adapters/canvas/canvas-2d-renderer";
import {
  SpatialPreviewUnavailableError,
  isFinitePositiveRect,
  isRectInside,
  type SpatialPreviewRenderInput,
  type SpatialPreviewRenderer,
  type SpatialPreviewSession,
} from "../application";

export interface CanvasAnnotationSpatialPreviewRendererOptions {
  readonly id: string;
  readonly createAnnotationInput: (
    input: SpatialPreviewRenderInput,
    normalizedCandidateBounds: NormalizedRect,
  ) => CreateAnnotationInput | undefined;
  readonly createCanvas?: () => HTMLCanvasElement;
  readonly mountCanvas?: (canvas: HTMLCanvasElement) => void | (() => void);
  readonly createRenderer?: () => NativeCanvasRenderer;
  readonly createAnnotationFactory?: (
    input: SpatialPreviewRenderInput,
  ) => AnnotationFactory;
}

/**
 * Renders one ephemeral annotation with the same NativeCanvasRenderer used by
 * DocumentWorkspace. The annotation is never inserted into EditorEngine.
 */
export class CanvasAnnotationSpatialPreviewRenderer
implements SpatialPreviewRenderer {
  public readonly id: string;

  public constructor(
    private readonly options: CanvasAnnotationSpatialPreviewRendererOptions,
  ) {
    this.id = options.id;
  }

  public async render(
    input: SpatialPreviewRenderInput,
  ): Promise<SpatialPreviewSession> {
    throwIfAborted(input.signal);
    const normalizedBounds = canonicalToNormalizedWithoutClamp(
      input.candidate.bounds,
      input.scene.pageBounds,
    );
    const annotationInput = this.options.createAnnotationInput(
      input,
      normalizedBounds,
    );
    if (annotationInput === undefined) {
      throw new SpatialPreviewUnavailableError(
        `Preview input is unavailable for capability ${input.draft.capability}.`,
      );
    }

    const canvas = (this.options.createCanvas ?? defaultCreateCanvas)();
    configureGhostCanvas(canvas);
    let detach = () => canvas.remove();
    let attached = false;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        if (attached) detach();
      } finally {
        releaseCanvas(canvas);
      }
    };
    try {
      const mounted = this.options.mountCanvas?.(canvas);
      attached = true;
      if (typeof mounted === "function") detach = mounted;

      const annotationFactory = this.options.createAnnotationFactory?.(input)
        ?? new AnnotationFactory({
          idGenerator: () => "spatial-ghost-preview",
          now: () => input.scene.capturedAt,
        });
      const annotation = annotationFactory.create(annotationInput);
      if (annotation.pageId !== input.scene.pageId) {
        throw new Error("Preview annotation page does not match the frozen scene.");
      }

      const renderer = (this.options.createRenderer ?? (() => new NativeCanvasRenderer()))();
      renderer.setCanvas(canvas);
      renderer.setSize(
        input.scene.pageBounds.width,
        input.scene.pageBounds.height,
        1,
      );
      configureGhostCanvas(canvas);
      renderer.beginFrame({
        pageSize: {
          width: input.scene.pageBounds.width,
          height: input.scene.pageBounds.height,
        },
        dpr: 1,
        selectedAnnotationId: null,
      });
      try {
        renderer.render(annotation);
      } finally {
        renderer.endFrame();
      }
      throwIfAborted(input.signal);

      const context = canvas.getContext("2d");
      if (context === null) {
        throw new Error("Ghost preview canvas 2D context is unavailable.");
      }
      const actualRenderBounds = measurePaintedCanonicalBounds(
        context,
        canvas,
        input.scene.pageBounds,
      );
      let disposed = false;
      return Object.freeze({
        rendererId: this.id,
        snapshotId: input.scene.snapshotId,
        pageId: input.scene.pageId,
        sceneRevision: input.scene.sceneRevision,
        candidateInternalId: input.candidate.internalId,
        draftKey: input.draft.draftKey,
        actualRenderBounds: Object.freeze(actualRenderBounds),
        dispose: () => {
          if (disposed) return;
          disposed = true;
          cleanup();
        },
      });
    } catch (error) {
      cleanup();
      throw error;
    }
  }
}

export function measurePaintedCanonicalBounds(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  canonicalPageBounds: Rect,
): Rect {
  if (!isFinitePositiveRect(canonicalPageBounds)
    || canvas.width <= 0
    || canvas.height <= 0) {
    return invalidRenderBounds();
  }
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const alpha = image.data[(y * canvas.width + x) * 4 + 3];
      if (alpha === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return invalidRenderBounds();
  const scaleX = canonicalPageBounds.width / canvas.width;
  const scaleY = canonicalPageBounds.height / canvas.height;
  return {
    x: canonicalPageBounds.x + minX * scaleX,
    y: canonicalPageBounds.y + minY * scaleY,
    width: (maxX - minX + 1) * scaleX,
    height: (maxY - minY + 1) * scaleY,
  };
}

function canonicalToNormalizedWithoutClamp(
  bounds: Rect,
  pageBounds: Rect,
): NormalizedRect {
  if (!isFinitePositiveRect(bounds)
    || !isFinitePositiveRect(pageBounds)
    || !isRectInside(bounds, pageBounds)) {
    throw new Error("Preview candidate geometry is outside canonical page bounds.");
  }
  return {
    x: (bounds.x - pageBounds.x) / pageBounds.width,
    y: (bounds.y - pageBounds.y) / pageBounds.height,
    width: bounds.width / pageBounds.width,
    height: bounds.height / pageBounds.height,
  };
}

function configureGhostCanvas(canvas: HTMLCanvasElement): void {
  canvas.style.pointerEvents = "none";
  canvas.style.userSelect = "none";
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.opacity = "0.55";
  canvas.setAttribute?.("aria-hidden", "true");
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 1;
  canvas.height = 1;
}

function defaultCreateCanvas(): HTMLCanvasElement {
  if (typeof document !== "object") {
    throw new SpatialPreviewUnavailableError("DOM canvas is unavailable.");
  }
  return document.createElement("canvas");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Spatial preview was aborted.", "AbortError");
  }
}

function invalidRenderBounds(): Rect {
  return { x: Number.NaN, y: Number.NaN, width: 0, height: 0 };
}
