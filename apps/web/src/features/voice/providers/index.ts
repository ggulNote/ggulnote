export type { SpeechRecognitionProvider } from "./speech-recognition-provider";
export type {
  DirectCommandPlannerOptions,
  DirectCommandPlannerProvider,
} from "./direct-command-planner-provider";
export {
  WebSpeechRecognitionProvider,
  WebSpeechRecognitionStartError,
  normalizeWebSpeechRecognitionError,
} from "./web-speech-recognition-provider";
export type { WebSpeechRecognitionProviderOptions } from "./web-speech-recognition-provider";
export {
  MAX_SPEECH_BIAS_BOOST,
  MAX_SPEECH_BIAS_PHRASE_LENGTH,
  MAX_SPEECH_BIAS_PHRASES,
  MIN_SPEECH_BIAS_BOOST,
  detectWebSpeechFeatures,
  getBrowserWebSpeechGlobalScope,
  normalizeSpeechBiasPhrases,
  resolveWebSpeechConstructor,
} from "./web-speech-compat";
export type {
  NormalizedSpeechBiasPhrase,
  ResolvedWebSpeechConstructor,
  WebSpeechFeatureDetection,
  WebSpeechGlobalScope,
  WebSpeechRecognitionAlternativeLike,
  WebSpeechRecognitionConstructor,
  WebSpeechRecognitionErrorEventLike,
  WebSpeechRecognitionLike,
  WebSpeechRecognitionPhraseConstructor,
  WebSpeechRecognitionResultEventLike,
  WebSpeechRecognitionResultLike,
  WebSpeechRecognitionResultListLike,
} from "./web-speech-compat";
