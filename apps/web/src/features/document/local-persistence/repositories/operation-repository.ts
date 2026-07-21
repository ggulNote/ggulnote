import type { DocumentId, PageId } from "@ggulnote/shared-types";
import { openLocalDatabase, type OpenDatabaseOptions } from "../database";
import type { PersistedOperationRecord, OperationHistoryAction } from "../types";

export interface AppendOperationInput {
  documentId: DocumentId;
  pageId: PageId;
  annotationId: string;
  sequence: number;
  historyAction: OperationHistoryAction;
  operation: PersistedOperationRecord["operation"];
}

export class OperationRepository {
  public constructor(private readonly options: OpenDatabaseOptions = {}) {}

  public async appendOperation(input: AppendOperationInput): Promise<PersistedOperationRecord> {
    const db = await openLocalDatabase(this.options);
    const record: PersistedOperationRecord = {
      id: `${input.documentId}:${input.sequence}`,
      documentId: input.documentId,
      pageId: input.pageId,
      annotationId: input.annotationId,
      sequence: input.sequence,
      historyAction: input.historyAction,
      operation: input.operation,
      createdAt: Date.now(),
    };

    await db.operations.put(record);
    return record;
  }

  public async getPageSnapshotOperations(
    documentId: DocumentId,
    pageId?: PageId,
  ): Promise<PersistedOperationRecord[]> {
    const db = await openLocalDatabase(this.options);
    const table = pageId
      ? db.operations.where("documentId").equals(documentId).and((row) => row.pageId === pageId)
      : db.operations.where("documentId").equals(documentId);

    return table.sortBy("createdAt");
  }

  public async countOperations(documentId: DocumentId): Promise<number> {
    const db = await openLocalDatabase(this.options);
    return db.operations.where("documentId").equals(documentId).count();
  }

  public async deleteByDocumentId(documentId: DocumentId): Promise<void> {
    const db = await openLocalDatabase(this.options);
    const ids = await db.operations.where("documentId").equals(documentId).primaryKeys();
    await db.operations.bulkDelete(ids);
  }
}

