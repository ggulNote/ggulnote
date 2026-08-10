import type { DirectCommandTrace } from "../domain";

const DIRECT_COMMAND_TRACE_LABEL = "[voice/direct-command]";

export interface DirectCommandDevelopmentTraceSummary {
  turnId: string;
  command?: string;
  speechRefinerUsed?: boolean;
  speechRefinerResult?: DirectCommandTrace["speechRefinerResult"];
  targetQueryKind?: DirectCommandTrace["targetQueryKind"];
  targetSlotKind?: DirectCommandTrace["targetSlotKind"];
  localTermUniverseSize?: number;
  phoneticHitCount?: number;
  mergedCandidateCount?: number;
  initialResolutionStatus?: DirectCommandTrace["initialResolutionStatus"];
  initialResolutionReason?: DirectCommandTrace["initialResolutionReason"];
  targetRecoveryUsed: boolean;
  targetRecoveryKind?: DirectCommandTrace["targetRecoveryKind"];
  targetRecoveryResult?: DirectCommandTrace["recoveryResult"];
  finalResolutionStatus?: DirectCommandTrace["finalResolutionStatus"];
  guardStatus: DirectCommandTrace["guardStatus"];
  executionStatus: DirectCommandTrace["executionStatus"];
  errorCode?: DirectCommandTrace["errorCode"];
  latencyMs: DirectCommandTrace["metrics"];
}

interface DirectCommandTraceSource {
  getSnapshot(): readonly DirectCommandTrace[];
  subscribe(listener: () => void): () => void;
}

export interface DirectCommandDevelopmentTraceOptions {
  enabled?: boolean;
  logger?: (
    label: typeof DIRECT_COMMAND_TRACE_LABEL,
    summary: DirectCommandDevelopmentTraceSummary,
  ) => void;
}

export function subscribeToDevelopmentDirectCommandTraces(
  source: DirectCommandTraceSource,
  options: DirectCommandDevelopmentTraceOptions = {},
): () => void {
  const enabled = options.enabled ?? process.env.NODE_ENV === "development";
  if (!enabled) return () => undefined;

  const logger = options.logger ?? logDevelopmentTrace;
  let observedCount = source.getSnapshot().length;

  return source.subscribe(() => {
    const traces = source.getSnapshot();
    if (traces.length < observedCount) observedCount = 0;
    for (const trace of traces.slice(observedCount)) {
      logger(DIRECT_COMMAND_TRACE_LABEL, summarizeDirectCommandTrace(trace));
    }
    observedCount = traces.length;
  });
}

export function summarizeDirectCommandTrace(
  trace: DirectCommandTrace,
): DirectCommandDevelopmentTraceSummary {
  return {
    turnId: trace.turnId,
    ...(trace.speechRefinerUsed === undefined
      ? {}
      : { speechRefinerUsed: trace.speechRefinerUsed }),
    ...(trace.speechRefinerResult === undefined
      ? {}
      : { speechRefinerResult: trace.speechRefinerResult }),
    ...(trace.targetSlotKind === undefined
      ? {}
      : { targetSlotKind: trace.targetSlotKind }),
    ...(trace.localTermUniverseSize === undefined
      ? {}
      : { localTermUniverseSize: trace.localTermUniverseSize }),
    ...(trace.phoneticHitCount === undefined
      ? {}
      : { phoneticHitCount: trace.phoneticHitCount }),
    ...(trace.mergedCandidateCount === undefined
      ? {}
      : { mergedCandidateCount: trace.mergedCandidateCount }),
    ...(trace.command === undefined
      ? {}
      : { command: `${trace.command.capability}.${trace.command.operation}` }),
    ...(trace.targetQueryKind === undefined
      ? {}
      : { targetQueryKind: trace.targetQueryKind }),
    ...(trace.initialResolutionStatus === undefined
      ? {}
      : { initialResolutionStatus: trace.initialResolutionStatus }),
    ...(trace.initialResolutionReason === undefined
      ? {}
      : { initialResolutionReason: trace.initialResolutionReason }),
    targetRecoveryUsed: trace.targetRecoveryUsed ?? false,
    ...(trace.targetRecoveryKind === undefined
      ? {}
      : { targetRecoveryKind: trace.targetRecoveryKind }),
    ...(trace.recoveryResult === undefined
      ? {}
      : { targetRecoveryResult: trace.recoveryResult }),
    ...(trace.finalResolutionStatus === undefined
      ? {}
      : { finalResolutionStatus: trace.finalResolutionStatus }),
    guardStatus: trace.guardStatus,
    executionStatus: trace.executionStatus,
    ...(trace.errorCode === undefined ? {} : { errorCode: trace.errorCode }),
    latencyMs: { ...trace.metrics },
  };
}

function logDevelopmentTrace(
  label: typeof DIRECT_COMMAND_TRACE_LABEL,
  summary: DirectCommandDevelopmentTraceSummary,
): void {
  console.debug(label, summary);
}
