import type { SpeechProviderEvent, VoiceTurnControllerState } from "../domain";

export type VoiceTurnControlDiagnosticEvent =
  | { type: "turn-requested"; at: number }
  | { type: "stop-requested"; at: number }
  | { type: "cancel-requested"; at: number };

export interface VoiceTurnDiagnostics {
  onControlEvent?(event: VoiceTurnControlDiagnosticEvent): void;
  onProviderEvent?(event: SpeechProviderEvent): void;
  onStateChange?(
    previous: VoiceTurnControllerState,
    next: VoiceTurnControllerState,
  ): void;
}
