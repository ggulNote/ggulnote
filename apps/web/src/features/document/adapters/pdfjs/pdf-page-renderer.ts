import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

export type PdfRenderResult = {
  pageWidth: number;
  pageHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  rotation: number;
};

export type RenderJob = {
  result: Promise<PdfRenderResult>;
  cancel: () => void;
};

export function createPageRenderTask(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  options: { zoom: number; rotation?: number },
): RenderJob {
  const zoom = Math.max(0.05, options.zoom / 100);
  const rotation = options.rotation ?? page.rotate;
  const baseViewport = page.getViewport({ scale: 1, rotation });
  const viewport = page.getViewport({ scale: zoom, rotation });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas context를 사용할 수 없습니다.");

  const dpr = Math.max(window.devicePixelRatio ?? 1, 1);
  canvas.width = Math.max(1, Math.ceil(viewport.width * dpr));
  canvas.height = Math.max(1, Math.ceil(viewport.height * dpr));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = true;
  context.clearRect(0, 0, viewport.width, viewport.height);

  const renderTask = page.render({
    canvasContext: context,
    canvas,
    viewport,
    background: "rgb(255,255,255)",
  });

  return {
    cancel: () => {
      if (typeof renderTask.cancel === "function") renderTask.cancel();
    },
    result: renderTask.promise.then(() => ({
      pageWidth: baseViewport.width,
      pageHeight: baseViewport.height,
      renderedWidth: viewport.width,
      renderedHeight: viewport.height,
      rotation: viewport.rotation,
    })),
  };
}