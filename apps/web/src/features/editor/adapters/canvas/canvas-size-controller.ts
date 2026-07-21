import type { Size } from "@ggulnote/shared-types";

export type LayerCanvasMetrics = {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  widthPx: number;
  heightPx: number;
};

export class CanvasSizeController {
  public static compute(cssWidth: number, cssHeight: number): LayerCanvasMetrics {
    const dpr = typeof window === "object" && Number.isFinite(window.devicePixelRatio) ? Math.max(1, window.devicePixelRatio) : 1;
    return {
      cssWidth,
      cssHeight,
      dpr,
      widthPx: Math.max(1, Math.round(cssWidth * dpr)),
      heightPx: Math.max(1, Math.round(cssHeight * dpr)),
    };
  }

  public static isValidSize(size: Size): boolean {
    return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
  }
}
