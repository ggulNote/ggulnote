import { DocumentId, PageId } from "@ggulnote/shared-types";
import { openLocalDatabase, type OpenDatabaseOptions } from "../database";
import type {
  PersistedSemanticPageRecord,
} from "../types";
import {
  SEMANTIC_EXTRACTOR_VERSION,
  SEMANTIC_SCHEMA_VERSION,
  createSemanticPageId,
} from "../types";

export interface SaveSemanticPageInput {
  documentId: DocumentId;
  pageId: PageId;
  pageNumber: number;
  model: PersistedSemanticPageRecord["model"];
  extractorVersion?: string;
  semanticSchemaVersion?: number;
}

export interface SemanticPageQueryOptions {
  extractorVersion?: string;
  semanticSchemaVersion?: number;
}

export class SemanticPageRepository {
  public constructor(private readonly options: OpenDatabaseOptions = {}) {}

  public async getByPage(
    documentId: DocumentId,
    pageId: PageId,
    options: SemanticPageQueryOptions = {},
  ): Promise<PersistedSemanticPageRecord | null> {
    const db = await openLocalDatabase(this.options);
    const key = createSemanticPageId(documentId, pageId);
    const extractorVersion = options.extractorVersion ?? SEMANTIC_EXTRACTOR_VERSION;
    const schemaVersion = options.semanticSchemaVersion ?? SEMANTIC_SCHEMA_VERSION;

    const exact = await db.semanticPages.get(key);
    if (
      exact
      && exact.documentId === documentId
      && exact.pageId === pageId
      && exact.extractorVersion === extractorVersion
      && exact.semanticSchemaVersion === schemaVersion
    ) {
      return exact;
    }

    if (exact && (exact.documentId !== documentId || exact.pageId !== pageId)) {
      return null;
    }

    const candidates = await db.semanticPages
      .where("[documentId+pageId]")
      .equals([documentId, pageId])
      .toArray();

    return candidates
      .find((candidate) =>
        candidate.extractorVersion === extractorVersion
        && candidate.semanticSchemaVersion === schemaVersion,
      ) ?? null;
  }

  public async save(input: SaveSemanticPageInput): Promise<PersistedSemanticPageRecord> {
    const now = Date.now();
    const db = await openLocalDatabase(this.options);

    const record: PersistedSemanticPageRecord = {
      id: createSemanticPageId(input.documentId, input.pageId),
      documentId: input.documentId,
      pageId: input.pageId,
      pageNumber: input.pageNumber,
      extractorVersion: input.extractorVersion ?? SEMANTIC_EXTRACTOR_VERSION,
      semanticSchemaVersion: input.semanticSchemaVersion ?? SEMANTIC_SCHEMA_VERSION,
      sourceItemCount: input.model.sourceItemCount,
      model: input.model,
      createdAt: now,
      updatedAt: now,
    };

    await db.semanticPages.put(record);
    return record;
  }

  public async deleteByDocumentId(documentId: DocumentId): Promise<void> {
    const db = await openLocalDatabase(this.options);
    await db.semanticPages.where("documentId").equals(documentId).delete();
  }

  public async listByDocumentId(documentId: DocumentId): Promise<PersistedSemanticPageRecord[]> {
    const db = await openLocalDatabase(this.options);
    return db.semanticPages.where("documentId").equals(documentId).toArray();
  }

  public async deleteByDocumentAndPage(documentId: DocumentId, pageId: PageId): Promise<void> {
    const db = await openLocalDatabase(this.options);
    const id = createSemanticPageId(documentId, pageId);
    await db.semanticPages.delete(id);
  }
}
