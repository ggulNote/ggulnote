export { ExistingPlacementEngine } from "./placement-engine";
export { spatialQueryForDestination } from "./placement-engine";
export type {
  ExistingPlacementEngineOptions,
  NotePlacementInput,
  NotePlacementResult,
} from "./placement-engine";
export { NoteRuntime } from "./note-runtime";
export type {
  NoteRuntimeOptions,
  NoteRuntimeResult,
  NoteRuntimeStepResult,
} from "./note-runtime";
export { NoteRuntimeMetricsRecorder } from "./note-runtime-metrics";
export type {
  NoteRuntimeMetricName,
  NoteRuntimeMetricSnapshot,
  NoteRuntimeMetricsSink,
} from "./note-runtime-metrics";
export { NoteAgentShadowTraceStore } from "./note-agent-trace";
export type { NoteAgentShadowTrace } from "./note-agent-trace";
export { NoteAgentShadowRoute } from "./note-agent-shadow-route";
export type { NoteAgentShadowRouteOptions } from "./note-agent-shadow-route";
export { NoteAgentProductionRoute } from "./note-agent-production-route";
export type { NoteAgentProductionRouteOptions } from "./note-agent-production-route";
export { percentiles, summarizeNoteAgentLatency } from "./note-agent-latency";
export type {
  NoteLatencyPercentiles,
  NoteToolLatencySummary,
} from "./note-agent-latency";
