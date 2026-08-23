import type { DocumentId, PageId, AnnotationId } from "@ggulnote/shared-types";
import type { EditorOperation } from "@ggulnote/editor-core";
import type { PageSceneSnapshot } from "@ggulnote/editor-core";
import type { SerializedSemanticPage } from "@ggulnote/document-core";
import type { EmbeddingRecord } from "../embedding/embedding-types";

export const GGULNOTE_DATABASE_NAME = "ggulnote-local";
export const GGULNOTE_DATABASE_VERSION = 1;

export const ANNOTATION_SCHEMA_VERSION = 1;
export const TLDRAW_CANVAS_STORE_VERSION = 1;
export const PERSISTENCE_SCHEMA_VERSION = 2;
export const SEMANTIC_SCHEMA_VERSION = 3;
export const SEMANTIC_EXTRACTOR_VERSION = "8";
export const SEMANTIC_DATABASE_VERSION = 2;
export const EMBEDDING_DATABASE_VERSION = 3;
export const SESSION_DATABASE_VERSION = 4;

/** Bump only when persisted PDF semantic/layout output must be rebuilt. */
export const PDF_ANALYSIS_VERSION = 1;

export type PersistedDocumentKind = "pdf" | "blank";
export type PersistedZoomMode = "custom" | "fit-width";
export type OperationHistoryAction = "execute" | "undo" | "redo";

export interface PersistedDocumentRecord {
  id: DocumentId;
  kind: PersistedDocumentKind;
  title: string;
  /** Compatibility field used by the current editor descriptor. */
  name: string;
  pageCount: number;

  currentPage: number;
  lastActivePageId: PageId;
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
  /** Versioned TLStore snapshot. Added without creating a second database. */
  tldrawCanvasStoreVersion?: number;
  tldrawSnapshot?: unknown;
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
  analysisVersion: number;
  extractorVersion: string;
  semanticSchemaVersion: number;
  sourceItemCount: number;
  sourceSignature: string;
  model: SerializedSemanticPage;
  createdAt: number;
  updatedAt: number;
}

export type PersistedEmbeddingRecord = EmbeddingRecord;

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

export interface NoteSession {
  id: string;
  kind: PersistedDocumentKind;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  lastActivePageId: string;
  pageCount: number;
  currentPage: number;
  zoom: number;
  zoomMode: PersistedZoomMode;
  source:
    | {
        kind: 'pdf';
        originalFileName: string;
        blobKey: string;
      }
    | {
        kind: 'blank';
      };
}

export const createSemanticPageId = (documentId: DocumentId, pageId: PageId): string => `${documentId}:${pageId}:semantic`;
