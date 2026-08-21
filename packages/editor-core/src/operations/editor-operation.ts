import type { AnnotationId, DocumentId, PageId } from "@ggulnote/shared-types";

export interface EditorOperation {
  operationId: string;
  documentId: DocumentId;
  pageId: PageId;
  annotationId: AnnotationId;
  type: "CREATE_ANNOTATION" | "UPDATE_ANNOTATION" | "DELETE_ANNOTATION" | "MOVE_ANNOTATION" | "BATCH";
  payload: unknown;
  createdAt: number;
  sourceTurnId?: string;
  toolId?: string;
  undoGroupId?: string;
}

export interface EditorOperationMetadata {
  sourceTurnId?: string;
  toolId?: string;
  undoGroupId?: string;
}

let operationSequence = 0;

export const createOperation = (
  operation: Omit<EditorOperation, "operationId" | "createdAt" | "undoGroupId">
    & { undoGroupId?: string },
): EditorOperation => {
  const operationId = `op-${Date.now()}-${operationSequence += 1}`;
  return {
    ...operation,
    operationId,
    createdAt: Date.now(),
    undoGroupId: operation.undoGroupId ?? operationId,
  };
};
