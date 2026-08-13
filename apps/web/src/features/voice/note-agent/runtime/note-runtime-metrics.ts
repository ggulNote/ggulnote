export type NoteRuntimeMetricName =
  | "resolverMs"
  | "computeMs"
  | "placementMs";

export interface NoteRuntimeMetricSnapshot {
  readonly resolverMs: number;
  readonly computeMs: number;
  readonly placementMs: number;
}

export interface NoteRuntimeMetricsSink {
  now(): number;
  add(name: NoteRuntimeMetricName, durationMs: number): void;
}

export class NoteRuntimeMetricsRecorder implements NoteRuntimeMetricsSink {
  private readonly values: Record<NoteRuntimeMetricName, number> = {
    resolverMs: 0,
    computeMs: 0,
    placementMs: 0,
  };

  public constructor(private readonly readTime: () => number = Date.now) {}

  public now(): number {
    return this.readTime();
  }

  public add(name: NoteRuntimeMetricName, durationMs: number): void {
    if (Number.isFinite(durationMs) && durationMs >= 0) {
      this.values[name] += durationMs;
    }
  }

  public snapshot(): NoteRuntimeMetricSnapshot {
    return Object.freeze({ ...this.values });
  }
}
