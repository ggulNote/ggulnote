import type {
  PursuitTargetHistorySample,
  PursuitTrajectoryRole,
} from "../domain/pursuit-types";

export type PursuitTargetHistoryError =
  | "invalid-input"
  | "duplicate-timestamp"
  | "not-found"
  | "out-of-range";

export type PursuitTargetHistoryAddResult =
  | Readonly<{ readonly ok: true; readonly sample: PursuitTargetHistorySample }>
  | Readonly<{ readonly ok: false; readonly reason: PursuitTargetHistoryError }>;

export type PursuitTargetHistoryLookupResult =
  | Readonly<{
    readonly ok: true;
    readonly sample: {
      readonly timestampMs: number;
      readonly segmentId: string;
      readonly role: PursuitTrajectoryRole;
      readonly targetCenter: Readonly<{ x: number; y: number }>;
    };
  }>
  | Readonly<{ readonly ok: false; readonly reason: PursuitTargetHistoryError }>;

type PursuitTargetHistoryOptions = Readonly<{
  readonly keepSampleAgeMs?: number;
}>;

type HistoryEntry = PursuitTargetHistorySample;

export class PursuitTargetHistory {
  private readonly samplesByKey = new Map<string, HistoryEntry[]>();
  private readonly keepSampleAgeMs: number;

  public constructor(options: PursuitTargetHistoryOptions = {}) {
    this.keepSampleAgeMs = options.keepSampleAgeMs ?? Number.POSITIVE_INFINITY;
  }

  public reset(): void {
    this.samplesByKey.clear();
  }

  public addSample(sample: PursuitTargetHistorySample): PursuitTargetHistoryAddResult {
    if (!isFiniteHistorySample(sample)) {
      return { ok: false, reason: "invalid-input" };
    }

    const key = createHistoryKey(sample.role, sample.segmentId);
    const current = this.samplesByKey.get(key) ?? [];

    const insertIndex = lowerBound(current, sample.timestampMs);
    const existing = current[insertIndex];
    if (existing !== undefined && existing.timestampMs === sample.timestampMs) {
      return { ok: false, reason: "duplicate-timestamp" };
    }

    const next = [...current];
    next.splice(insertIndex, 0, sample);

    const cleaned = this.cleanup(next, sample.timestampMs);
    this.samplesByKey.set(key, cleaned);

    return { ok: true, sample };
  }

  public getExactSample(
    role: PursuitTrajectoryRole,
    segmentId: string,
    timestampMs: number,
  ): PursuitTargetHistoryLookupResult {
    if (!Number.isFinite(timestampMs)) {
      return { ok: false, reason: "invalid-input" };
    }

    const values = this.samplesByKey.get(createHistoryKey(role, segmentId));
    if (values === undefined || values.length === 0) {
      return { ok: false, reason: "not-found" };
    }

    const index = lowerBound(values, timestampMs);
    const exact = values[index];
    if (exact === undefined) {
      return { ok: false, reason: "not-found" };
    }

    if (exact.timestampMs !== timestampMs) {
      return { ok: false, reason: "not-found" };
    }

    return { ok: true, sample: exact };
  }

  public getTargetCenterAtTimestamp(
    role: PursuitTrajectoryRole,
    segmentId: string,
    timestampMs: number,
  ): PursuitTargetHistoryLookupResult {
    if (!Number.isFinite(timestampMs)) {
      return { ok: false, reason: "invalid-input" };
    }

    const values = this.samplesByKey.get(createHistoryKey(role, segmentId));
    if (values === undefined || values.length === 0) {
      return { ok: false, reason: "not-found" };
    }

    const minTs = values[0]?.timestampMs;
    const maxTs = values[values.length - 1]?.timestampMs;
    if (minTs === undefined || maxTs === undefined || timestampMs < minTs || timestampMs > maxTs) {
      return { ok: false, reason: "out-of-range" };
    }

    const index = lowerBound(values, timestampMs);
    const exact = values[index];
    if (exact !== undefined && exact.timestampMs === timestampMs) {
      return { ok: true, sample: exact };
    }

    const left = values[index - 1];
    const right = values[index];
    if (left === undefined || right === undefined) {
      return { ok: false, reason: "out-of-range" };
    }

    const deltaTime = right.timestampMs - left.timestampMs;
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      return { ok: false, reason: "out-of-range" };
    }

    const ratio = (timestampMs - left.timestampMs) / deltaTime;
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      return { ok: false, reason: "out-of-range" };
    }

    return {
      ok: true,
      sample: {
        timestampMs,
        segmentId,
        role,
        targetCenter: {
          x: left.targetCenter.x + (right.targetCenter.x - left.targetCenter.x) * ratio,
          y: left.targetCenter.y + (right.targetCenter.y - left.targetCenter.y) * ratio,
        },
      },
    };
  }

  public getSamples(
    role: PursuitTrajectoryRole,
    segmentId: string,
  ): readonly PursuitTargetHistorySample[] {
    return this.samplesByKey.get(createHistoryKey(role, segmentId)) ?? [];
  }

  private cleanup(values: HistoryEntry[], latestTs: number): HistoryEntry[] {
    if (!Number.isFinite(this.keepSampleAgeMs) || this.keepSampleAgeMs === Number.POSITIVE_INFINITY) {
      return values;
    }

    if (!Number.isFinite(latestTs) || this.keepSampleAgeMs <= 0) {
      return values;
    }

    const cutoff = latestTs - this.keepSampleAgeMs;
    let firstValid = 0;
    while (firstValid < values.length && values[firstValid]?.timestampMs !== undefined && values[firstValid]?.timestampMs < cutoff) {
      firstValid += 1;
    }

    return firstValid === 0 ? values : values.slice(firstValid);
  }
}

function createHistoryKey(role: PursuitTrajectoryRole, segmentId: string): string {
  return `${role}::${segmentId}`;
}

function lowerBound(values: HistoryEntry[], targetTs: number): number {
  let left = 0;
  let right = values.length;

  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    const candidate = values[middle];
    if (candidate === undefined) {
      right = middle;
      continue;
    }

    if (candidate.timestampMs < targetTs) {
      left = middle + 1;
    } else {
      right = middle;
    }
  }

  return left;
}

function isFiniteHistorySample(sample: PursuitTargetHistorySample): boolean {
  return Number.isFinite(sample.timestampMs)
    && Number.isFinite(sample.targetCenter.x)
    && Number.isFinite(sample.targetCenter.y)
    && (sample.role === "calibration" || sample.role === "validation");
}
