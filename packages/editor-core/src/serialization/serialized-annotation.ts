import type { AnnotationType } from "../annotations/annotation-types";
import type { AnnotationId, PageId } from "@ggulnote/shared-types";

export interface SerializedAnnotation {
  schemaVersion: 1;
  id: AnnotationId;
  pageId: PageId;
  type: AnnotationType;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  zIndex: number;
  properties: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
