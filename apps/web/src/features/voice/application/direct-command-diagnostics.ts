import type {
  DirectCommandLatencyMetrics,
  DirectCommandLifecycleTimestamps,
  DirectCommandTrace,
  DirectCommandTraceDiagnostics,
} from "../domain";

const DEFAULT_TRACE_CAPACITY = 64;

export interface DirectCommandTraceStoreOptions {
  capacity?: number;
}

export class DirectCommandTraceStore implements DirectCommandTraceDiagnostics {
  private readonly capacity: number;
  private readonly listeners = new Set<() => void>();
  private traces: readonly DirectCommandTrace[] = [];

  public constructor(options: DirectCommandTraceStoreOptions = {}) {
    this.capacity = positiveInteger(
      options.capacity ?? DEFAULT_TRACE_CAPACITY,
      "capacity",
    );
  }

  public record(trace: DirectCommandTrace): void {
    const next = [...this.traces, cloneTrace(trace)];
    this.traces = next.slice(Math.max(0, next.length - this.capacity));
    this.emit();
  }

  public getSnapshot(): readonly DirectCommandTrace[] {
    return this.traces;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public clear(): void {
    if (this.traces.length === 0) return;
    this.traces = [];
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // Diagnostics observers cannot affect command execution.
      }
    }
  }
}

export function calculateDirectCommandLatencyMetrics(
  timestamps: DirectCommandLifecycleTimestamps,
): DirectCommandLatencyMetrics {
  return {
    ...duration("plannerMs", timestamps.plannerRequestedAt, timestamps.plannerCompletedAt),
    ...duration("resolverMs", timestamps.resolverStartedAt, timestamps.resolverCompletedAt),
    ...duration(
      "disambiguatorMs",
      timestamps.disambiguatorRequestedAt,
      timestamps.disambiguatorCompletedAt,
    ),
    ...duration("validationMs", timestamps.validationStartedAt, timestamps.validatedAt),
    ...duration("compileMs", timestamps.compileStartedAt, timestamps.compiledAt),
    ...duration("commitMs", timestamps.commitStartedAt, timestamps.committedAt),
    ...duration("directRouteMs", timestamps.routeReceivedAt, timestamps.routeCompletedAt),
    ...duration("voiceEndToCommitMs", timestamps.voiceFinalizedAt, timestamps.committedAt),
  };
}

function duration(
  key: keyof DirectCommandLatencyMetrics,
  start: number | undefined,
  end: number | undefined,
): Partial<DirectCommandLatencyMetrics> {
  if (start === undefined || end === undefined || end < start) return {};
  return { [key]: end - start };
}

function cloneTrace(trace: DirectCommandTrace): DirectCommandTrace {
  return {
    ...trace,
    ...(trace.command === undefined ? {} : { command: { ...trace.command } }),
    timestamps: { ...trace.timestamps },
    metrics: { ...trace.metrics },
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}
