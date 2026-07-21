import type { NormalizedRect } from "@ggulnote/shared-types";
import type { Size } from "@ggulnote/shared-types";
import type { Annotation } from "../annotations/annotation";

export interface RenderFrameContext {
  pageSize: Size;
  dpr: number;
  selectedAnnotationId: string | null;
}

export interface AnnotationRenderer {
  beginFrame(context: RenderFrameContext): void;
  render(annotation: Annotation): void;
  renderSelection(annotation: Annotation): void;
  endFrame(): void;
}

export interface AnnotationRenderContext {
  pageSize: Size;
  dpr: number;
}
