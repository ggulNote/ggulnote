import type { DocumentId, PageId } from "@ggulnote/shared-types";
import type { EditorOperation } from "../operations/editor-operation";

export type EditorHistoryAction = "execute" | "undo" | "redo";

export type EditorOperationListener = (event: EditorPersistenceEvent) => void;

export interface EditorPersistenceEvent {
  documentId: DocumentId;
  pageId: PageId;
  pageNumber: number;
  historyAction: EditorHistoryAction;
  operation: EditorOperation;
  revision: number;
}

export interface EditorEvents {
  onError?: (error: Error) => void;
  onOperation?: (event: EditorPersistenceEvent) => void;
}
