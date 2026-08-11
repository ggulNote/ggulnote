import type { EditorEngine } from "@ggulnote/editor-core";
import { SemanticEmbeddingIndexer } from "./semantic-embedding-indexer";

const DEFAULT_DEBOUNCE_MS = 500;

export interface CanvasEmbeddingIndexCoordinatorOptions {
  debounceMs?: number;
}

export class CanvasEmbeddingIndexCoordinator {
  private unsubscribe?: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abortController = new AbortController();
  private lastSignature = "";
  private readonly debounceMs: number;

  public constructor(
    private readonly editorEngine: EditorEngine,
    private readonly indexer: SemanticEmbeddingIndexer,
    options: CanvasEmbeddingIndexCoordinatorOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    if (!Number.isFinite(this.debounceMs) || this.debounceMs < 0) {
      throw new RangeError("Canvas embedding debounce must not be negative.");
    }
  }

  public start(): void {
    if (this.unsubscribe) return;
    if (this.abortController.signal.aborted) this.abortController = new AbortController();
    this.unsubscribe = this.editorEngine.subscribeToOperations(() => this.schedule());
  }

  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.abortController.abort();
  }

  public async indexCurrentPage(): Promise<void> {
    const documentId = this.editorEngine.getDocumentId();
    const pageId = this.editorEngine.getActivePageId();
    if (!documentId || !pageId) return;
    const snapshot = this.editorEngine.exportPageSnapshot(pageId);
    const signature = `${documentId}:${pageId}:${snapshot.revision}`;
    if (signature === this.lastSignature) return;
    await this.indexer.indexCanvasPage({
      documentId,
      pageId,
      snapshot,
      signal: this.abortController.signal,
    });
    this.lastSignature = signature;
  }

  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.indexCurrentPage().catch(() => {
        // Embedding failure never blocks editor operations.
      });
    }, this.debounceMs);
  }
}
