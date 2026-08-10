import type { PageSemanticModel, SemanticObject } from "@ggulnote/document-core";
import type { PageSceneSnapshot, SerializedAnnotation } from "@ggulnote/editor-core";
import type { DocumentId, PageId } from "@ggulnote/shared-types";
import {
  createEmbeddingContentHash,
  createEmbeddingSourceRevision,
  normalizeEmbeddingInput,
} from "./embedding-content";
import {
  createEmbeddingRecordId,
  type EmbeddingDiagnostics,
  type EmbeddingGranularity,
  type EmbeddingProvider,
  type EmbeddingRecord,
  type EmbeddingSourceType,
  type EmbeddingStore,
} from "./embedding-types";

interface EmbeddingSourceCandidate {
  documentId: DocumentId;
  pageId: PageId;
  sourceType: EmbeddingSourceType;
  sourceObjectId: string;
  sourceRevision: number;
  granularity: EmbeddingGranularity;
  text: string;
  contentHash: string;
  readingOrder: number;
}

export interface EmbeddingIndexResult {
  requested: number;
  cacheHits: number;
  cacheMisses: number;
  generated: number;
  batches: number;
}

export interface IndexPdfPageInput {
  documentId: DocumentId;
  pageId: PageId;
  semanticModel: PageSemanticModel;
  signal?: AbortSignal;
}

export interface IndexCanvasPageInput {
  documentId: DocumentId;
  pageId: PageId;
  snapshot: PageSceneSnapshot;
  signal?: AbortSignal;
}

export interface SemanticEmbeddingIndexerOptions {
  now?: () => number;
  diagnostics?: EmbeddingDiagnostics;
}

export class SemanticEmbeddingIndexer {
  private readonly now: () => number;
  private readonly diagnostics?: EmbeddingDiagnostics;
  private readonly inFlight = new Map<string, Promise<EmbeddingIndexResult>>();

  public constructor(
    private readonly store: EmbeddingStore,
    private readonly provider: EmbeddingProvider,
    options: SemanticEmbeddingIndexerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.diagnostics = options.diagnostics;
  }

  public indexPdfPage(input: IndexPdfPageInput): Promise<EmbeddingIndexResult> {
    const serialized = input.semanticModel.toSerialized();
    if (serialized.documentId !== input.documentId || serialized.pageId !== input.pageId) {
      return Promise.reject(new Error("Semantic page identity mismatch."));
    }
    const sourceRevision = createEmbeddingSourceRevision(
      `${serialized.extractorVersion}:${serialized.schemaVersion}:${serialized.sourceSignature}`,
    );
    const candidates = input.semanticModel.getAllByReadingOrder()
      .filter(isPdfEmbeddingObject)
      .map((object) => createPdfCandidate(input, object, sourceRevision))
      .filter((candidate) => candidate.text.length > 0);
    return this.indexWithDedupe(input.documentId, input.pageId, "pdf", candidates, input.signal);
  }

  public indexCanvasPage(input: IndexCanvasPageInput): Promise<EmbeddingIndexResult> {
    if (input.snapshot.documentId !== input.documentId || input.snapshot.pageId !== input.pageId) {
      return Promise.reject(new Error("Canvas page identity mismatch."));
    }
    const candidates = input.snapshot.annotations
      .filter(isTextAnnotation)
      .map((annotation, readingOrder) => createCanvasCandidate(input, annotation, readingOrder))
      .filter((candidate): candidate is EmbeddingSourceCandidate => candidate !== null);
    return this.indexWithDedupe(input.documentId, input.pageId, "ggulnote", candidates, input.signal);
  }

  private indexWithDedupe(
    documentId: DocumentId,
    pageId: PageId,
    sourceType: EmbeddingSourceType,
    candidates: readonly EmbeddingSourceCandidate[],
    signal?: AbortSignal,
  ): Promise<EmbeddingIndexResult> {
    const signature = candidates
      .map((candidate) => `${candidate.granularity}:${candidate.sourceObjectId}:${candidate.sourceRevision}:${candidate.contentHash}`)
      .join("|");
    const key = `${documentId}:${pageId}:${sourceType}:${this.provider.descriptor.model}:${this.provider.descriptor.dimensions}:${signature}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const operation = this.indexCandidates(documentId, pageId, sourceType, candidates, signal)
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, operation);
    return operation;
  }

  private async indexCandidates(
    documentId: DocumentId,
    pageId: PageId,
    sourceType: EmbeddingSourceType,
    candidates: readonly EmbeddingSourceCandidate[],
    signal?: AbortSignal,
  ): Promise<EmbeddingIndexResult> {
    const startedAt = this.now();
    let cacheHits = 0;
    let cacheMisses = 0;
    let batches = 0;
    let generated = 0;
    try {
      const records = await this.store.getByPage(documentId, pageId);
      const relevantRecords = records.filter((record) => record.sourceType === sourceType);
      const recordsBySource = new Map(
        relevantRecords.map((record) => [sourceKey(record.sourceObjectId, record.granularity), record]),
      );
      const stale: EmbeddingSourceCandidate[] = [];
      for (const candidate of candidates) {
        const record = recordsBySource.get(sourceKey(candidate.sourceObjectId, candidate.granularity));
        if (record && isReusable(record, candidate, this.provider)) {
          cacheHits += 1;
        } else {
          cacheMisses += 1;
          stale.push(candidate);
        }
      }

      if (stale.length > 0) {
        const vectors = await this.provider.embed(stale.map((candidate) => candidate.text), { signal });
        batches = 1;
        if (vectors.length !== stale.length) {
          throw new Error("Embedding provider result count mismatch.");
        }
        const createdAt = this.now();
        const nextRecords = stale.map((candidate, index) => {
          const vector = vectors[index];
          if (!vector || vector.length !== this.provider.descriptor.dimensions) {
            throw new Error("Embedding provider dimension mismatch.");
          }
          return toRecord(candidate, vector, this.provider, createdAt);
        });
        await this.store.putMany(nextRecords);
        generated = nextRecords.length;
      }

      const liveKeys = new Set(candidates.map((candidate) => sourceKey(candidate.sourceObjectId, candidate.granularity)));
      const obsoleteSourceIds = new Set(
        relevantRecords
          .filter((record) => !liveKeys.has(sourceKey(record.sourceObjectId, record.granularity)))
          .map((record) => record.sourceObjectId),
      );
      await Promise.all([...obsoleteSourceIds].map((sourceObjectId) =>
        this.store.deleteBySource(documentId, sourceObjectId),
      ));

      const result = {
        requested: candidates.length,
        cacheHits,
        cacheMisses,
        generated,
        batches,
      };
      this.recordDiagnostics(documentId, pageId, sourceType, result, startedAt);
      return result;
    } catch (error) {
      this.recordDiagnostics(documentId, pageId, sourceType, {
        requested: candidates.length,
        cacheHits,
        cacheMisses,
        generated,
        batches,
      }, startedAt, errorCode(error));
      throw error;
    }
  }

  private recordDiagnostics(
    documentId: DocumentId,
    pageId: PageId,
    sourceType: EmbeddingSourceType,
    result: EmbeddingIndexResult,
    startedAt: number,
    code?: string,
  ): void {
    try {
      this.diagnostics?.record({
        kind: "INDEX",
        documentId,
        pageId,
        sourceType,
        model: this.provider.descriptor.model,
        dimensions: this.provider.descriptor.dimensions,
        metrics: {
          embeddingIndexRequested: result.requested,
          embeddingCacheHitCount: result.cacheHits,
          embeddingCacheMissCount: result.cacheMisses,
          embeddingGeneratedCount: result.generated,
          embeddingBatchCount: result.batches,
          embeddingIndexMs: Math.max(0, this.now() - startedAt),
        },
        ...(code === undefined ? {} : { errorCode: code }),
      });
    } catch {
      // Diagnostics cannot affect document indexing.
    }
  }
}

function isPdfEmbeddingObject(
  object: SemanticObject,
): object is Extract<SemanticObject, { type: "SENTENCE" | "PARAGRAPH" }> {
  return object.type === "SENTENCE" || object.type === "PARAGRAPH";
}

function createPdfCandidate(
  input: IndexPdfPageInput,
  object: Extract<SemanticObject, { type: "SENTENCE" | "PARAGRAPH" }>,
  sourceRevision: number,
): EmbeddingSourceCandidate {
  const text = normalizeEmbeddingInput(object.text);
  return {
    documentId: input.documentId,
    pageId: input.pageId,
    sourceType: "pdf",
    sourceObjectId: object.id,
    sourceRevision,
    granularity: object.type === "SENTENCE" ? "sentence" : "paragraph",
    text,
    contentHash: createEmbeddingContentHash(text),
    readingOrder: object.readingOrder,
  };
}

function isTextAnnotation(annotation: SerializedAnnotation): boolean {
  return annotation.type === "TEXT";
}

function createCanvasCandidate(
  input: IndexCanvasPageInput,
  annotation: SerializedAnnotation,
  readingOrder: number,
): EmbeddingSourceCandidate | null {
  const rawText = annotation.properties.text;
  if (typeof rawText !== "string") return null;
  const text = normalizeEmbeddingInput(rawText);
  if (text.length === 0) return null;
  return {
    documentId: input.documentId,
    pageId: input.pageId,
    sourceType: "ggulnote",
    sourceObjectId: annotation.id,
    sourceRevision: annotation.updatedAt,
    granularity: "canvas_text",
    text,
    contentHash: createEmbeddingContentHash(text),
    readingOrder,
  };
}

function sourceKey(sourceObjectId: string, granularity: EmbeddingGranularity): string {
  return `${granularity}:${sourceObjectId}`;
}

function isReusable(
  record: EmbeddingRecord,
  candidate: EmbeddingSourceCandidate,
  provider: EmbeddingProvider,
): boolean {
  return record.contentHash === candidate.contentHash
    && record.sourceRevision === candidate.sourceRevision
    && record.embeddingModel === provider.descriptor.model
    && record.dimensions === provider.descriptor.dimensions
    && record.vector.length === provider.descriptor.dimensions;
}

function toRecord(
  candidate: EmbeddingSourceCandidate,
  vector: Float32Array,
  provider: EmbeddingProvider,
  createdAt: number,
): EmbeddingRecord {
  return {
    id: createEmbeddingRecordId(
      candidate.documentId,
      candidate.pageId,
      candidate.granularity,
      candidate.sourceObjectId,
    ),
    documentId: candidate.documentId,
    pageId: candidate.pageId,
    sourceType: candidate.sourceType,
    sourceObjectId: candidate.sourceObjectId,
    sourceRevision: candidate.sourceRevision,
    granularity: candidate.granularity,
    contentHash: candidate.contentHash,
    embeddingModel: provider.descriptor.model,
    dimensions: provider.descriptor.dimensions,
    vector: new Float32Array(vector),
    createdAt,
  };
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "EMBEDDING_INDEX_FAILED";
}
