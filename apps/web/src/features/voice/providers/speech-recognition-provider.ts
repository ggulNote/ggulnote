import type {
  SpeechProviderAvailability,
  SpeechProviderEventListener,
  SpeechRecognitionConfig,
} from "../domain";

export interface SpeechRecognitionProvider {
  readonly id: string;
  readonly activeSessionId?: string;

  getAvailability(config: SpeechRecognitionConfig): Promise<SpeechProviderAvailability>;
  start(config: SpeechRecognitionConfig): Promise<void>;
  stop(): void;
  abort(): void;
  subscribe(listener: SpeechProviderEventListener): () => void;
  dispose(): void;
}
