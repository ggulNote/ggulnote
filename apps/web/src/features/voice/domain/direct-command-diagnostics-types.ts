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
import type {
  SpatialPlacementReason,
} from "./spatial-placement-types";
import type { PlacementCandidateAlias } from "./multimodal-placement-types";
import type {
  SpatialPreviewResolutionFailureStatus,
  SpatialPreviewValidationFailureReason,
} from "./spatial-preview-types";
import type { SpatialPlacementQuery } from "./spatial-placement-query";
import type {
  TextPlacementAutoFlowSource,
  TextPlacementChoicePolicy,
  TextPlacementMode,
  TextPlacementProvenance,
  TextPlacementRecoveryReason,
} from "./text-placement-intent";

export interface SpatialCommandExecutionDiagnostics {
  readonly placementRequested: true;
  readonly pageId: string;
  readonly sceneRevision: number;
  readonly anchorResolution: "RESOLVED" | "ANCHOR_NOT_FOUND" | "STALE_SCENE";
  readonly rawCandidateCount: number;
  readonly filteredCandidateCount: number;
  readonly shortlistCandidateCount: number;
  readonly deterministicGate: "RESOLVED" | "AMBIGUOUS" | "NO_FEASIBLE_PLACEMENT" | "STALE_SCENE";
  readonly multimodalUsed: boolean;
  readonly multimodalCallCount: 0 | 1;
  readonly multimodalProviderResult:
    | "NOT_REQUIRED"
    | PlacementCandidateAlias
    | "NONE"
    | "ERROR"
    | "UNAVAILABLE"
    | "INVALID"
    | "CANCELLED"
    | "STALE";
  readonly screenshotCallCount: 0 | 1;
  readonly selectionSource?: "DETERMINISTIC" | "MULTIMODAL" | "VALIDATION_FALLBACK";
  readonly previewAttemptCount: 0 | 1 | 2;
  readonly validationResult: "NOT_RUN" | "VALIDATED" | SpatialPreviewResolutionFailureStatus;
  readonly previewFailureReason?: SpatialPreviewValidationFailureReason;
  readonly commitGuard: "NOT_RUN" | "PASSED" | "REJECTED";
  readonly runtimeExecuted: boolean;
  readonly operationRecorded: boolean;
  readonly placementChoicePolicy?: TextPlacementChoicePolicy;
  readonly stableFallbackUsed: boolean;
  readonly failureReason?: SpatialPlacementReason | DirectCommandRouteErrorCode;
  readonly anchorResolutionMs: number;
  readonly candidateGenerationMs: number;
  readonly multimodalMs: number;
  readonly previewValidationMs: number;
  readonly commitMs: number;
  readonly totalSpatialMs: number;
}

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
  plannerDraftPlacementQuery?: SpatialPlacementQuery;
  plannerPlacementPresent?: boolean;
  spatialPhraseEvidenceKind?: "NONE" | "EXPLICIT_REGION" | "CONTEXTUAL_RELATIVE" | "AUTO_FREE_SPACE";
  spatialPhraseEvidenceTokens?: readonly string[];
  normalizedPlacementMode?: TextPlacementMode;
  placementProvenance?: TextPlacementProvenance;
  placementConflictRecovered?: boolean;
  plannerOutputRecovered?: boolean;
  placementRecoveryReason?: TextPlacementRecoveryReason;
  autoFlowSource?: TextPlacementAutoFlowSource;
  placementChoicePolicy?: TextPlacementChoicePolicy;
  effectivePlacementQuery?: SpatialPlacementQuery;
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
  confidenceDecision?: "deterministic" | "recovery" | "not_found";
  recoveryPairCount?: number;
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
  plannerDraftPlacementQuery?: SpatialPlacementQuery;
  plannerPlacementPresent?: boolean;
  spatialPhraseEvidenceKind?: DirectCommandPlanningDiagnostics["spatialPhraseEvidenceKind"];
  spatialPhraseEvidenceTokens?: readonly string[];
  normalizedPlacementMode?: TextPlacementMode;
  placementProvenance?: TextPlacementProvenance;
  placementConflictRecovered?: boolean;
  plannerOutputRecovered?: boolean;
  placementRecoveryReason?: TextPlacementRecoveryReason;
  autoFlowSource?: TextPlacementAutoFlowSource;
  placementChoicePolicy?: TextPlacementChoicePolicy;
  effectivePlacementQuery?: SpatialPlacementQuery;
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
  confidenceDecision?: "deterministic" | "recovery" | "not_found";
  recoveryPairCount?: number;
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
  spatial?: SpatialCommandExecutionDiagnostics;
  timestamps: DirectCommandLifecycleTimestamps;
  metrics: DirectCommandLatencyMetrics;
}

export interface DirectCommandTraceDiagnostics {
  record(trace: DirectCommandTrace): void;
}
