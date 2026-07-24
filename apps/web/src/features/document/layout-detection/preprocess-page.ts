import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type { LetterboxGeometry } from "./layout-detection-types";

export type RenderedLayoutPage = { bitmap: ImageBitmap; renderMs: number };

export function computeLetterboxGeometry(sourceWidth: number, sourceHeight: number, inputSize: number): LetterboxGeometry {
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(inputSize > 0)) {
    throw new Error("Layout letterbox dimensions must be positive.");
  }
  const scale = Math.min(inputSize / sourceWidth, inputSize / sourceHeight);
  const resizedWidth = Math.max(1, Math.round(sourceWidth * scale));
  const resizedHeight = Math.max(1, Math.round(sourceHeight * scale));
  return { inputSize, sourceWidth, sourceHeight, resizedWidth, resizedHeight, scale, padX: (inputSize - resizedWidth) / 2, padY: (inputSize - resizedHeight) / 2 };
}

export async function renderPdfPageForLayoutDetection(page: PDFPageProxy, inputSize: number): Promise<RenderedLayoutPage> {
  const canonicalViewport = page.getViewport({ scale: 1, rotation: page.rotate });
  const renderScale = inputSize / Math.max(canonicalViewport.width, canonicalViewport.height);
  const viewport = page.getViewport({ scale: renderScale, rotation: page.rotate });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Could not create the document layout render context.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const startedAt = performance.now();
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const bitmap = await createImageBitmap(canvas);
  return { bitmap, renderMs: performance.now() - startedAt };
}