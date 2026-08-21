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
  startAnchorChunkCount?: number;
  endAnchorChunkCount?: number;
  startAnchorCandidateCount?: number;
  endAnchorCandidateCount?: number;
  multiTokenAnchorUsed?: boolean;
  anchorVariantCount?: number;
  canonicalAnchorCount?: number;
  dominatedAnchorVariantCount?: number;
  spanPairCandidateCountBeforePruning?: number;
  dominatedPairCount?: number;
  spanPairCandidateCountAfterPruning?: number;
  spanPairCandidateCount?: number;
  topSpanPairScore?: number;
  runnerUpSpanPairScore?: number;
  topSpanPairMargin?: number;
  spanPairResolvedDeterministically?: boolean;
  rawAnchorCandidateCount?: number;
  canonicalAnchorCandidateCount?: number;
  rawPairCandidateCount?: number;
  nonDominatedPairCount?: number;
  confidenceDecision?: DirectCommandTrace["confidenceDecision"];
  recoveryPairCount?: number;
  spanPairRecoveryUsed?: boolean;
  spanPairRecoveryResult?: DirectCommandTrace["spanPairRecoveryResult"];
  initialResolutionStatus?: DirectCommandTrace["initialResolutionStatus"];
  initialResolutionReason?: DirectCommandTrace["initialResolutionReason"];
  targetRecoveryUsed: boolean;
  targetRecoveryKind?: DirectCommandTrace["targetRecoveryKind"];
  targetRecoveryResult?: DirectCommandTrace["recoveryResult"];
  finalResolutionStatus?: DirectCommandTrace["finalResolutionStatus"];
  guardStatus: DirectCommandTrace["guardStatus"];
  executionStatus: DirectCommandTrace["executionStatus"];
  errorCode?: DirectCommandTrace["errorCode"];
  spatial?: DirectCommandTrace["spatial"];
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
    ...(trace.startAnchorChunkCount === undefined
      ? {} : { startAnchorChunkCount: trace.startAnchorChunkCount }),
    ...(trace.endAnchorChunkCount === undefined
      ? {} : { endAnchorChunkCount: trace.endAnchorChunkCount }),
    ...(trace.startAnchorCandidateCount === undefined
      ? {} : { startAnchorCandidateCount: trace.startAnchorCandidateCount }),
    ...(trace.endAnchorCandidateCount === undefined
      ? {} : { endAnchorCandidateCount: trace.endAnchorCandidateCount }),
    ...(trace.multiTokenAnchorUsed === undefined
      ? {} : { multiTokenAnchorUsed: trace.multiTokenAnchorUsed }),
    ...(trace.anchorVariantCount === undefined
      ? {} : { anchorVariantCount: trace.anchorVariantCount }),
    ...(trace.canonicalAnchorCount === undefined
      ? {} : { canonicalAnchorCount: trace.canonicalAnchorCount }),
    ...(trace.dominatedAnchorVariantCount === undefined
      ? {} : { dominatedAnchorVariantCount: trace.dominatedAnchorVariantCount }),
    ...(trace.spanPairCandidateCountBeforePruning === undefined
      ? {} : {
          spanPairCandidateCountBeforePruning: trace.spanPairCandidateCountBeforePruning,
        }),
    ...(trace.dominatedPairCount === undefined
      ? {} : { dominatedPairCount: trace.dominatedPairCount }),
    ...(trace.spanPairCandidateCountAfterPruning === undefined
      ? {} : {
          spanPairCandidateCountAfterPruning: trace.spanPairCandidateCountAfterPruning,
        }),
    ...(trace.spanPairCandidateCount === undefined
      ? {} : { spanPairCandidateCount: trace.spanPairCandidateCount }),
    ...(trace.topSpanPairScore === undefined
      ? {} : { topSpanPairScore: trace.topSpanPairScore }),
    ...(trace.runnerUpSpanPairScore === undefined
      ? {} : { runnerUpSpanPairScore: trace.runnerUpSpanPairScore }),
    ...(trace.topSpanPairMargin === undefined
      ? {} : { topSpanPairMargin: trace.topSpanPairMargin }),
    ...(trace.spanPairResolvedDeterministically === undefined
      ? {} : { spanPairResolvedDeterministically: trace.spanPairResolvedDeterministically }),
    ...(trace.spanPairRecoveryUsed === undefined
      ? {} : { spanPairRecoveryUsed: trace.spanPairRecoveryUsed }),
    ...(trace.spanPairRecoveryResult === undefined
      ? {} : { spanPairRecoveryResult: trace.spanPairRecoveryResult }),
    ...(trace.rawAnchorCandidateCount === undefined
      ? {} : { rawAnchorCandidateCount: trace.rawAnchorCandidateCount }),
    ...(trace.canonicalAnchorCandidateCount === undefined
      ? {} : { canonicalAnchorCandidateCount: trace.canonicalAnchorCandidateCount }),
    ...(trace.rawPairCandidateCount === undefined
      ? {} : { rawPairCandidateCount: trace.rawPairCandidateCount }),
    ...(trace.nonDominatedPairCount === undefined
      ? {} : { nonDominatedPairCount: trace.nonDominatedPairCount }),
    ...(trace.confidenceDecision === undefined
      ? {} : { confidenceDecision: trace.confidenceDecision }),
    ...(trace.recoveryPairCount === undefined
      ? {} : { recoveryPairCount: trace.recoveryPairCount }),
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
    ...(trace.spatial === undefined ? {} : { spatial: { ...trace.spatial } }),
    latencyMs: { ...trace.metrics },
  };
}

function logDevelopmentTrace(
  label: typeof DIRECT_COMMAND_TRACE_LABEL,
  summary: DirectCommandDevelopmentTraceSummary,
): void {
  console.debug(`${label} ${JSON.stringify(summary)}`);
}
