export { EMBEDDING_DATABASE_VERSION, GGULNOTE_DATABASE_NAME, GGULNOTE_DATABASE_VERSION, SEMANTIC_DATABASE_VERSION, SEMANTIC_EXTRACTOR_VERSION, SEMANTIC_SCHEMA_VERSION, TLDRAW_CANVAS_STORE_VERSION } from "./types";
export { openLocalDatabase } from "./database";

export { PDF_ANALYSIS_VERSION, SESSION_DATABASE_VERSION } from './types';
export type { NoteSession } from './types';

export type {
  CreateDocumentInput,
  OperationHistoryAction,
  PersistedAppStateRecord,
  PersistedDocumentFileRecord,
  PersistedDocumentRecord,
  PersistedOperationRecord,
  PersistedPageSnapshotRecord,
  PersistedSemanticPageRecord,
  PersistedEmbeddingRecord,
  SaveState,
  SaveStatus,
  DocumentRecordViewState,
} from "./types";

export { LocalEditorPersistence } from "./application/local-editor-persistence";
export { LocalSaveQueue } from "./application/local-save-queue";
export { PersistenceCoordinator } from "./application/persistence-coordinator";
export { AppStateRepository } from "./repositories/app-state-repository";
export { DocumentRepository } from "./repositories/document-repository";
export { PageSnapshotRepository } from "./repositories/page-snapshot-repository";
export { OperationRepository } from "./repositories/operation-repository";
export { SemanticPageRepository } from "./repositories/semantic-page-repository";
export { IndexedDbEmbeddingStore } from "./repositories/indexed-db-embedding-store";
