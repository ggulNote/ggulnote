import { meanVector } from "../math/statistics";
import type { SessionTimeMs } from "@ggulnote/shared-types";
import type { Vector3 } from "../types/vector";

export interface GazeVectorSample {
  readonly vector: Vector3;
  readonly time: SessionTimeMs;
}

export class GazeVectorMovingAverage {
  private readonly samples: GazeVectorSample[] = [];

  public constructor(
    private readonly maxWindowSize: number,
    private readonly maxAgeMs: number,
  ) {
    if (!Number.isFinite(maxWindowSize) || maxWindowSize <= 0) {
      throw new RangeError("maxWindowSize must be a positive integer.");
    }

    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      throw new RangeError("maxAgeMs must be a positive value.");
    }
  }

  public append(vector: Vector3, timestampMs: SessionTimeMs): void {
    this.samples.push({ vector, time: timestampMs });
    this.prune(timestampMs);

    if (this.samples.length > this.maxWindowSize) {
      this.samples.shift();
    }
  }

  public get count(): number {
    return this.samples.length;
  }

  public clear(): void {
    this.samples.length = 0;
  }

  public prune(nowMs: SessionTimeMs): void {
    const oldestAllowed = Number(nowMs) - this.maxAgeMs;
    while (this.samples.length > 0 && Number(this.samples[0].time) < oldestAllowed) {
      this.samples.shift();
    }
  }

  public getAverage(): {
    readonly vector: Vector3;
    readonly startedAt: SessionTimeMs;
    readonly endedAt: SessionTimeMs;
  } | null {
    if (this.samples.length === 0) {
      return null;
    }

    const vectors = this.samples.map((sample) => sample.vector);
    const vector = meanVector(vectors);
    if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) {
      return null;
    }

    return {
      vector,
      startedAt: this.samples[0].time,
      endedAt: this.samples[this.samples.length - 1].time,
    };
  }
}
