import type {
  GroundedTargetRecoveryKind,
  TargetRecoveryErrorCode,
} from "./grounded-target-recovery-types";
import type {
  DirectCommandRouteErrorCode,
  DirectCommandRouteResult,
  DirectPlannerResult,
} from "./direct-command-types";
import type { DirectCommandPlanningTimestamps } from "./direct-command-planning-types";
import type {
  ResolvedTarget,
  TargetEvidenceUsage,
  TargetResolutionResult,
  TargetStrategyKind,
} from "./target-grounding-types";
import type { DirectCommandTarget } from "./target-query";

export interface DirectCommandExecutionTimestamps {
  compileStartedAt?: number;
  compiledAt?: number;
  commitStartedAt?: number;
  committedAt?: number;
}

export interface DirectCommandPlanningDiagnostics {
  speechRefinerUsed?: boolean;
  speechRefinerResult?: "SKIPPED" | "UNCHANGED" | "REFINED" | "REJECTED" | "ERROR";
  speechRefinerErrorCode?: string;
  plannerStatus?: DirectPlannerResult["status"];
  planId?: string;
  capability?: string;
  operation?: string;
  relation?: string;
  targetQueryKind?: DirectCommandTarget["kind"];
  targetSlotKind?: string;
  localTermUniverseSize?: number;
  exactHitCount?: number;
  normalizedHitCount?: number;
  fuzzyHitCount?: number;
  phoneticHitCount?: number;
  asrAlternativeHitCount?: number;
  semanticHitCount?: number;
  mergedCandidateCount?: number;
  startAnchorChunkCount?: number;
  endAnchorChunkCount?: number;
  startAnchorCandidateCount?: number;
  endAnchorCandidateCount?: number;
  multiTokenAnchorUsed?: boolean;
  spanPairCandidateCount?: number;
  topSpanPairScore?: number;
  topSpanPairMargin?: number;
  spanPairResolvedDeterministically?: boolean;
  spanPairRecoveryUsed?: boolean;
  spanPairRecoveryResult?: "SELECTED" | "NONE" | "INVALID" | "ERROR";
  resolutionStatus?: TargetResolutionResult["status"];
  resolvedTargetKind?: ResolvedTarget["kind"];
  resolverConfidence?: number;
  candidateCount?: number;
  targetStrategy?: TargetStrategyKind;
  evidenceUsed?: TargetEvidenceUsage;
  embeddingUsed?: boolean;
  embeddingCandidateCount?: number;
  topSemanticScore?: number;
  topSemanticMargin?: number;
  queryEmbeddingMs?: number;
  embeddingSearchMs?: number;
  embeddingErrorCode?: string;
  disambiguationUsed: boolean;
  disambiguationResult?: "SELECTED" | "NONE";
  targetRecoveryUsed?: boolean;
  targetRecoveryKind?: GroundedTargetRecoveryKind;
  recoveryCandidateCount?: number;
  recoveryResult?: "SELECTED" | "NONE" | "INVALID" | "ERROR";
  recoveryErrorCode?: TargetRecoveryErrorCode;
  initialResolutionStatus?: TargetResolutionResult["status"];
  initialResolutionReason?: string;
  finalResolutionStatus?: TargetResolutionResult["status"];
  guardStatus: "NOT_RUN" | "PASSED" | "REJECTED";
}

export interface DirectCommandLifecycleTimestamps
extends DirectCommandPlanningTimestamps, DirectCommandExecutionTimestamps {
  voiceFinalizedAt?: number;
  routeCompletedAt: number;
}

export interface DirectCommandLatencyMetrics {
  speechRefinerMs?: number;
  plannerMs?: number;
  resolverMs?: number;
  disambiguatorMs?: number;
  recoveryMs?: number;
  validationMs?: number;
  compileMs?: number;
  commitMs?: number;
  directRouteMs?: number;
  voiceEndToCommitMs?: number;
}

export interface DirectCommandTrace {
  turnId: string;
  planId?: string;
  plannerStatus?: DirectPlannerResult["status"];
  speechRefinerUsed?: boolean;
  speechRefinerResult?: DirectCommandPlanningDiagnostics["speechRefinerResult"];
  speechRefinerErrorCode?: string;
  command?: {
    capability: string;
    operation: string;
    relation: string;
  };
  targetQueryKind?: DirectCommandTarget["kind"];
  targetSlotKind?: string;
  localTermUniverseSize?: number;
  exactHitCount?: number;
  normalizedHitCount?: number;
  fuzzyHitCount?: number;
  phoneticHitCount?: number;
  asrAlternativeHitCount?: number;
  semanticHitCount?: number;
  mergedCandidateCount?: number;
  startAnchorChunkCount?: number;
  endAnchorChunkCount?: number;
  startAnchorCandidateCount?: number;
  endAnchorCandidateCount?: number;
  multiTokenAnchorUsed?: boolean;
  spanPairCandidateCount?: number;
  topSpanPairScore?: number;
  topSpanPairMargin?: number;
  spanPairResolvedDeterministically?: boolean;
  spanPairRecoveryUsed?: boolean;
  spanPairRecoveryResult?: "SELECTED" | "NONE" | "INVALID" | "ERROR";
  resolutionStatus?: TargetResolutionResult["status"];
  resolvedTargetKind?: ResolvedTarget["kind"];
  resolverConfidence?: number;
  candidateCount?: number;
  targetStrategy?: TargetStrategyKind;
  evidenceUsed?: TargetEvidenceUsage;
  embeddingUsed?: boolean;
  embeddingCandidateCount?: number;
  topSemanticScore?: number;
  topSemanticMargin?: number;
  queryEmbeddingMs?: number;
  embeddingSearchMs?: number;
  embeddingErrorCode?: string;
  disambiguationUsed: boolean;
  disambiguationResult?: "SELECTED" | "NONE";
  targetRecoveryUsed?: boolean;
  targetRecoveryKind?: GroundedTargetRecoveryKind;
  recoveryCandidateCount?: number;
  recoveryResult?: "SELECTED" | "NONE" | "INVALID" | "ERROR";
  recoveryErrorCode?: TargetRecoveryErrorCode;
  initialResolutionStatus?: TargetResolutionResult["status"];
  initialResolutionReason?: string;
  finalResolutionStatus?: TargetResolutionResult["status"];
  guardStatus: DirectCommandPlanningDiagnostics["guardStatus"];
  executionStatus: DirectCommandRouteResult["status"];
  editorOperationId?: string;
  errorCode?: DirectCommandRouteErrorCode;
  timestamps: DirectCommandLifecycleTimestamps;
  metrics: DirectCommandLatencyMetrics;
}

export interface DirectCommandTraceDiagnostics {
  record(trace: DirectCommandTrace): void;
}
