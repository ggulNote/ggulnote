export type {
  SpeechProviderError,
  SpeechProviderErrorCode,
  SpeechProviderErrorDetail,
  VoiceRecognitionError,
  VoiceRecognitionErrorCode,
  VoiceRecognitionErrorDetail,
  VoiceTurnError,
  VoiceTurnErrorCode,
} from "./voice-errors";
export {
  DEFAULT_COMMAND_RECOGNITION_CONFIG,
  cloneSpeechRecognitionConfig,
} from "./speech-types";
export type {
  ContextualSpeechTerm,
  DocumentLexiconEntry,
  DocumentLexiconSourceReference,
  MathNormalizationResult,
  MathSpeechToken,
  NumberHypothesis,
  SpeechAlternative,
  SpeechGroundingEvidence,
  SpeechNormalizationDiagnostics,
  SpeechNormalizationMode,
  TermHypothesis,
  TermHypothesisCandidate,
  TermHypothesisSource,
  GroundingRetrievalEvidence,
  TargetGroundingSlot,
  TargetGroundingSlotKind,
  TargetTermCandidate,
} from "./speech-grounding-types";
export { SPEECH_REFINEMENT_CORRECTION_KINDS } from "./speech-refinement-types";
export type {
  SpeechRefinementCorrectionKind,
  SpeechRefinementEvidence,
  SpeechRefinementInput,
  SpeechRefinementProviderResult,
} from "./speech-refinement-types";
export {
  parseSpeechRefinementInput,
  parseSpeechRefinementProviderResult,
  parseSpeechRefinementResult,
  SpeechRefinementValidationError,
} from "./speech-refinement-schema";
export { TARGET_RECOVERY_LIMITS } from "./grounded-target-recovery-types";
export type {
  GroundedTargetRecoveryCandidate,
  GroundedTargetRecoveryInput,
  GroundedTargetRecoveryKind,
  GroundedTargetRecoveryResult,
  GroundedTextSpanPairCandidate,
  ObjectRecoveryInput,
  SemanticUnitRecoveryInput,
  TargetRecoveryErrorCode,
  TargetRecoveryNumberEvidence,
  TargetRecoverySpeechEvidence,
  TargetRecoveryTermEvidence,
  TextSpanRecoveryInput,
} from "./grounded-target-recovery-types";
export {
  GroundedTargetRecoveryValidationError,
  parseGroundedTargetRecoveryInput,
  parseGroundedTargetRecoveryResult,
} from "./grounded-target-recovery-schema";
export {
  TranscriptAccumulator,
  joinVoiceTranscriptText,
  normalizeVoiceTranscriptSegmentText,
} from "./transcript-accumulator";
export type { SpeechTranscriptEvent, TranscriptAccumulatorSegmentSnapshot } from "./transcript-accumulator";
export type {
  LocalRecognitionStatus,
  SpeechBiasPhrase,
  SpeechProviderAvailability,
  SpeechProviderClock,
  SpeechProviderEvent,
  SpeechProviderEventListener,
  SpeechProviderSessionIdFactory,
  SpeechRecognitionConfig,
  SpeechRecognitionMode,
  SpeechRecognitionQuality,
} from "./speech-types";
export type { VoiceModeSnapshot, VoiceModeState } from "./voice-mode-types";
export type {
  AnnotationHighlightDirectCommand,
  AnnotationUnderlineDirectCommand,
  CancelledDirectPlan,
  CommandRelation,
  DeferredSpatialPlan,
  DirectCapabilityId,
  DirectCommandName,
  DirectCommandOperation,
  DirectCommandOperationId,
  DirectCommandPlanId,
  DirectCommandPlannerFocus,
  DirectCommandPlannerFrozenContext,
  DirectCommandPlannerInput,
  DirectCommandPlannerLastOperation,
  DirectCommandPlannerRecentOperation,
  DirectCommandPlannerTurnInput,
  DirectCommandExecutionResult,
  DirectCommandRouteErrorCode,
  DirectCommandRouteResult,
  DirectCommandSceneRevision,
  DirectCommandTurnId,
  DirectCurrentPageTargetRef,
  DirectEditorCommand,
  DirectFocusTargetRef,
  DirectLastOperationTargetRef,
  DirectPlannerResult,
  DirectTargetRef,
  EmptyDirectCommandPayload,
  ExecutableCommandRelation,
  ExecutableDirectPlan,
  HistoryUndoDirectCommand,
  NavigationDirectCommand,
  NeedsClarificationPlan,
  TextReplaceContentDirectCommand,
  UnsupportedDirectPlan,
} from "./direct-command-types";
export { DIRECT_COMMAND_NAMES } from "./direct-command-types";
export type {
  DirectCommandHistorySnapshot,
  DirectOperationRecord,
  DirectOperationTargetRecord,
  DirectReusableTargetRecord,
} from "./direct-command-history-types";
export type {
  DirectAnnotationRuntimeInput,
  DirectCommandCompileResult,
  DirectCommandRuntimeInstruction,
  ReadyForDirectCommandExecution,
} from "./direct-command-execution-types";
export {
  DirectAiProviderError,
  isAbortError,
  normalizeDirectAiProviderError,
} from "./direct-ai-provider-error";
export type {
  DirectAiProviderErrorCode,
  DirectAiProviderErrorReason,
} from "./direct-ai-provider-error";
export { DirectAiInputValidationError } from "./direct-ai-input-schema";
export {
  parseDirectCommandPlannerInput,
  parseDirectTargetDisambiguationInput,
} from "./direct-ai-input-schema";
export type {
  DirectCommandPlanningResult,
  DirectCommandPlanningTimestamps,
} from "./direct-command-planning-types";
export {
  DIRECT_TARGET_CANDIDATE_LABELS,
} from "./direct-target-disambiguation-types";
export type {
  DirectTargetCandidateLabel,
  DirectTargetDisambiguationCandidate,
  DirectTargetDisambiguationInput,
  DirectTargetDisambiguationResult,
} from "./direct-target-disambiguation-types";
export {
  DirectTargetDisambiguationValidationError,
  parseDirectTargetDisambiguationResult,
} from "./direct-target-disambiguation-schema";
export {
  DIRECT_SEMANTIC_UNITS,
  DIRECT_TARGET_OBJECT_TYPES,
} from "./target-query";
export type {
  DirectCommandTarget,
  DirectControlTarget,
  DirectSemanticUnit,
  DirectTargetObjectType,
  ObjectTargetQuery,
  RelativeTargetQuery,
  SemanticUnitTargetQuery,
  SubrangeTargetQuery,
  TargetQuery,
  TextSpanTargetQuery,
} from "./target-query";
export {
  SPATIAL_ALIGNMENTS,
  SPATIAL_PLACEMENT_RELATIONS,
  SPATIAL_REGION_HINTS,
} from "./spatial-placement-query";
export type {
  SpatialAlignment,
  SpatialDistance,
  SpatialOverlayIntent,
  SpatialPlacementQuery,
  SpatialPlacementRelation,
  SpatialReferenceQuery,
  SpatialRegionHint,
} from "./spatial-placement-query";
export type {
  FrozenSpatialFocus,
  FrozenSpatialSelection,
  MeasuredDraft,
  PlacementCandidate,
  PlacementOverflowPolicy,
  PlacementOverlayPolicy,
  PlacementProfile,
  PlacementResizePolicy,
  ProtectionPolicy,
  ResolvedPlacement,
  ResolvedSpatialAnchor,
  SpatialPlacementError,
  SpatialPlacementReason,
  SpatialPlacementResult,
  SpatialProtection,
  SpatialSceneMode,
  SpatialSceneObject,
  SpatialSceneSnapshot,
  SpatialSemanticRole,
  SpatialSourceLayer,
} from "./spatial-placement-types";
export type {
  SelectedSpatialPlacement,
  SpatialPlacementSelectionSource,
  SpatialPreviewResolutionFailureStatus,
  SpatialPreviewValidationEvidence,
  SpatialPreviewValidationFailureReason,
  SpatialPreviewValidationResult,
  ValidatedSpatialPlacement,
} from "./spatial-preview-types";
export {
  MULTIMODAL_PLACEMENT_LIMITS,
  parseMultimodalPlacementChoice,
  parseMultimodalPlacementRequest,
} from "./multimodal-placement-schema";
export {
  MultimodalPlacementValidationError,
} from "./multimodal-placement-types";
export type {
  MultimodalClearanceCategory,
  MultimodalPlacementAnchorSummary,
  MultimodalPlacementCandidateSummary,
  MultimodalPlacementChoice,
  MultimodalPlacementDraftSummary,
  MultimodalPlacementRequest,
  MultimodalSoftOverlapCategory,
  PlacementCandidateAlias,
} from "./multimodal-placement-types";
export { DEFAULT_TARGET_RESOLUTION_POLICY } from "./target-grounding-types";
export type {
  CandidateEvidence,
  DirectCommandContext,
  DirectCommandContextBuildResult,
  DirectRecentOperation,
  FrozenPageGroundingSnapshot,
  FrozenSceneSnapshotReference,
  PageTargetCandidate,
  PageTargetCandidateType,
  PageTargetCatalog,
  PageTargetSource,
  RankedTargetCandidate,
  ResolvedObject,
  ResolvedTarget,
  ResolvedTextSpan,
  TargetEvidenceUsage,
  TargetResolutionDiagnostics,
  TargetResolutionInput,
  TargetResolutionPolicy,
  TargetResolutionReasonCode,
  TargetResolutionResult,
  TargetStrategyKind,
} from "./target-grounding-types";
export {
  DirectPlannerResultValidationError,
  parseDirectEditorCommand,
  parseDirectPlannerResult,
  parseSpatialPlacementQuery,
  parseTargetQuery,
  safeParseDirectPlannerResult,
} from "./direct-planner-schema";
export type { SafeDirectPlannerResultParse } from "./direct-planner-schema";
export { isTerminalVoiceTurnStatus, reduceVoiceTurnLifecycle } from "./voice-turn-reducer";
export type { VoiceTurnLifecycleAction } from "./voice-turn-reducer";
export type {
  ActiveVoiceTurnSnapshot,
  FrozenVoiceTurnContext,
  TranscriptAccumulatorSnapshot,
  VoiceFocusSnapshot,
  VoiceFocusSource,
  VoiceTranscriptSegment,
  VoiceTurnMetrics,
  VoiceTurnCancelReason,
  VoiceTurnControllerError,
  VoiceTurnControllerErrorCode,
  VoiceTurnControllerState,
  VoiceTurnControllerStatus,
  VoiceTurnDiscardReason,
  VoiceTurnRecord,
  VoiceTurnSceneReference,
  VoiceTurnState,
  VoiceTurnTimingConfig,
  CompletedVoiceTurn,
} from "./voice-turn-types";
export type {
  DirectCommandExecutionTimestamps,
  DirectCommandLatencyMetrics,
  DirectCommandLifecycleTimestamps,
  DirectCommandPlanningDiagnostics,
  DirectCommandTrace,
  DirectCommandTraceDiagnostics,
  SpatialCommandExecutionDiagnostics,
} from "./direct-command-diagnostics-types";
