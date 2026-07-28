import type { SessionTimeMs } from "@ggulnote/shared-types";

import type {
  CalibrationObservation,
  CalibrationRawSample,
  CalibrationTarget,
  CalibrationTargetGenerationError,
  RepresentativeRawVector,
  Result,
  ResultError,
  SampleAcceptanceReason,
  SampleAcceptanceResult,
  SampleCollectorInput,
} from "../domain/calibration-types";
import {
  makeError,
  makeResult,
} from "../domain/calibration-types";

type Vector3Like = Readonly<{ readonly x: number; readonly y: number; readonly z: number }>;

const MIN_TRIM_SAFE_RATIO = 0;
const MAX_TRIM_RATIO = 0.5;

export class CalibrationSampleCollector {
  private readonly samplesByTarget = new Map<string, CalibrationRawSample[]>();
  private readonly seenSequenceIds = new Set<number>();

  public reset(): void {
    this.samplesByTarget.clear();
    this.seenSequenceIds.clear();
  }

  public collect(input: SampleCollectorInput): SampleAcceptanceResult {
    const {
      rawSample,
      activeTarget,
      sessionId,
      windowStartMs,
      windowEndMs,
    } = input;

    if (rawSample.sessionId !== sessionId) {
      return { ok: false, reason: "session-mismatch" };
    }

    if (!isFiniteWindow(windowStartMs, windowEndMs)) {
      return { ok: false, reason: "out-of-window" };
    }

    if (!Number.isFinite(rawSample.timestampMs)) {
      return { ok: false, reason: "invalid-number" };
    }

    if (!isFiniteVector(rawSample.rawVector)) {
      return { ok: false, reason: "invalid-number" };
    }

    if (activeTarget === null || rawSample.targetId !== activeTarget.id) {
      return { ok: false, reason: "not-collecting" };
    }

    const ts = Number(rawSample.timestampMs);
    if (ts < Number(windowStartMs)) {
      return { ok: false, reason: "out-of-window" };
    }
    if (ts > Number(windowEndMs)) {
      return { ok: false, reason: "late-response" };
    }

    if (rawSample.trackingQuality !== undefined && rawSample.trackingQuality !== null) {
      if (!Number.isFinite(rawSample.trackingQuality)) {
        return { ok: false, reason: "invalid-number" };
      }

      if (rawSample.trackingQuality <= 0) {
        return { ok: false, reason: "tracker-failure" };
      }
    }

    if (rawSample.sequenceId !== undefined) {
      if (!Number.isInteger(rawSample.sequenceId) || rawSample.sequenceId < 0) {
        return { ok: false, reason: "invalid-number" };
      }

      if (this.seenSequenceIds.has(rawSample.sequenceId)) {
        return { ok: false, reason: "duplicate-sequence" };
      }

      this.seenSequenceIds.add(rawSample.sequenceId);
    }

    const existing = this.samplesByTarget.get(rawSample.targetId);
    if (existing === undefined) {
      this.samplesByTarget.set(rawSample.targetId, [rawSample]);
    } else {
      existing.push(rawSample);
    }

    return { ok: true, sample: rawSample };
  }

  public getCollectedSampleCount(targetId: string): number {
    return this.samplesByTarget.get(targetId)?.length ?? 0;
  }

  public getCollectedSampleCountMap(): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    for (const [targetId, samples] of this.samplesByTarget.entries()) {
      counts.set(targetId, samples.length);
    }

    return counts;
  }

  public getAllSamplesForTarget(targetId: string): readonly CalibrationRawSample[] {
    return this.samplesByTarget.get(targetId) ?? [];
  }

  public getRepresentative(
    target: CalibrationTarget,
    minimumSamplesPerTarget: number,
    trimRatio: number,
  ): Result<RepresentativeRawVector, CalibrationTargetGenerationError> {
    const samples = this.samplesByTarget.get(target.id) ?? [];
    if (samples.length < minimumSamplesPerTarget) {
      return makeError("sample-count", `Not enough samples for target ${target.id}.`);
    }

    const representativeVector = trimmedMeanVector(samples.map((sample) => sample.rawVector), trimRatio);
    if (representativeVector === null) {
      return makeError("sample-count", `No finite vectors for target ${target.id}.`);
    }

    const representativeTimestampMs = medianFinite(samples.map((sample) => sample.timestampMs));
    if (!Number.isFinite(representativeTimestampMs)) {
      return makeError("sample-count", `No valid timestamps for target ${target.id}.`);
    }

    return makeResult<RepresentativeRawVector>({
      target,
      rawVector: representativeVector,
      representativeTimestampMs,
    });
  }

  public getRepresentativeObservation(
    target: CalibrationTarget,
    minimumSamplesPerTarget: number,
    trimRatio: number,
    sessionId: number,
  ): Result<CalibrationObservation, CalibrationTargetGenerationError> {
    const representative = this.getRepresentative(target, minimumSamplesPerTarget, trimRatio);
    if (!representative.ok) {
      return representative;
    }

    return makeResult<CalibrationObservation>({
      target,
      sample: {
        targetId: target.id,
        sessionId,
        timestampMs: representative.value.representativeTimestampMs,
        rawVector: representative.value.rawVector,
      },
    });
  }

  public getRepresentativeVectors(
    targets: readonly CalibrationTarget[],
    minimumSamplesPerTarget: number,
    trimRatio: number,
  ): readonly RepresentativeRawVector[] {
    const result: RepresentativeRawVector[] = [];
    for (const target of targets) {
      const representative = this.getRepresentative(target, minimumSamplesPerTarget, trimRatio);
      if (representative.ok) {
        result.push({
          target,
          rawVector: representative.value.rawVector,
          representativeTimestampMs: representative.value.representativeTimestampMs,
        });
      }
    }

    return result;
  }
}

export const makeRejectionCounter = (): ReadonlyMap<SampleAcceptanceReason, number> =>
  new Map<SampleAcceptanceReason, number>([
    ["session-mismatch", 0],
    ["duplicate-sequence", 0],
    ["out-of-window", 0],
    ["late-response", 0],
    ["invalid-number", 0],
    ["invalid-quality", 0],
    ["tracker-failure", 0],
    ["not-collecting", 0],
  ]);

export const incrementRejectionCounter = (
  current: ReadonlyMap<SampleAcceptanceReason, number>,
  reason: SampleAcceptanceReason,
): ReadonlyMap<SampleAcceptanceReason, number> => {
  const next = new Map(current);
  next.set(reason, (next.get(reason) ?? 0) + 1);
  return next;
};

export const isCollectingWindowActive = (start: SessionTimeMs | null, end: SessionTimeMs | null, now: number): boolean => {
  return start !== null && end !== null && Number.isFinite(now) && now >= Number(start) && now <= Number(end);
};

function isFiniteWindow(start: SessionTimeMs | null, end: SessionTimeMs | null): boolean {
  return (
    start !== null
    && end !== null
    && Number.isFinite(start)
    && Number.isFinite(end)
    && Number(end) > Number(start)
  );
}

function isFiniteVector(value: unknown): value is Vector3Like {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Vector3Like;
  return (
    Number.isFinite(candidate.x)
    && Number.isFinite(candidate.y)
    && Number.isFinite(candidate.z)
    && Number.isFinite(Math.hypot(candidate.x, candidate.y, candidate.z))
  );
}

function trimmedMean(values: readonly number[], trimRatio: number): number | null {
  const sorted = values.filter(Number.isFinite).slice().sort((left, right) => left - right);
  if (!sorted.length) {
    return null;
  }

  const ratio = Math.min(MAX_TRIM_RATIO, Math.max(MIN_TRIM_SAFE_RATIO, trimRatio));
  const remove = Math.floor(sorted.length * ratio);

  const start = Math.min(sorted.length - 1, Math.max(0, remove));
  const end = Math.max(start, sorted.length - remove);

  const section = sorted.slice(start, end);
  if (!section.length) {
    return null;
  }

  const sum = section.reduce((acc, value) => acc + value, 0);
  return sum / section.length;
}

function trimmedMeanVector(values: readonly Vector3Like[], trimRatio: number): { x: number; y: number; z: number } | null {
  const x = trimmedMean(values.map((value) => value.x), trimRatio);
  const y = trimmedMean(values.map((value) => value.y), trimRatio);
  const z = trimmedMean(values.map((value) => value.z), trimRatio);

  if (
    x === null
    || y === null
    || z === null
    || !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(z)
  ) {
    return null;
  }

  return { x, y, z };
}

function medianFinite(values: readonly number[]): number {
  const finite = values.filter(Number.isFinite).slice().sort((left, right) => left - right);
  if (!finite.length) {
    return Number.NaN;
  }

  const index = Math.floor(finite.length / 2);
  if (finite.length % 2 === 1) {
    return finite[index] ?? Number.NaN;
  }

  const previous = finite[index - 1];
  const next = finite[index];
  if (previous === undefined || next === undefined) {
    return Number.NaN;
  }

  return (previous + next) / 2;
}
