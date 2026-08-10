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
  plannerStatus?: DirectPlannerResult["status"];
  planId?: string;
  capability?: string;
  operation?: string;
  relation?: string;
  targetQueryKind?: DirectCommandTarget["kind"];
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
  guardStatus: "NOT_RUN" | "PASSED" | "REJECTED";
}

export interface DirectCommandLifecycleTimestamps
extends DirectCommandPlanningTimestamps, DirectCommandExecutionTimestamps {
  voiceFinalizedAt?: number;
  routeCompletedAt: number;
}

export interface DirectCommandLatencyMetrics {
  plannerMs?: number;
  resolverMs?: number;
  disambiguatorMs?: number;
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
  command?: {
    capability: string;
    operation: string;
    relation: string;
  };
  targetQueryKind?: DirectCommandTarget["kind"];
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
