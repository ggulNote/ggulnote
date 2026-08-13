import type { AnnotationType } from "../annotations/annotation-types";
import type { AnnotationId, NormalizedRect, PageId } from "@ggulnote/shared-types";

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
  rects?: NormalizedRect[];
  zIndex: number;
  properties: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  createdByTurnId?: string;
  creationOrder?: number;
  targetObjectIds?: string[];
}
