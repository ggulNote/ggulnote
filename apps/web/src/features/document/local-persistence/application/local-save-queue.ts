import type { SaveState } from "../types";

type SaveQueueListener = (state: SaveState) => void;

type QueueState = {
  pendingCount: number;
  lastError: string | null;
  lastSavedAt: number | null;
  status: SaveState["status"];
  hasError: boolean;
};

export class LocalSaveQueue {
  private readonly listeners = new Set<SaveQueueListener>();
  private state: QueueState = {
    pendingCount: 0,
    lastError: null,
    lastSavedAt: null,
    status: "idle",
    hasError: false,
  };
  private chain = Promise.resolve();

  public subscribe(listener: SaveQueueListener): () => void {
    this.listeners.add(listener);
    listener(this.getSaveState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSaveState(): SaveState {
    return {
      status: this.state.status,
      errorMessage: this.state.hasError ? this.state.lastError : null,
      pendingCount: this.state.pendingCount,
      lastSavedAt: this.state.lastSavedAt,
    };
  }

  public async flush(): Promise<void> {
    await this.chain;
  }

  public enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain
      .then(async () => {
        this.state.pendingCount += 1;
        this.state.status = "saving";
        this.state.hasError = false;
        this.state.lastError = null;
        this.notify();

        try {
          const value = await task();
          this.state.lastSavedAt = Date.now();
          this.state.status = this.state.pendingCount === 1 ? "saved" : "saving";
          return value;
        } catch (error) {
          const message = error instanceof Error ? error.message : "저장에 실패했습니다.";
          this.state.status = "error";
          this.state.hasError = true;
          this.state.lastError = message;
          throw error;
        } finally {
          this.state.pendingCount = Math.max(0, this.state.pendingCount - 1);
          if (this.state.pendingCount === 0 && this.state.status !== "error") {
            this.state.status = this.state.lastSavedAt === null ? "idle" : "saved";
          }
          this.notify();
        }
      })
      .finally(() => undefined);

    this.chain = run.catch(() => undefined);
    return run;
  }

  private notify(): void {
    const current = this.getSaveState();
    for (const listener of this.listeners) {
      listener(current);
    }
  }
}
