import { useEffect, useRef } from "react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { createPageRenderTask } from "../adapters/pdfjs/pdf-page-renderer";

type UsePageRenderOptions = {
  canvas: HTMLCanvasElement | null;
  page: PDFPageProxy | null;
  zoom: number;
  onRendered: (data: {
    width: number;
    height: number;
    renderedWidth: number;
    renderedHeight: number;
    rotation: number;
  }) => void;
  onError: (message: string) => void;
};

export function usePageRender({ canvas, page, zoom, onRendered, onError }: UsePageRenderOptions): void {
  const renderTaskRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!canvas || !page) return;
    const abortRef = { aborted: false };
    if (renderTaskRef.current) {
      renderTaskRef.current();
      renderTaskRef.current = null;
    }

    try {
      const { cancel, result } = createPageRenderTask(page, canvas, { zoom });
      renderTaskRef.current = cancel;
      void result
        .then((renderResult) => {
          if (abortRef.aborted) return;
          onRendered({
            width: renderResult.pageWidth,
            height: renderResult.pageHeight,
            renderedWidth: renderResult.renderedWidth,
            renderedHeight: renderResult.renderedHeight,
            rotation: renderResult.rotation,
          });
        })
        .catch((error: unknown) => {
          if (abortRef.aborted) return;
          const message = error instanceof Error ? error.message : "페이지 렌더링에 실패했습니다.";
          if (!message.includes("RenderingCancelledException")) onError(message);
        });
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : "페이지 렌더링에 실패했습니다.");
    }

    return () => {
      abortRef.aborted = true;
      if (renderTaskRef.current) {
        renderTaskRef.current();
        renderTaskRef.current = null;
      }
    };
  }, [canvas, page, zoom, onRendered, onError]);
}