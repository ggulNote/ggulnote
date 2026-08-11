import { EditorEngine } from "@ggulnote/editor-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasEmbeddingIndexCoordinator } from "./canvas-embedding-index-coordinator";
import type { SemanticEmbeddingIndexer } from "./semantic-embedding-indexer";

afterEach(() => {
  vi.useRealTimers();
});

describe("CanvasEmbeddingIndexCoordinator", () => {
  it("indexes the committed snapshot after debounce and follows undo/redo revisions", async () => {
    vi.useFakeTimers();
    const editor = new EditorEngine();
    editor.setDocument("doc-1");
    editor.setActivePage("page-1", { width: 100, height: 100 });
    const indexCanvasPage = vi.fn().mockResolvedValue({
      requested: 1,
      cacheHits: 0,
      cacheMisses: 1,
      generated: 1,
      batches: 1,
    });
    const coordinator = new CanvasEmbeddingIndexCoordinator(
      editor,
      { indexCanvasPage } as unknown as SemanticEmbeddingIndexer,
      { debounceMs: 10 },
    );
    coordinator.start();

    editor.createAnnotation({
      type: "TEXT",
      pageId: "page-1",
      bounds: { x: 0, y: 0, width: 0.2, height: 0.1 },
      text: "memo",
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(indexCanvasPage).toHaveBeenCalledTimes(1);
    expect(indexCanvasPage.mock.calls[0]?.[0].snapshot.annotations[0].properties.text).toBe("memo");

    editor.undo();
    await vi.advanceTimersByTimeAsync(10);
    expect(indexCanvasPage).toHaveBeenCalledTimes(2);
    expect(indexCanvasPage.mock.calls[1]?.[0].snapshot.annotations).toEqual([]);

    editor.redo();
    await vi.advanceTimersByTimeAsync(10);
    expect(indexCanvasPage).toHaveBeenCalledTimes(3);
    coordinator.stop();
  });
});
