export { GGULNOTE_DATABASE_NAME, GGULNOTE_DATABASE_VERSION } from "./types";
export { openLocalDatabase } from "./database";

export type {
  CreateDocumentInput,
  OperationHistoryAction,
  PersistedAppStateRecord,
  PersistedDocumentFileRecord,
  PersistedDocumentRecord,
  PersistedOperationRecord,
  PersistedPageSnapshotRecord,
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

