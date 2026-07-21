import type { EditorEngine, PageSceneSnapshot } from "@ggulnote/editor-core";
import type { EditorPersistenceEvent, DocumentId, PageId } from "@ggulnote/editor-core";
import { LocalEditorPersistence } from "./local-editor-persistence";
import { LocalSaveQueue } from "./local-save-queue";
import type { DocumentRecordViewState, SaveState } from "../types";

const DEFAULT_RETRY_ATTEMPTS = 2;
const BASE_RETRY_DELAY_MS = 500;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface PersistenceCoordinatorOptions {
  onSaveStateChange?: (state: SaveState) => void;
  getDocumentViewState: () => DocumentRecordViewState;
}

type Listener = () => void;

export class PersistenceCoordinator {
  private readonly saveQueue = new LocalSaveQueue();
  private readonly listeners = new Set<Listener>();
  private unsubscribeOperation?: () => void;
  private startedDocumentId: DocumentId | null = null;
  private destroyed = false;

  public constructor(
    private readonly editorEngine: EditorEngine,
    private readonly persistence: LocalEditorPersistence,
    private readonly options: PersistenceCoordinatorOptions,
  ) {
    this.saveQueue.subscribe((state) => {
      this.emitSaveState(state);
    });
  }

  public get documentId(): DocumentId | null {
    return this.startedDocumentId;
  }

  public start(documentId: DocumentId): void {
    if (this.destroyed || this.startedDocumentId === documentId) {
      return;
    }

    if (this.startedDocumentId !== null) {
      this.stop();
    }

    this.startedDocumentId = documentId;
    this.unsubscribeOperation = this.editorEngine.subscribeToOperations((event) => {
      void this.handleOperationEvent(event);
    });
  }

  public async stopAndFlush(): Promise<void> {
    await this.flush();
    this.stop();
  }

  public stop(): void {
    if (this.unsubscribeOperation) {
      this.unsubscribeOperation();
      this.unsubscribeOperation = undefined;
    }

    this.startedDocumentId = null;
  }

  public destroy(): void {
    this.destroyed = true;
    this.stop();

    for (const listener of this.listeners) {
      listener();
    }

    this.listeners.clear();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async hydratePage(documentId: DocumentId, pageId: PageId, scene: (snapshot: PageSceneSnapshot) => void): Promise<boolean> {
    if (this.destroyed || this.startedDocumentId !== documentId) {
      return false;
    }

    const snapshot = await this.persistence.getPageSnapshot(documentId, pageId);
    if (!snapshot) {
      return false;
    }

    scene(snapshot);
    return true;
  }

  public async flush(): Promise<void> {
    await this.saveQueue.flush();
  }

  public getSaveState(): SaveState {
    return this.saveQueue.getSaveState();
  }

  private async handleOperationEvent(event: EditorPersistenceEvent): Promise<void> {
    if (this.destroyed || !this.startedDocumentId || event.documentId !== this.startedDocumentId) {
      return;
    }

    const snapshot = this.editorEngine.exportPageSnapshot(event.pageId);
    const viewState = this.options.getDocumentViewState();

    await this.saveQueue.enqueue(async () => {
      await this.retry(() =>
        this.persistence.saveOperation({
          event,
          snapshot,
          documentViewState: viewState,
        }),
      );
    });
  }

  private async retry<T>(runner: () => Promise<T>): Promise<T> {
    let attempts = 0;

    while (true) {
      try {
        return await runner();
      } catch (error) {
        attempts += 1;
        if (attempts > DEFAULT_RETRY_ATTEMPTS) {
          throw error;
        }

        const delay = BASE_RETRY_DELAY_MS * attempts;
        await wait(delay);
      }
    }
  }

  private emitSaveState(state: SaveState): void {
    this.options.onSaveStateChange?.(state);

    for (const listener of this.listeners) {
      listener();
    }
  }
}
