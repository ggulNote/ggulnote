import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "./cosine-similarity";
import {
  createEmbeddingContentHash,
  normalizeEmbeddingInput,
} from "./embedding-content";
import { EmbeddingSearchService } from "./embedding-search-service";
import { createEmbeddingRecordId, type EmbeddingRecord } from "./embedding-types";
import { FakeEmbeddingProvider } from "./providers/testing/fake-embedding-provider";
import { InMemoryEmbeddingStore } from "./testing/in-memory-embedding-store";

describe("embedding content and cosine search", () => {
  it("normalizes Unicode and whitespace into a deterministic content hash", () => {
    expect(normalizeEmbeddingInput("  ＡI\n  problem  ")).toBe("AI problem");
    expect(createEmbeddingContentHash("ＡI  problem")).toBe(createEmbeddingContentHash("AI problem"));
    expect(createEmbeddingContentHash("AI issue")).not.toBe(createEmbeddingContentHash("AI problem"));
  });

  it("handles equal, orthogonal, opposite, zero, and mismatched vectors explicitly", () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBe(1);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBe(-1);
    expect(() => cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 0]))).toThrow(/zero vector/u);
    expect(() => cosineSimilarity(new Float32Array([1]), new Float32Array([1, 0]))).toThrow(/dimensions/u);
  });

  it("ranks deterministic Top-K inside the frozen page and granularity", async () => {
    const store = new InMemoryEmbeddingStore();
    const provider = new FakeEmbeddingProvider({ model: "test-model", dimensions: 2 });
    await store.putMany([
      record("page-1", "sentence-b", "sentence", [1, 0]),
      record("page-1", "sentence-a", "sentence", [1, 0]),
      record("page-1", "paragraph-a", "paragraph", [1, 0]),
      record("page-2", "sentence-other-page", "sentence", [1, 0]),
      { ...record("page-1", "sentence-old-model", "sentence", [1, 0]), embeddingModel: "old-model" },
    ]);
    const search = new EmbeddingSearchService(store, provider);

    await expect(search.searchVector({
      documentId: "doc-1",
      pageId: "page-1",
      granularity: "sentence",
      queryVector: new Float32Array([1, 0]),
      topK: 2,
    })).resolves.toEqual([
      { sourceObjectId: "sentence-a", score: 1 },
      { sourceObjectId: "sentence-b", score: 1 },
    ]);
  });

  it("embeds a query once without persisting it", async () => {
    const store = new InMemoryEmbeddingStore();
    await store.put(record("page-1", "sentence-a", "sentence", [1, 0]));
    const provider = new FakeEmbeddingProvider({
      model: "test-model",
      dimensions: 2,
      vectorForText: () => new Float32Array([1, 0]),
    });
    const search = new EmbeddingSearchService(store, provider);

    const result = await search.searchText({
      documentId: "doc-1",
      pageId: "page-1",
      granularity: "sentence",
      text: "AI problem",
      topK: 1,
    });

    expect(provider.batches).toEqual([["AI problem"]]);
    expect(result[0]).toEqual({ sourceObjectId: "sentence-a", score: 1 });
    expect(store.getAll()).toHaveLength(1);
  });
});

function record(
  pageId: string,
  sourceObjectId: string,
  granularity: EmbeddingRecord["granularity"],
  vector: readonly number[],
): EmbeddingRecord {
  return {
    id: createEmbeddingRecordId("doc-1", pageId, granularity, sourceObjectId),
    documentId: "doc-1",
    pageId,
    sourceType: "pdf",
    sourceObjectId,
    sourceRevision: 1,
    granularity,
    contentHash: "hash",
    embeddingModel: "test-model",
    dimensions: 2,
    vector: new Float32Array(vector),
    createdAt: 1,
  };
}
