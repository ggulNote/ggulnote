import { openLocalDatabase, type OpenDatabaseOptions } from "../database";
import type { PersistedAppStateRecord } from "../types";

export class AppStateRepository {
  private readonly defaultState: PersistedAppStateRecord = {
    key: "editor",
    lastOpenedDocumentId: null,
    persistentStorageRequested: false,
    updatedAt: Date.now(),
  };

  public constructor(private readonly options: OpenDatabaseOptions = {}) {}

  public async getEditorState(): Promise<PersistedAppStateRecord> {
    const db = await openLocalDatabase(this.options);
    const saved = await db.appState.get("editor");
    if (saved) {
      return saved;
    }

    await db.appState.put(this.defaultState);
    return { ...this.defaultState };
  }

  public async setLastOpenedDocument(documentId: string | null): Promise<void> {
    const db = await openLocalDatabase(this.options);
    const now = Date.now();
    const saved = await db.appState.get("editor");

    if (saved) {
      saved.lastOpenedDocumentId = documentId;
      saved.updatedAt = now;
      await db.appState.put(saved);
      return;
    }

    await db.appState.put({
      ...this.defaultState,
      lastOpenedDocumentId: documentId,
      updatedAt: now,
    });
  }

  public async markPersistentStorageRequested(): Promise<void> {
    const db = await openLocalDatabase(this.options);
    const now = Date.now();
    const saved = await db.appState.get("editor");
    if (saved) {
      saved.persistentStorageRequested = true;
      saved.updatedAt = now;
      await db.appState.put(saved);
      return;
    }

    await db.appState.put({
      ...this.defaultState,
      persistentStorageRequested: true,
      updatedAt: now,
    });
  }
}

