import type { DocumentId, PageId, AnnotationId } from "@ggulnote/shared-types";
import type { EditorOperation } from "../operations/editor-operation";

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
