import type { DocumentId, PageId } from "@ggulnote/shared-types";
import type {
  EmbeddingGranularity,
  EmbeddingRecord,
  EmbeddingStore,
} from "../../embedding/embedding-types";
import { openLocalDatabase, type OpenDatabaseOptions } from "../database";

export class IndexedDbEmbeddingStore implements EmbeddingStore {
  public constructor(private readonly options: OpenDatabaseOptions = {}) {}

  public async put(record: EmbeddingRecord): Promise<void> {
    const db = await openLocalDatabase(this.options);
    await db.embeddings.put(cloneRecord(record));
  }

  public async putMany(records: readonly EmbeddingRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = await openLocalDatabase(this.options);
    await db.embeddings.bulkPut(records.map(cloneRecord));
  }

  public async getBySource(
    documentId: DocumentId,
    sourceObjectId: string,
    granularity?: EmbeddingGranularity,
  ): Promise<EmbeddingRecord | null> {
    const db = await openLocalDatabase(this.options);
    const records = granularity === undefined
      ? await db.embeddings.where("documentId").equals(documentId).filter((record) =>
        record.sourceObjectId === sourceObjectId,
      ).sortBy("id")
      : await db.embeddings
        .where("[documentId+sourceObjectId+granularity]")
        .equals([documentId, sourceObjectId, granularity])
        .sortBy("id");
    const record = records[0];
    return record ? cloneRecord(record) : null;
  }

  public async getByPage(
    documentId: DocumentId,
    pageId: PageId,
    granularity?: EmbeddingGranularity,
  ): Promise<readonly EmbeddingRecord[]> {
    const db = await openLocalDatabase(this.options);
    const records = await db.embeddings
      .where("[documentId+pageId]")
      .equals([documentId, pageId])
      .filter((record) => granularity === undefined || record.granularity === granularity)
      .sortBy("id");
    return records.map(cloneRecord);
  }

  public async deleteBySource(documentId: DocumentId, sourceObjectId: string): Promise<void> {
    const db = await openLocalDatabase(this.options);
    const keys = await db.embeddings.where("documentId").equals(documentId).filter((record) =>
      record.sourceObjectId === sourceObjectId,
    ).primaryKeys();
    await db.embeddings.bulkDelete(keys);
  }

  public async deleteByDocument(documentId: DocumentId): Promise<void> {
    const db = await openLocalDatabase(this.options);
    await db.embeddings.where("documentId").equals(documentId).delete();
  }
}

function cloneRecord(record: EmbeddingRecord): EmbeddingRecord {
  return {
    ...record,
    vector: new Float32Array(record.vector),
  };
}
