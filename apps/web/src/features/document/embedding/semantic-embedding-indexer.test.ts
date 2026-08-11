import type {
  PageSemanticModel,
  SemanticObject,
  SemanticParagraph,
  SemanticSentence,
} from "@ggulnote/document-core";
import type { PageSceneSnapshot, SerializedAnnotation } from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import { FakeEmbeddingProvider } from "./providers/testing/fake-embedding-provider";
import { SemanticEmbeddingIndexer } from "./semantic-embedding-indexer";
import { InMemoryEmbeddingStore } from "./testing/in-memory-embedding-store";

describe("SemanticEmbeddingIndexer", () => {
  it("indexes PDF sentence and paragraph objects in one batch and skips word/line units", async () => {
    const store = new InMemoryEmbeddingStore();
    const provider = providerFor("model-a");
    const indexer = new SemanticEmbeddingIndexer(store, provider, { now: () => 10 });
    const model = modelWith([
      sentence("sentence-1", "First sentence", 1),
      paragraph("paragraph-1", "First paragraph", 2),
      basicObject("WORD", "word-1", "First", 0),
      basicObject("LINE", "line-1", "First sentence", 1),
    ]);

    await expect(indexer.indexPdfPage({ documentId: "doc-1", pageId: "page-1", semanticModel: model }))
      .resolves.toEqual({ requested: 2, cacheHits: 0, cacheMisses: 2, generated: 2, batches: 1 });
    expect(provider.batches).toEqual([["First sentence", "First paragraph"]]);
    expect(store.getAll().map((record) => record.granularity).sort()).toEqual(["paragraph", "sentence"]);
  });

  it("reuses cache, refreshes only changed content, and invalidates on model change", async () => {
    const store = new InMemoryEmbeddingStore();
    const providerA = providerFor("model-a");
    const firstIndexer = new SemanticEmbeddingIndexer(store, providerA);
    const original = modelWith([
      sentence("sentence-1", "First sentence", 1),
      sentence("sentence-2", "Second sentence", 2),
    ]);
    await firstIndexer.indexPdfPage({ documentId: "doc-1", pageId: "page-1", semanticModel: original });

    const cached = await firstIndexer.indexPdfPage({ documentId: "doc-1", pageId: "page-1", semanticModel: original });
    expect(cached).toMatchObject({ cacheHits: 2, cacheMisses: 0, generated: 0, batches: 0 });
    expect(providerA.batches).toHaveLength(1);

    const changed = modelWith([
      sentence("sentence-1", "First sentence changed", 1),
      sentence("sentence-2", "Second sentence", 2),
    ]);
    const partial = await firstIndexer.indexPdfPage({ documentId: "doc-1", pageId: "page-1", semanticModel: changed });
    expect(partial).toMatchObject({ cacheHits: 1, cacheMisses: 1, generated: 1 });
    expect(providerA.batches.at(-1)).toEqual(["First sentence changed"]);

    const providerB = providerFor("model-b");
    const modelChangedIndexer = new SemanticEmbeddingIndexer(store, providerB);
    const staleModel = await modelChangedIndexer.indexPdfPage({ documentId: "doc-1", pageId: "page-1", semanticModel: changed });
    expect(staleModel).toMatchObject({ cacheHits: 0, cacheMisses: 2, generated: 2 });
  });

  it("deduplicates concurrent indexing for the same page contents", async () => {
    const store = new InMemoryEmbeddingStore();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const provider = providerFor("model-a");
    const originalEmbed = provider.embed.bind(provider);
    provider.embed = async (texts, options) => {
      await gate;
      return originalEmbed(texts, options);
    };
    const indexer = new SemanticEmbeddingIndexer(store, provider);
    const input = {
      documentId: "doc-1",
      pageId: "page-1",
      semanticModel: modelWith([sentence("sentence-1", "First sentence", 1)]),
    } as const;

    const first = indexer.indexPdfPage(input);
    const second = indexer.indexPdfPage(input);
    release?.();
    await Promise.all([first, second]);

    expect(provider.batches).toHaveLength(1);
  });

  it("indexes only current Canvas TEXT, refreshes edits, and removes deleted sources", async () => {
    const store = new InMemoryEmbeddingStore();
    const provider = providerFor("model-a");
    const indexer = new SemanticEmbeddingIndexer(store, provider);
    const first = canvasSnapshot([
      textAnnotation("text-1", "Backpropagation uses the chain rule", 4),
      shapeAnnotation("shape-1"),
    ], 4);
    await indexer.indexCanvasPage({ documentId: "doc-1", pageId: "page-1", snapshot: first });
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]).toMatchObject({ sourceObjectId: "text-1", granularity: "canvas_text", sourceRevision: 4 });

    const edited = canvasSnapshot([textAnnotation("text-1", "Backpropagation applies the chain rule", 5)], 5);
    await indexer.indexCanvasPage({ documentId: "doc-1", pageId: "page-1", snapshot: edited });
    expect(provider.batches.at(-1)).toEqual(["Backpropagation applies the chain rule"]);
    expect(store.getAll()[0]?.sourceRevision).toBe(5);

    await indexer.indexCanvasPage({ documentId: "doc-1", pageId: "page-1", snapshot: canvasSnapshot([], 6) });
    expect(store.getAll()).toEqual([]);
  });
});

function providerFor(model: string): FakeEmbeddingProvider {
  return new FakeEmbeddingProvider({ model, dimensions: 3 });
}

function modelWith(objects: readonly SemanticObject[], signature = "source-v1"): PageSemanticModel {
  return {
    getAllByReadingOrder: () => [...objects],
    toSerialized: () => ({
      documentId: "doc-1",
      pageId: "page-1",
      pageNumber: 1,
      extractorVersion: "test",
      schemaVersion: 3,
      sourceSignature: signature,
    }),
  } as unknown as PageSemanticModel;
}

function base(id: string, text: string, readingOrder: number) {
  return {
    id,
    pageId: "page-1",
    text,
    normalizedText: text,
    bounds: { x: 0, y: readingOrder, width: 10, height: 1 },
    readingOrder,
    confidence: 1,
    orientation: { angle: 0, writingMode: "horizontal" as const },
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
  };
}

function sentence(id: string, text: string, readingOrder: number): SemanticSentence {
  return {
    ...base(id, text, readingOrder),
    type: "SENTENCE",
    wordIds: [],
    lineIds: [],
    paragraphId: "paragraph-1",
    startWordId: "",
    endWordId: "",
    fragments: [],
  };
}

function paragraph(id: string, text: string, readingOrder: number): SemanticParagraph {
  return {
    ...base(id, text, readingOrder),
    type: "PARAGRAPH",
    lineIds: [],
    sentenceIds: [],
    columnIndex: 0,
    fragments: [],
  };
}

function basicObject(type: "WORD" | "LINE", id: string, text: string, readingOrder: number): SemanticObject {
  return { ...base(id, text, readingOrder), type } as SemanticObject;
}

function canvasSnapshot(annotations: SerializedAnnotation[], revision: number): PageSceneSnapshot {
  return { documentId: "doc-1", pageId: "page-1", pageNumber: 1, revision, annotations };
}

function textAnnotation(id: string, text: string, updatedAt: number): SerializedAnnotation {
  return {
    schemaVersion: 1,
    id,
    pageId: "page-1",
    type: "TEXT",
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    zIndex: 1,
    properties: { text },
    createdAt: 1,
    updatedAt,
  };
}

function shapeAnnotation(id: string): SerializedAnnotation {
  return {
    ...textAnnotation(id, "must not be indexed", 1),
    type: "SHAPE",
  };
}
