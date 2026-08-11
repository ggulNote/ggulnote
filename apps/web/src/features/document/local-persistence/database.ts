import Dexie, { type Table } from "dexie";
import type {
  PersistedAppStateRecord,
  PersistedDocumentRecord,
  PersistedDocumentFileRecord,
  PersistedOperationRecord,
  PersistedPageSnapshotRecord,
  PersistedSemanticPageRecord,
  PersistedEmbeddingRecord,
} from "./types";

import {
  GGULNOTE_DATABASE_NAME,
  GGULNOTE_DATABASE_VERSION,
  SEMANTIC_DATABASE_VERSION,
  EMBEDDING_DATABASE_VERSION,
} from "./types";

export class GgulnoteLocalDatabase extends Dexie {
  public documents!: Table<PersistedDocumentRecord, string>;
  public documentFiles!: Table<PersistedDocumentFileRecord, string>;
  public pageSnapshots!: Table<PersistedPageSnapshotRecord, string>;
  public operations!: Table<PersistedOperationRecord, string>;
  public appState!: Table<PersistedAppStateRecord, string>;
  public semanticPages!: Table<PersistedSemanticPageRecord, string>;
  public embeddings!: Table<PersistedEmbeddingRecord, string>;

  public constructor(name = GGULNOTE_DATABASE_NAME) {
    super(name);

    this.version(GGULNOTE_DATABASE_VERSION).stores({
      documents: "&id, kind, updatedAt, lastOpenedAt, persistenceSchemaVersion",
      documentFiles: "&documentId",
      pageSnapshots: "&id, documentId, pageId, [documentId+pageId], updatedAt, pageNumber",
      operations: "&id, documentId, pageId, sequence, [documentId+sequence], createdAt",
      appState: "&key",
    });

    this.version(SEMANTIC_DATABASE_VERSION).stores({
      documents: "&id, kind, updatedAt, lastOpenedAt, persistenceSchemaVersion",
      documentFiles: "&documentId",
      pageSnapshots: "&id, documentId, pageId, [documentId+pageId], updatedAt, pageNumber",
      operations: "&id, documentId, pageId, sequence, [documentId+sequence], createdAt",
      appState: "&key",
      semanticPages: "&id, documentId, pageId, [documentId+pageId], extractorVersion, updatedAt",
    });

    this.version(EMBEDDING_DATABASE_VERSION).stores({
      documents: "&id, kind, updatedAt, lastOpenedAt, persistenceSchemaVersion",
      documentFiles: "&documentId",
      pageSnapshots: "&id, documentId, pageId, [documentId+pageId], updatedAt, pageNumber",
      operations: "&id, documentId, pageId, sequence, [documentId+sequence], createdAt",
      appState: "&key",
      semanticPages: "&id, documentId, pageId, [documentId+pageId], extractorVersion, updatedAt",
      embeddings: "&id, documentId, pageId, [documentId+pageId], [documentId+sourceObjectId+granularity], sourceObjectId, granularity, sourceType, embeddingModel",
    });
  }
}

const databaseCache = new Map<string, GgulnoteLocalDatabase>();

export interface OpenDatabaseOptions {
  databaseName?: string;
}

export async function openLocalDatabase(
  options: OpenDatabaseOptions = {},
): Promise<GgulnoteLocalDatabase> {
  const databaseName = options.databaseName ?? GGULNOTE_DATABASE_NAME;

  let database = databaseCache.get(databaseName);
  if (!database) {
    database = new GgulnoteLocalDatabase(databaseName);
    databaseCache.set(databaseName, database);
  }

  if (!database.isOpen()) {
    await database.open();
  }

  return database;
}
