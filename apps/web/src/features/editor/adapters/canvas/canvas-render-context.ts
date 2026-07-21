import type { Size } from "@ggulnote/shared-types";

export type CanvasSize = {
  widthPx: number;
  heightPx: number;
  dpr: number;
  pageSize: Size;
};

export interface CanvasRenderContext {
  readonly pageSize: Size;
  readonly dpr: number;
  readonly selectedAnnotationId: string | null;
}
