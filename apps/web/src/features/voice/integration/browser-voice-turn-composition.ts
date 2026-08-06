import { InteractionClock } from "@ggulnote/interaction-core";
import {
  SceneVoiceTurnContextSource,
  VoiceTurnController,
  type VoiceTurnContextRead,
} from "../application";
import { WebSpeechRecognitionProvider } from "../providers";

export interface BrowserVoiceTurnCompositionOptions {
  readCurrentContext: () => VoiceTurnContextRead;
  timeProvider?: () => number;
  createTurnId?: () => string;
}

export interface BrowserVoiceTurnComposition {
  controller: VoiceTurnController;
  dispose(): void;
}

export function createBrowserVoiceTurnComposition(
  options: BrowserVoiceTurnCompositionOptions,
): BrowserVoiceTurnComposition {
  const clock = new InteractionClock(
    options.timeProvider ?? readBrowserMonotonicTime,
  );
  const provider = new WebSpeechRecognitionProvider({ clock });
  const contextSource = new SceneVoiceTurnContextSource({
    readCurrentContext: options.readCurrentContext,
  });
  const controller = new VoiceTurnController({
    provider,
    contextSource,
    clock,
    createTurnId: options.createTurnId ?? createVoiceTurnId,
  });

  return {
    controller,
    dispose: () => controller.dispose(),
  };
}

function readBrowserMonotonicTime(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function createVoiceTurnId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `voice-turn-${uuid}`
    : `voice-turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
