export type SpeechProviderErrorCode =
  | "unsupported"
  | "no-speech"
  | "aborted"
  | "audio-capture"
  | "network"
  | "not-allowed"
  | "service-not-allowed"
  | "language-not-supported"
  | "phrases-not-supported"
  | "invalid-state"
  | "unknown";

export interface SpeechProviderError {
  code: SpeechProviderErrorCode;
  message?: string;
  recoverable: boolean;
  retryPolicy: "none" | "restart-once" | "restart-while-mode-active";
}

export interface SpeechProviderErrorDetail extends SpeechProviderError {
  rawCode?: string;
  rawMessage?: string;
}

export type VoiceErrorCode = SpeechProviderErrorCode;
export type VoiceRecognitionErrorCode = SpeechProviderErrorCode;
export type VoiceRecognitionError = SpeechProviderError;
export type VoiceRecognitionErrorDetail = SpeechProviderErrorDetail;

export type VoiceTurnErrorCode = Exclude<
  SpeechProviderErrorCode,
  "unsupported" | "phrases-not-supported"
>;

export interface VoiceTurnError {
  code: VoiceTurnErrorCode;
  message?: string;
  recoverable: boolean;
}
