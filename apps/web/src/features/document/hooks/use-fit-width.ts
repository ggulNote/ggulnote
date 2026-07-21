import { useEffect } from "react";
import { MAX_ZOOM, MIN_ZOOM } from "../model/document-state";

type UseFitWidthParams = {
  enabled: boolean;
  containerWidth: number;
  pageWidth: number;
  onFitZoom: (zoom: number) => void;
};

const clamp = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value)));
};

export function useFitWidth({ enabled, containerWidth, pageWidth, onFitZoom }: UseFitWidthParams): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (containerWidth <= 0 || pageWidth <= 0) {
      return;
    }

    const nextZoom = clamp((containerWidth / pageWidth) * 100);
    onFitZoom(nextZoom);
  }, [enabled, containerWidth, pageWidth, onFitZoom]);
}
