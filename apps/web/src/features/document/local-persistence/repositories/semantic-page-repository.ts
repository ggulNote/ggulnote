import { DocumentId, PageId } from "@ggulnote/shared-types";
import { openLocalDatabase, type OpenDatabaseOptions } from "../database";
import type { PersistedSemanticPageRecord } from "../types";
import {
  SEMANTIC_EXTRACTOR_VERSION,
  SEMANTIC_SCHEMA_VERSION,
  PDF_ANALYSIS_VERSION,
  createSemanticPageId,
} from "../types";

export interface SaveSemanticPageInput {
  documentId: DocumentId;
  pageId: PageId;
  pageNumber: number;
  analysisVersion?: number;
  model: PersistedSemanticPageRecord["model"];
  extractorVersion?: string;
  semanticSchemaVersion?: number;
}

export interface SemanticPageQueryOptions {
  analysisVersion?: number;
  extractorVersion?: string;
  semanticSchemaVersion?: number;
}

export const isSemanticPageRecordCompatible = (
  record: PersistedSemanticPageRecord,
  documentId: DocumentId,
  pageId: PageId,
  extractorVersion: string,
  schemaVersion: number,
  analysisVersion = PDF_ANALYSIS_VERSION,
): boolean =>
  record.documentId === documentId
  && record.pageId === pageId
  && record.analysisVersion === analysisVersion
  && record.extractorVersion === extractorVersion
  && record.semanticSchemaVersion === schemaVersion
  && record.model.documentId === documentId
  && record.model.pageId === pageId
  && record.model.extractorVersion === extractorVersion
  && record.model.schemaVersion === schemaVersion;

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
    const analysisVersion = options.analysisVersion ?? PDF_ANALYSIS_VERSION;
    const exact = await db.semanticPages.get(key);
    if (exact && isSemanticPageRecordCompatible(
      exact,
      documentId,
      pageId,
      extractorVersion,
      schemaVersion,
      analysisVersion,
    )) {
      return exact;
    }
    if (exact && (exact.documentId !== documentId || exact.pageId !== pageId)) return null;

    const candidates = await db.semanticPages
      .where("[documentId+pageId]")
      .equals([documentId, pageId])
      .toArray();
    return candidates.find((candidate) =>
      isSemanticPageRecordCompatible(
        candidate,
        documentId,
        pageId,
        extractorVersion,
        schemaVersion,
        analysisVersion,
      ),
    ) ?? null;
  }

  public async save(input: SaveSemanticPageInput): Promise<PersistedSemanticPageRecord> {
    const extractorVersion = input.extractorVersion ?? SEMANTIC_EXTRACTOR_VERSION;
    const schemaVersion = input.semanticSchemaVersion ?? SEMANTIC_SCHEMA_VERSION;
    const analysisVersion = input.analysisVersion ?? PDF_ANALYSIS_VERSION;
    if (
      input.model.documentId !== input.documentId
      || input.model.pageId !== input.pageId
      || input.model.pageNumber !== input.pageNumber
      || input.model.extractorVersion !== extractorVersion
      || input.model.schemaVersion !== schemaVersion
    ) {
      throw new Error("Semantic page cache identity mismatch");
    }

    const now = Date.now();
    const db = await openLocalDatabase(this.options);
    const record: PersistedSemanticPageRecord = {
      id: createSemanticPageId(input.documentId, input.pageId),
      documentId: input.documentId,
      pageId: input.pageId,
      pageNumber: input.pageNumber,
      analysisVersion,
      extractorVersion,
      semanticSchemaVersion: schemaVersion,
      sourceItemCount: input.model.sourceItemCount,
      sourceSignature: input.model.sourceSignature,
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
    await db.semanticPages.delete(createSemanticPageId(documentId, pageId));
  }
}
