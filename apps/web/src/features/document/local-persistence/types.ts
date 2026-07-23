import type { DocumentId, PageId, AnnotationId } from "@ggulnote/shared-types";
import type { EditorOperation } from "@ggulnote/editor-core";
import type { PageSceneSnapshot } from "@ggulnote/editor-core";
import type { SerializedSemanticPage } from "@ggulnote/document-core";

export const GGULNOTE_DATABASE_NAME = "ggulnote-local";
export const GGULNOTE_DATABASE_VERSION = 1;

export const ANNOTATION_SCHEMA_VERSION = 1;
export const PERSISTENCE_SCHEMA_VERSION = 1;
export const SEMANTIC_SCHEMA_VERSION = 2;
export const SEMANTIC_EXTRACTOR_VERSION = "4";
export const SEMANTIC_DATABASE_VERSION = 2;

export type PersistedDocumentKind = "pdf" | "blank";
export type PersistedZoomMode = "custom" | "fit-width";
export type OperationHistoryAction = "execute" | "undo" | "redo";

export interface PersistedDocumentRecord {
  id: DocumentId;
  kind: PersistedDocumentKind;
  name: string;
  pageCount: number;

  currentPage: number;
  zoom: number;
  zoomMode: PersistedZoomMode;

  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;

  nextOperationSequence: number;
  persistenceSchemaVersion: number;
}

export interface PersistedDocumentFileRecord {
  documentId: DocumentId;
  blob: Blob;
  mimeType: "application/pdf";
  size: number;
  originalName: string;
  lastModified: number | null;
  createdAt: number;
}

export interface PersistedPageSnapshotRecord {
  id: string;
  documentId: DocumentId;
  pageId: PageId;
  pageNumber: number;
  revision: number;
  annotations: PageSceneSnapshot["annotations"];
  createdAt: number;
  updatedAt: number;
  annotationSchemaVersion: number;
}

export interface PersistedOperationRecord {
  id: string;
  documentId: DocumentId;
  pageId: PageId;
  annotationId: AnnotationId;
  sequence: number;
  historyAction: OperationHistoryAction;
  operation: EditorOperation;
  createdAt: number;
}

export interface PersistedSemanticPageRecord {
  id: string;
  documentId: DocumentId;
  pageId: PageId;
  pageNumber: number;
  extractorVersion: string;
  semanticSchemaVersion: number;
  sourceItemCount: number;
  sourceSignature: string;
  model: SerializedSemanticPage;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedAppStateRecord {
  key: "editor";
  lastOpenedDocumentId: DocumentId | null;
  persistentStorageRequested: boolean;
  updatedAt: number;
}

export interface DocumentRecordViewState {
  currentPage: number;
  zoom: number;
  zoomMode: PersistedZoomMode;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface SaveState {
  status: SaveStatus;
  errorMessage: string | null;
  pendingCount: number;
  lastSavedAt: number | null;
}

export interface CreateDocumentInput {
  id: string;
  kind: PersistedDocumentKind;
  name: string;
  pageCount: number;
  currentPage?: number;
  zoom?: number;
  zoomMode?: PersistedZoomMode;
  nextOperationSequence?: number;
}

export const createSemanticPageId = (documentId: DocumentId, pageId: PageId): string => `${documentId}:${pageId}:semantic`;
