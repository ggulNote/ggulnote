import type { DocumentId, PageId, AnnotationId } from "@ggulnote/shared-types";
import type { EditorOperation } from "../operations/editor-operation";
import type { SerializedAnnotation } from "../serialization/serialized-annotation";

export interface EditorSnapshot {
  documentId: DocumentId | null;
  activePageId: PageId | null;
  selectedAnnotationId: AnnotationId | null;
  annotationCount: number;
  canUndo: boolean;
  canRedo: boolean;
  lastOperation: EditorOperation | null;
  revision: number;
}

export interface PageSceneSnapshot {
  documentId: DocumentId;
  pageId: PageId;
  pageNumber: number;
  revision: number;
  annotations: SerializedAnnotation[];
}
