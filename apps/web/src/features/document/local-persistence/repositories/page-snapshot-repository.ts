import type { DocumentId, PageId } from "@ggulnote/shared-types";
import { openLocalDatabase, type OpenDatabaseOptions } from "../database";
import {
  type PersistedPageSnapshotRecord,
  ANNOTATION_SCHEMA_VERSION,
} from "../types";

export class PageSnapshotRepository {
  public constructor(private readonly options: OpenDatabaseOptions = {}) {}

  public async getPageSnapshot(
    documentId: DocumentId,
    pageId: PageId,
  ): Promise<PersistedPageSnapshotRecord | null> {
    const db = await openLocalDatabase(this.options);
    const id = `${documentId}:${pageId}`;
    const record = await db.pageSnapshots.get(id);

    if (!record) {
      return null;
    }

    if (record.annotationSchemaVersion !== ANNOTATION_SCHEMA_VERSION) {
      throw new Error("Unsupported annotation schema version");
    }

    return record;
  }

  public async listDocumentSnapshots(documentId: DocumentId): Promise<PersistedPageSnapshotRecord[]> {
    const db = await openLocalDatabase(this.options);
    return db.pageSnapshots.where("documentId").equals(documentId).toArray();
  }

  public async savePageSnapshot(snapshot: PersistedPageSnapshotRecord): Promise<boolean> {
    const db = await openLocalDatabase(this.options);

    const existing = await db.pageSnapshots.get(snapshot.id);
    if (existing && existing.revision >= snapshot.revision) {
      return false;
    }

    await db.pageSnapshots.put(snapshot);
    return true;
  }

  public async deleteByDocumentId(documentId: DocumentId): Promise<void> {
    const db = await openLocalDatabase(this.options);
    const ids = await db.pageSnapshots
      .where("documentId")
      .equals(documentId)
      .primaryKeys();

    await db.pageSnapshots.bulkDelete(ids);
  }
}

