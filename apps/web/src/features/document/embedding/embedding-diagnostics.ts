import type {
  EmbeddingDiagnosticEvent,
  EmbeddingDiagnostics,
} from "./embedding-types";

const DEFAULT_CAPACITY = 64;

export class EmbeddingDiagnosticsStore implements EmbeddingDiagnostics {
  private readonly capacity: number;
  private events: readonly EmbeddingDiagnosticEvent[] = [];

  public constructor(capacity = DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Embedding diagnostics capacity must be positive.");
    }
    this.capacity = capacity;
  }

  public record(event: EmbeddingDiagnosticEvent): void {
    const next = [...this.events, cloneEvent(event)];
    this.events = next.slice(Math.max(0, next.length - this.capacity));
  }

  public getSnapshot(): readonly EmbeddingDiagnosticEvent[] {
    return this.events;
  }

  public clear(): void {
    this.events = [];
  }
}

function cloneEvent(event: EmbeddingDiagnosticEvent): EmbeddingDiagnosticEvent {
  return event.kind === "INDEX"
    ? { ...event, metrics: { ...event.metrics } }
    : { ...event, metrics: { ...event.metrics } };
}
