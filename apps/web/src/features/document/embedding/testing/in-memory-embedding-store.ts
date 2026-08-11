import type { DocumentId, PageId } from "@ggulnote/shared-types";
import type {
  EmbeddingGranularity,
  EmbeddingRecord,
  EmbeddingStore,
} from "../embedding-types";

export class InMemoryEmbeddingStore implements EmbeddingStore {
  private readonly records = new Map<string, EmbeddingRecord>();

  public async put(record: EmbeddingRecord): Promise<void> {
    this.records.set(record.id, cloneRecord(record));
  }

  public async putMany(records: readonly EmbeddingRecord[]): Promise<void> {
    for (const record of records) await this.put(record);
  }

  public async getBySource(
    documentId: DocumentId,
    sourceObjectId: string,
    granularity?: EmbeddingGranularity,
  ): Promise<EmbeddingRecord | null> {
    return this.getAll().find((record) =>
      record.documentId === documentId
      && record.sourceObjectId === sourceObjectId
      && (granularity === undefined || record.granularity === granularity),
    ) ?? null;
  }

  public async getByPage(
    documentId: DocumentId,
    pageId: PageId,
    granularity?: EmbeddingGranularity,
  ): Promise<readonly EmbeddingRecord[]> {
    return this.getAll().filter((record) =>
      record.documentId === documentId
      && record.pageId === pageId
      && (granularity === undefined || record.granularity === granularity),
    );
  }

  public async deleteBySource(documentId: DocumentId, sourceObjectId: string): Promise<void> {
    for (const [id, record] of this.records) {
      if (record.documentId === documentId && record.sourceObjectId === sourceObjectId) {
        this.records.delete(id);
      }
    }
  }

  public async deleteByDocument(documentId: DocumentId): Promise<void> {
    for (const [id, record] of this.records) {
      if (record.documentId === documentId) this.records.delete(id);
    }
  }

  public getAll(): EmbeddingRecord[] {
    return [...this.records.values()].map(cloneRecord).sort((left, right) => left.id.localeCompare(right.id));
  }
}

function cloneRecord(record: EmbeddingRecord): EmbeddingRecord {
  return { ...record, vector: new Float32Array(record.vector) };
}
