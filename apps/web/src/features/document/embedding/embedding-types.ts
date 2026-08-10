import type { DocumentId, PageId } from "@ggulnote/shared-types";

export type EmbeddingGranularity =
  | "sentence"
  | "paragraph"
  | "canvas_text"
  | "memo";

export type EmbeddingSourceType = "pdf" | "ggulnote";

export interface EmbeddingModelDescriptor {
  model: string;
  dimensions: number;
}

export interface EmbeddingRecord {
  id: string;
  documentId: DocumentId;
  pageId: PageId;
  sourceType: EmbeddingSourceType;
  sourceObjectId: string;
  sourceRevision: number;
  granularity: EmbeddingGranularity;
  contentHash: string;
  embeddingModel: string;
  dimensions: number;
  vector: Float32Array;
  createdAt: number;
}

export interface EmbeddingStore {
  put(record: EmbeddingRecord): Promise<void>;
  putMany(records: readonly EmbeddingRecord[]): Promise<void>;
  getBySource(
    documentId: DocumentId,
    sourceObjectId: string,
    granularity?: EmbeddingGranularity,
  ): Promise<EmbeddingRecord | null>;
  getByPage(
    documentId: DocumentId,
    pageId: PageId,
    granularity?: EmbeddingGranularity,
  ): Promise<readonly EmbeddingRecord[]>;
  deleteBySource(documentId: DocumentId, sourceObjectId: string): Promise<void>;
  deleteByDocument(documentId: DocumentId): Promise<void>;
}

export interface EmbeddingProviderOptions {
  signal?: AbortSignal;
}

export interface EmbeddingProvider {
  readonly descriptor: EmbeddingModelDescriptor;
  embed(
    texts: readonly string[],
    options?: EmbeddingProviderOptions,
  ): Promise<readonly Float32Array[]>;
}

export interface EmbeddingIndexMetrics {
  embeddingIndexRequested: number;
  embeddingCacheHitCount: number;
  embeddingCacheMissCount: number;
  embeddingGeneratedCount: number;
  embeddingBatchCount: number;
  embeddingIndexMs: number;
}

export interface EmbeddingSearchMetrics {
  embeddingSearchMs: number;
  embeddingCandidateCount: number;
}

export type EmbeddingDiagnosticEvent =
  | {
      kind: "INDEX";
      documentId: DocumentId;
      pageId: PageId;
      sourceType: EmbeddingSourceType;
      model: string;
      dimensions: number;
      metrics: EmbeddingIndexMetrics;
      errorCode?: string;
    }
  | {
      kind: "SEARCH";
      documentId: DocumentId;
      pageId: PageId;
      granularity: EmbeddingGranularity;
      model: string;
      dimensions: number;
      metrics: EmbeddingSearchMetrics;
      errorCode?: string;
    };

export interface EmbeddingDiagnostics {
  record(event: EmbeddingDiagnosticEvent): void;
}

export const createEmbeddingRecordId = (
  documentId: DocumentId,
  pageId: PageId,
  granularity: EmbeddingGranularity,
  sourceObjectId: string,
): string => `${documentId}:${pageId}:${granularity}:${sourceObjectId}`;
