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
  TargetResolutionInput,
  TargetResolutionPolicy,
  TargetResolutionReasonCode,
  TargetResolutionResult,
} from "./target-grounding-types";
export {
  DirectPlannerResultValidationError,
  parseDirectEditorCommand,
  parseDirectPlannerResult,
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
