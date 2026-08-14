import type { NoteToolId } from "../domain";
import type { NoteAgentShadowTrace } from "./note-agent-trace";

export interface NoteLatencyPercentiles {
  readonly sampleCount: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
}

export interface NoteToolLatencySummary {
  readonly toolId: NoteToolId | "unknown";
  readonly contextAssemblyMs: NoteLatencyPercentiles;
  readonly decisionMs: NoteLatencyPercentiles;
  readonly prepareMs: NoteLatencyPercentiles;
  readonly commitMs: NoteLatencyPercentiles;
  readonly endToVisibleMs: NoteLatencyPercentiles;
}

export function summarizeNoteAgentLatency(
  traces: readonly NoteAgentShadowTrace[],
): readonly NoteToolLatencySummary[] {
  const groups = new Map<NoteToolId | "unknown", NoteAgentShadowTrace[]>();
  for (const trace of traces) {
    const key = trace.toolId ?? "unknown";
    const group = groups.get(key) ?? [];
    group.push(trace);
    groups.set(key, group);
  }
  return Object.freeze([...groups.entries()].map(([toolId, group]) => ({
    toolId,
    contextAssemblyMs: percentiles(group.map((trace) => trace.contextAssemblyMs ?? 0)),
    decisionMs: percentiles(group.map((trace) => trace.decisionMs)),
    prepareMs: percentiles(group.map((trace) => trace.prepareMs ?? 0)),
    commitMs: percentiles(group.map((trace) => trace.commitMs ?? 0)),
    endToVisibleMs: percentiles(group.map((trace) => trace.endToVisibleMs ?? trace.totalMs)),
  })));
}

export function percentiles(values: readonly number[]): NoteLatencyPercentiles {
  const finite = values.filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  return {
    sampleCount: finite.length,
    p50: nearestRank(finite, 0.5),
    p90: nearestRank(finite, 0.9),
    p95: nearestRank(finite, 0.95),
  };
}

function nearestRank(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0;
  const index = Math.max(0, Math.ceil(percentile * values.length) - 1);
  return values[index] ?? 0;
}
