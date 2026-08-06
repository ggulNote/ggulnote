import type { InteractionClock } from "@ggulnote/interaction-core";
import type { SpeechProviderError } from "./voice-errors";

export type SpeechRecognitionMode =
  | "browser-default"
  | "local-preferred"
  | "local-required";

export type SpeechRecognitionQuality = "command" | "dictation" | "conversation";

export interface SpeechBiasPhrase {
  text: string;
  boost?: number;
}

export interface SpeechRecognitionConfig {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  mode: SpeechRecognitionMode;
  quality: SpeechRecognitionQuality;
  phrases: SpeechBiasPhrase[];
}

export const DEFAULT_COMMAND_RECOGNITION_CONFIG = {
  lang: "ko-KR",
  continuous: true,
  interimResults: true,
  maxAlternatives: 1,
  mode: "browser-default",
  quality: "command",
  phrases: [],
} satisfies SpeechRecognitionConfig;

export type LocalRecognitionStatus =
  | "unknown"
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

export interface SpeechProviderAvailability {
  supported: boolean;
  constructorName?: "SpeechRecognition" | "webkitSpeechRecognition";
  local: {
    supported: boolean;
    status: LocalRecognitionStatus;
  };
  contextualBiasingSupported: boolean;
}

export type SpeechProviderEvent =
  | {
      type: "provider-start";
      at: number;
      sessionId: string;
    }
  | {
      type: "audio-start";
      at: number;
      sessionId: string;
    }
  | {
      type: "speech-start";
      at: number;
      sessionId: string;
    }
  | {
      type: "transcript";
      at: number;
      sessionId: string;
      segmentId: string;
      segmentIndex: number;
      text: string;
      isFinal: boolean;
      confidence?: number;
    }
  | {
      type: "speech-end";
      at: number;
      sessionId: string;
    }
  | {
      type: "audio-end";
      at: number;
      sessionId: string;
    }
  | {
      type: "provider-end";
      at: number;
      sessionId: string;
      intentional: boolean;
    }
  | {
      type: "error";
      at: number;
      sessionId: string;
      error: SpeechProviderError;
    };

export type SpeechProviderEventListener = (event: SpeechProviderEvent) => void;

export type SpeechProviderClock = Pick<InteractionClock, "now">;

export type SpeechProviderSessionIdFactory = () => string;

export function cloneSpeechRecognitionConfig(
  config: SpeechRecognitionConfig,
): SpeechRecognitionConfig {
  return {
    ...config,
    phrases: config.phrases.map((phrase) => ({ ...phrase })),
  };
}
