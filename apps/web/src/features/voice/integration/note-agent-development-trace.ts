import type { NoteAgentShadowTrace } from "../note-agent";

const NOTE_AGENT_TRACE_LABEL = "[voice/note-agent-v2]";

interface NoteAgentTraceSource {
  getAll(): readonly NoteAgentShadowTrace[];
  subscribe(listener: () => void): () => void;
}

export type NoteAgentDevelopmentTraceSummary = Pick<NoteAgentShadowTrace,
  | "runtimeOwner"
  | "decisionSchemaVersion"
  | "turnId"
  | "catalogHandles"
  | "selectedHandle"
  | "decisionStatus"
  | "decisionAction"
  | "decisionReferenceHandle"
  | "decisionRelation"
  | "groundingMode"
  | "resolvedTargetHandle"
  | "resolvedCanvasBounds"
  | "finalLocalOperation"
  | "resultStatus"
  | "errorCode"
  | "commitAttempted"
  | "visualContextRequested"
  | "visualContextAttached"
  | "visualContextFailureReason"
  | "markedScreenshotObjectCount"
  | "markedScreenshotHandles"
  | "legacyPlannerInvoked"
  | "fuzzyObjectSelectorInvoked"
  | "prepareMs"
  | "commitMs"
>;

export function subscribeToDevelopmentNoteAgentTraces(
  source: NoteAgentTraceSource,
  options: {
    readonly enabled?: boolean;
    readonly logger?: (
      label: typeof NOTE_AGENT_TRACE_LABEL,
      summary: NoteAgentDevelopmentTraceSummary,
    ) => void;
  } = {},
): () => void {
  if (!(options.enabled ?? process.env.NODE_ENV === "development")) {
    return () => undefined;
  }
  const logger = options.logger ?? logDevelopmentTrace;
  let observedCount = source.getAll().length;
  return source.subscribe(() => {
    const traces = source.getAll();
    if (traces.length < observedCount) observedCount = 0;
    for (const trace of traces.slice(observedCount)) {
      logger(NOTE_AGENT_TRACE_LABEL, summarizeNoteAgentTrace(trace));
    }
    observedCount = traces.length;
  });
}

export function summarizeNoteAgentTrace(
  trace: NoteAgentShadowTrace,
): NoteAgentDevelopmentTraceSummary {
  return {
    runtimeOwner: trace.runtimeOwner,
    decisionSchemaVersion: trace.decisionSchemaVersion,
    turnId: trace.turnId,
    ...(trace.catalogHandles === undefined ? {} : { catalogHandles: [...trace.catalogHandles] }),
    ...(trace.selectedHandle === undefined ? {} : { selectedHandle: trace.selectedHandle }),
    ...(trace.decisionStatus === undefined ? {} : { decisionStatus: trace.decisionStatus }),
    ...(trace.decisionAction === undefined ? {} : { decisionAction: trace.decisionAction }),
    ...(trace.decisionReferenceHandle === undefined
      ? {}
      : { decisionReferenceHandle: trace.decisionReferenceHandle }),
    ...(trace.decisionRelation === undefined ? {} : { decisionRelation: trace.decisionRelation }),
    ...(trace.groundingMode === undefined ? {} : { groundingMode: trace.groundingMode }),
    ...(trace.resolvedTargetHandle === undefined
      ? {}
      : { resolvedTargetHandle: trace.resolvedTargetHandle }),
    ...(trace.resolvedCanvasBounds === undefined
      ? {}
      : { resolvedCanvasBounds: { ...trace.resolvedCanvasBounds } }),
    ...(trace.finalLocalOperation === undefined
      ? {}
      : { finalLocalOperation: trace.finalLocalOperation }),
    resultStatus: trace.resultStatus,
    ...(trace.errorCode === undefined ? {} : { errorCode: trace.errorCode }),
    commitAttempted: trace.commitAttempted,
    ...(trace.visualContextRequested === undefined
      ? {}
      : { visualContextRequested: trace.visualContextRequested }),
    ...(trace.visualContextAttached === undefined
      ? {}
      : { visualContextAttached: trace.visualContextAttached }),
    ...(trace.visualContextFailureReason === undefined
      ? {}
      : { visualContextFailureReason: trace.visualContextFailureReason }),
    ...(trace.markedScreenshotObjectCount === undefined
      ? {}
      : { markedScreenshotObjectCount: trace.markedScreenshotObjectCount }),
    ...(trace.markedScreenshotHandles === undefined
      ? {}
      : { markedScreenshotHandles: [...trace.markedScreenshotHandles] }),
    legacyPlannerInvoked: trace.legacyPlannerInvoked,
    fuzzyObjectSelectorInvoked: trace.fuzzyObjectSelectorInvoked,
    ...(trace.prepareMs === undefined ? {} : { prepareMs: trace.prepareMs }),
    ...(trace.commitMs === undefined ? {} : { commitMs: trace.commitMs }),
  };
}

function logDevelopmentTrace(
  label: typeof NOTE_AGENT_TRACE_LABEL,
  summary: NoteAgentDevelopmentTraceSummary,
): void {
  console.debug(`${label} ${JSON.stringify(summary)}`);
}
