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
export type { SpeechTranscriptEvent } from "./transcript-accumulator";
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
  ActiveVoiceTurnSnapshot,
  TranscriptAccumulatorSnapshot,
  VoiceFocusSnapshot,
  VoiceFocusSource,
  VoiceTranscriptSegment,
  VoiceTurnMetrics,
  VoiceTurnRecord,
  VoiceTurnSceneReference,
  VoiceTurnState,
  VoiceTurnTimingConfig,
} from "./voice-turn-types";
