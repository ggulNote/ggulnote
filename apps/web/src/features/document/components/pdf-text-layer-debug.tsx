"use client";

import { useEffect, useRef } from "react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { ensurePdfJsInitialized } from "../adapters/pdfjs/pdfjs-loader";

interface PdfTextLayerDebugProps {
  page: PDFPageProxy;
  pageKey: string;
  zoom: number;
}

export function PdfTextLayerDebug({ page, pageKey, zoom }: PdfTextLayerDebugProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let layer: { cancel: () => void } | null = null;
    container.replaceChildren();

    const render = async () => {
      const library = await ensurePdfJsInitialized();
      const viewport = page.getViewport({ scale: Math.max(0.05, zoom / 100), rotation: page.rotate });
      const textContent = await page.getTextContent({ includeMarkedContent: false });
      if (disposed) return;
      container.style.setProperty("--scale-factor", String(viewport.scale));
      container.style.setProperty("--total-scale-factor", String(viewport.scale));
      container.dataset.pageKey = pageKey;
      const nextLayer = new library.TextLayer({ textContentSource: textContent, container, viewport });
      layer = nextLayer;
      await nextLayer.render();
    };

    void render().catch(() => {
      if (!disposed) container.dataset.renderState = "error";
    });
    return () => {
      disposed = true;
      layer?.cancel();
      container.replaceChildren();
    };
  }, [page, pageKey, zoom]);

  return <div ref={containerRef} className="pdf-text-layer-debug pointer-events-none absolute inset-0" aria-hidden="true" />;
}