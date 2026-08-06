import type { SpeechProviderError } from "./voice-errors";

export type VoiceModeState =
  | "off"
  | "starting"
  | "ready"
  | "speech-active"
  | "recovering"
  | "permission-denied"
  | "unsupported"
  | "error";

export interface VoiceModeSnapshot {
  state: VoiceModeState;
  enabled: boolean;
  providerSessionId?: string;
  restartCount: number;
  lastError?: SpeechProviderError;
}
