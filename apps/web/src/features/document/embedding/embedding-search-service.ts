import type { DocumentId, PageId } from "@ggulnote/shared-types";
import { cosineSimilarity } from "./cosine-similarity";
import { normalizeEmbeddingInput } from "./embedding-content";
import type {
  EmbeddingDiagnostics,
  EmbeddingGranularity,
  EmbeddingProvider,
  EmbeddingStore,
} from "./embedding-types";

export interface EmbeddingSearchQuery {
  documentId: DocumentId;
  pageId: PageId;
  granularity: EmbeddingGranularity;
  queryVector: Float32Array;
  topK: number;
}

export interface EmbeddingTextSearchQuery
extends Omit<EmbeddingSearchQuery, "queryVector"> {
  text: string;
  signal?: AbortSignal;
}

export interface EmbeddingSearchResult {
  sourceObjectId: string;
  score: number;
}

export interface EmbeddingSearchServiceOptions {
  now?: () => number;
  diagnostics?: EmbeddingDiagnostics;
}

export class EmbeddingSearchService {
  private readonly now: () => number;
  private readonly diagnostics?: EmbeddingDiagnostics;

  public constructor(
    private readonly store: EmbeddingStore,
    private readonly provider: EmbeddingProvider,
    options: EmbeddingSearchServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.diagnostics = options.diagnostics;
  }

  public async searchText(input: EmbeddingTextSearchQuery): Promise<readonly EmbeddingSearchResult[]> {
    const text = normalizeEmbeddingInput(input.text);
    if (text.length === 0) {
      throw new RangeError("Embedding search text must not be empty.");
    }
    const vectors = await this.provider.embed([text], { signal: input.signal });
    const vector = vectors[0];
    if (!vector || vectors.length !== 1) {
      throw new Error("Query embedding result count mismatch.");
    }
    return this.searchVector({
      documentId: input.documentId,
      pageId: input.pageId,
      granularity: input.granularity,
      queryVector: vector,
      topK: input.topK,
    });
  }

  public async searchVector(input: EmbeddingSearchQuery): Promise<readonly EmbeddingSearchResult[]> {
    if (!Number.isInteger(input.topK) || input.topK <= 0) {
      throw new RangeError("Embedding search topK must be positive.");
    }
    if (input.queryVector.length !== this.provider.descriptor.dimensions) {
      throw new RangeError("Query embedding dimensions do not match the configured model.");
    }
    if (input.queryVector.every((value) => value === 0)) {
      throw new RangeError("Embedding search query must not be a zero vector.");
    }
    const startedAt = this.now();
    try {
      const records = await this.store.getByPage(input.documentId, input.pageId, input.granularity);
      const compatible = records.filter((record) =>
        record.embeddingModel === this.provider.descriptor.model
        && record.dimensions === this.provider.descriptor.dimensions
        && record.vector.length === this.provider.descriptor.dimensions,
      );
      const ranked = compatible
        .map((record) => ({
          sourceObjectId: record.sourceObjectId,
          score: cosineSimilarity(input.queryVector, record.vector),
        }))
        .sort((left, right) =>
          right.score - left.score || left.sourceObjectId.localeCompare(right.sourceObjectId),
        )
        .slice(0, input.topK);
      this.recordDiagnostics(input, compatible.length, startedAt);
      return ranked;
    } catch (error) {
      this.recordDiagnostics(input, 0, startedAt, errorCode(error));
      throw error;
    }
  }

  private recordDiagnostics(
    input: EmbeddingSearchQuery,
    candidateCount: number,
    startedAt: number,
    code?: string,
  ): void {
    try {
      this.diagnostics?.record({
        kind: "SEARCH",
        documentId: input.documentId,
        pageId: input.pageId,
        granularity: input.granularity,
        model: this.provider.descriptor.model,
        dimensions: this.provider.descriptor.dimensions,
        metrics: {
          embeddingSearchMs: Math.max(0, this.now() - startedAt),
          embeddingCandidateCount: candidateCount,
        },
        ...(code === undefined ? {} : { errorCode: code }),
      });
    } catch {
      // Diagnostics cannot affect search results.
    }
  }
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "EMBEDDING_SEARCH_FAILED";
}
