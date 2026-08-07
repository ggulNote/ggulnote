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
  DirectPlannerResultValidationError,
  parseDirectEditorCommand,
  parseDirectPlannerResult,
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
