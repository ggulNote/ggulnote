import type { AnnotationId, DocumentId, PageId } from "@ggulnote/shared-types";

export interface EditorOperation {
  operationId: string;
  documentId: DocumentId;
  pageId: PageId;
  annotationId: AnnotationId;
  type: "CREATE_ANNOTATION" | "UPDATE_ANNOTATION" | "DELETE_ANNOTATION" | "MOVE_ANNOTATION";
  payload: unknown;
  createdAt: number;
}

let operationSequence = 0;

export const createOperation = (operation: Omit<EditorOperation, "operationId" | "createdAt">): EditorOperation => ({
  ...operation,
  operationId: `op-${Date.now()}-${operationSequence += 1}`,
  createdAt: Date.now(),
});
