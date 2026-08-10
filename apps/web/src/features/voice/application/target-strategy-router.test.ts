import type { EmbeddingRecord } from "../../document/embedding";
import { EmbeddingSearchService, createEmbeddingRecordId } from "../../document/embedding";
import { FakeEmbeddingProvider } from "../../document/embedding/providers/testing/fake-embedding-provider";
import { InMemoryEmbeddingStore } from "../../document/embedding/testing/in-memory-embedding-store";
import { describe, expect, it } from "vitest";
import type {
  FrozenVoiceTurnContext,
  PageTargetCandidate,
  TargetQuery,
  TargetResolutionInput,
} from "../domain";
import { FrozenTargetResolver } from "./frozen-target-resolver";
import { TargetStrategyRouter, type TargetEmbeddingSearch } from "./target-strategy-router";

const FROZEN: FrozenVoiceTurnContext = {
  pageId: "page-1",
  sceneMode: "pdf",
  sceneRevision: 7,
  focusObjectId: "scene:focus",
  focusSource: "selection",
  focusStale: false,
  capturedAt: 1,
};

describe("TargetStrategyRouter", () => {
  it("resolves a semantic sentence without lexical overlap", async () => {
    const harness = await semanticHarness([
      record("sentence", "sentence-bias", [1, 0]),
      record("sentence", "sentence-output", [0, 1]),
      record("sentence", "sentence-compute", [0.2, 0.98]),
    ]);
    const result = await harness.resolver.resolveAsync(input({
      kind: "semantic_unit",
      unit: "sentence",
      query: "AI의 편향 문제를 설명하는 문장",
    }, [
      semanticCandidate("sentence-bias", "Models can reproduce biases present in their training data.", 1),
      semanticCandidate("sentence-output", "The system stores intermediate outputs.", 2),
      semanticCandidate("sentence-compute", "Training requires significant computational resources.", 3),
    ]));

    expect(result).toMatchObject({
      status: "RESOLVED",
      target: { candidateId: "candidate:sentence-bias" },
      evidence: { semanticMatch: 1 },
      diagnostics: {
        targetStrategy: "semantic_unit",
        embeddingUsed: true,
        embeddingCandidateCount: 3,
      },
    });
  });

  it("maps paragraph queries only to paragraph embeddings", async () => {
    const harness = await semanticHarness([
      record("paragraph", "paragraph-training", [1, 0]),
      record("paragraph", "paragraph-storage", [0, 1]),
      record("sentence", "sentence-ignored", [1, 0]),
    ]);
    const result = await harness.resolver.resolveAsync(input({
      kind: "semantic_unit",
      unit: "paragraph",
      query: "학습 과정을 설명한 문단",
    }, [
      paragraphCandidate("paragraph-training", "Optimization updates model parameters.", 1),
      paragraphCandidate("paragraph-storage", "The cache stores results.", 2),
    ]));

    expect(result).toMatchObject({
      status: "RESOLVED",
      target: { candidateId: "candidate:paragraph-training" },
    });
  });

  it("keeps close semantic candidates ambiguous", async () => {
    const harness = await semanticHarness([
      record("sentence", "sentence-a", [1, 0]),
      record("sentence", "sentence-b", [0.999, 0.04]),
    ]);
    const result = await harness.resolver.resolveAsync(input({
      kind: "semantic_unit",
      unit: "sentence",
      query: "편향 문제 문장",
    }, [
      semanticCandidate("sentence-a", "Bias can appear in outputs.", 1),
      semanticCandidate("sentence-b", "Outputs may contain bias.", 2),
    ]));

    expect(result).toMatchObject({ status: "AMBIGUOUS" });
  });

  it("returns NOT_FOUND instead of forcing a low semantic Top-1", async () => {
    const harness = await semanticHarness([
      record("sentence", "sentence-classical", [0, 1]),
    ]);
    const result = await harness.resolver.resolveAsync(input({
      kind: "semantic_unit",
      unit: "sentence",
      query: "양자역학 설명한 문장",
    }, [semanticCandidate("sentence-classical", "A cache stores outputs.", 1)]));

    expect(result).toMatchObject({ status: "NOT_FOUND", reasonCode: "LOW_CONFIDENCE" });
  });

  it("falls back to deterministic evidence when embedding is unavailable", async () => {
    const unavailable: TargetEmbeddingSearch = {
      embedQuery: async () => { throw new Error("offline"); },
      searchVector: async () => [],
    };
    const resolver = resolverWithSearch(unavailable);
    const result = await resolver.resolveAsync(input({
      kind: "semantic_unit",
      unit: "sentence",
      query: "AI 편향 문제",
    }, [semanticCandidate("sentence-bias", "AI 편향 문제", 1)]));

    expect(result).toMatchObject({
      status: "RESOLVED",
      diagnostics: {
        embeddingUsed: false,
        embeddingErrorCode: "EMBEDDING_UNAVAILABLE",
      },
    });
  });

  it("enforces frozen page scope and ignores stale source ids", async () => {
    const harness = await semanticHarness([
      record("sentence", "stale-page-1", [1, 0]),
      record("sentence", "valid-page-1", [0, 1]),
      record("sentence", "page-2-best", [1, 0], "page-2"),
    ]);
    const result = await harness.resolver.resolveAsync(input({
      kind: "semantic_unit",
      unit: "sentence",
      query: "semantic target",
    }, [semanticCandidate("valid-page-1", "Unrelated local sentence.", 1)]));

    expect(result).toMatchObject({ status: "NOT_FOUND" });
    expect(result.diagnostics?.embeddingCandidateCount).toBe(1);
  });

  it("never calls embedding for TextSpan or Relative strategies", async () => {
    let calls = 0;
    const forbidden: TargetEmbeddingSearch = {
      embedQuery: async () => {
        calls += 1;
        throw new Error("must not be called");
      },
      searchVector: async () => {
        calls += 1;
        return [];
      },
    };
    const resolver = resolverWithSearch(forbidden);
    const focused = lineCandidate("focus", "The entire process is simple.", 1, "scene:focus");

    await expect(resolver.resolveAsync(input(
      { kind: "text_span", quote: "entire process" },
      [focused],
    ))).resolves.toMatchObject({ status: "RESOLVED" });
    await expect(resolver.resolveAsync(input(
      { kind: "relative", relation: "focused" },
      [focused],
    ))).resolves.toMatchObject({ status: "RESOLVED" });
    expect(calls).toBe(0);
  });

  it("uses Canvas TEXT source ids for Object semantic evidence", async () => {
    const harness = await semanticHarness([
      record("canvas_text", "annotation-backprop", [1, 0], "page-1", "ggulnote"),
      record("canvas_text", "annotation-other", [0, 1], "page-1", "ggulnote"),
    ]);
    const result = await harness.resolver.resolveAsync(input({
      kind: "object",
      objectType: "text",
      query: "역전파 설명한 텍스트",
    }, [
      canvasTextCandidate("annotation-backprop", "Backpropagation applies the chain rule.", 1),
      canvasTextCandidate("annotation-other", "A shopping list.", 2),
    ]));

    expect(result).toMatchObject({
      status: "RESOLVED",
      target: { objectId: "scene:annotation-backprop" },
      evidence: { semanticMatch: 1 },
    });
  });

  it("resolves a Subrange parent first and keeps selectors unsupported", async () => {
    const resolver = resolverWithSearch();
    await expect(resolver.resolveAsync(input({
      kind: "subrange",
      parent: { kind: "relative", relation: "focused" },
      query: "2x",
    }, []))).resolves.toMatchObject({
      status: "NOT_FOUND",
      reasonCode: "FOCUS_NOT_AVAILABLE",
      diagnostics: { targetStrategy: "subrange" },
    });
    await expect(resolver.resolveAsync(input({
      kind: "subrange",
      parent: { kind: "relative", relation: "focused" },
      query: "2x",
    }, [lineCandidate("focus", "2x + 1", 1, "scene:focus")]))).resolves.toMatchObject({
      status: "NOT_FOUND",
      reasonCode: "SUBRANGE_UNSUPPORTED",
    });
  });

  it("deduplicates concurrent query embeddings", async () => {
    const harness = await semanticHarness([
      record("sentence", "sentence-a", [1, 0]),
    ]);
    const resolutionInput = input({
      kind: "semantic_unit",
      unit: "sentence",
      query: "same query",
    }, [semanticCandidate("sentence-a", "Semantic answer.", 1)]);

    await Promise.all([
      harness.resolver.resolveAsync(resolutionInput),
      harness.resolver.resolveAsync(resolutionInput),
    ]);
    expect(harness.provider.batches).toEqual([["same query"]]);
  });
});

async function semanticHarness(records: readonly EmbeddingRecord[]) {
  const store = new InMemoryEmbeddingStore();
  await store.putMany(records);
  const provider = new FakeEmbeddingProvider({
    model: "test-model",
    dimensions: 2,
    vectorForText: () => new Float32Array([1, 0]),
  });
  const search = new EmbeddingSearchService(store, provider);
  return { provider, resolver: resolverWithSearch(search) };
}

function resolverWithSearch(search?: TargetEmbeddingSearch): FrozenTargetResolver {
  return new FrozenTargetResolver({
    strategyRouter: new TargetStrategyRouter({
      ...(search === undefined ? {} : { embeddingSearch: search }),
    }),
  });
}

function input(
  query: TargetQuery,
  candidates: readonly PageTargetCandidate[],
): TargetResolutionInput {
  return {
    query,
    catalog: {
      documentId: "doc-1",
      pageId: "page-1",
      sceneRevision: 7,
      candidates,
    },
    frozenContext: FROZEN,
    recentOperations: [],
  };
}

function semanticCandidate(id: string, text: string, readingOrder: number): PageTargetCandidate {
  return {
    candidateId: `candidate:${id}`,
    source: "pdf",
    type: "sentence",
    pageId: "page-1",
    semanticObjectId: id,
    text,
    bounds: { x: 0, y: readingOrder * 20, width: 100, height: 16 },
    editable: false,
    annotatable: true,
    semanticUnit: "sentence",
    readingOrder,
  };
}

function paragraphCandidate(id: string, text: string, readingOrder: number): PageTargetCandidate {
  return {
    ...semanticCandidate(id, text, readingOrder),
    type: "paragraph",
    semanticUnit: "paragraph",
    sourceObjectId: id,
    semanticObjectId: undefined,
    sceneObjectId: `scene:${id}`,
  };
}

function lineCandidate(
  id: string,
  text: string,
  readingOrder: number,
  sceneObjectId = `scene:${id}`,
): PageTargetCandidate {
  return {
    candidateId: `candidate:${id}`,
    source: "pdf",
    type: "line",
    pageId: "page-1",
    sourceObjectId: id,
    sceneObjectId,
    text,
    bounds: { x: 0, y: readingOrder * 20, width: 100, height: 16 },
    editable: false,
    annotatable: true,
    semanticUnit: "line",
    readingOrder,
  };
}

function canvasTextCandidate(id: string, text: string, readingOrder: number): PageTargetCandidate {
  return {
    candidateId: `candidate:${id}`,
    source: "ggulnote",
    type: "text",
    pageId: "page-1",
    sourceObjectId: id,
    sceneObjectId: `scene:${id}`,
    text,
    bounds: { x: 0, y: readingOrder * 20, width: 100, height: 16 },
    editable: true,
    annotatable: true,
    readingOrder,
  };
}

function record(
  granularity: EmbeddingRecord["granularity"],
  sourceObjectId: string,
  vector: readonly number[],
  pageId = "page-1",
  sourceType: EmbeddingRecord["sourceType"] = "pdf",
): EmbeddingRecord {
  return {
    id: createEmbeddingRecordId("doc-1", pageId, granularity, sourceObjectId),
    documentId: "doc-1",
    pageId,
    sourceType,
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
