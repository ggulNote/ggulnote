import type { EditorEngine } from "@ggulnote/editor-core";
import type { TldrawEditorAdapter } from "../../editor/adapters/tldraw";
import { InteractionClock } from "@ggulnote/interaction-core";
import type { FrozenTargetResolver, VoiceTurnContextRead } from "../application";
import type { FrozenPageGroundingSnapshot } from "../domain";
import type {
  DirectCommandPlannerProvider,
  DirectTargetDisambiguatorProvider,
  GroundedTargetRecoveryProvider,
  SpeechRefinerProvider,
} from "../providers";
import {
  createBrowserVoiceTurnComposition,
  type BrowserVoiceTurnComposition,
} from "./browser-voice-turn-composition";
import {
  createEditorDirectCommandComposition,
  type EditorDirectCommandComposition,
  type EditorDirectCommandCompositionOptions,
  type EditorSpatialPlacementCompositionOptions,
} from "./editor-direct-command-composition";
import {
  DirectCommandVoiceTurnBridge,
  type CompletedVoiceTurnRoute,
} from "./direct-command-voice-turn-bridge";

export interface BrowserDirectCommandCompositionOptions {
  editorEngine: EditorEngine;
  readCurrentVoiceContext(): VoiceTurnContextRead;
  readCurrentGroundingSnapshot(): FrozenPageGroundingSnapshot | undefined;
  getCurrentSceneRevision(): number;
  getCurrentPage(): number;
  goToPage(page: number): void;
  getTldrawAdapter?(): TldrawEditorAdapter | undefined;
  timeProvider?: () => number;
  createTurnId?: () => string;
  planner?: DirectCommandPlannerProvider;
  disambiguator?: DirectTargetDisambiguatorProvider;
  recovery?: GroundedTargetRecoveryProvider;
  speechRefiner?: SpeechRefinerProvider;
  targetResolver?: FrozenTargetResolver;
  spatial?: EditorSpatialPlacementCompositionOptions;
  noteAgentShadow?: EditorDirectCommandCompositionOptions["noteAgentShadow"];
  noteAgent?: EditorDirectCommandCompositionOptions["noteAgent"];
}

export interface BrowserDirectCommandComposition {
  voice: BrowserVoiceTurnComposition;
  direct: EditorDirectCommandComposition;
  dispose(): void;
}

export function createBrowserDirectCommandComposition(
  options: BrowserDirectCommandCompositionOptions,
): BrowserDirectCommandComposition {
  const clock = new InteractionClock(
    options.timeProvider ?? readBrowserMonotonicTime,
  );
  const voice = createBrowserVoiceTurnComposition({
    readCurrentContext: options.readCurrentVoiceContext,
    clock,
    ...(options.createTurnId === undefined
      ? {}
      : { createTurnId: options.createTurnId }),
  });
  const direct = createEditorDirectCommandComposition({
    editorEngine: options.editorEngine,
    clock,
    readCurrentGroundingSnapshot: options.readCurrentGroundingSnapshot,
    getCurrentSceneRevision: options.getCurrentSceneRevision,
    getCurrentPage: options.getCurrentPage,
    goToPage: options.goToPage,
    ...(options.getTldrawAdapter === undefined
      ? {}
      : { getTldrawAdapter: options.getTldrawAdapter }),
    ...(options.planner === undefined ? {} : { planner: options.planner }),
    ...(options.disambiguator === undefined
      ? {}
      : { disambiguator: options.disambiguator }),
    ...(options.recovery === undefined ? {} : { recovery: options.recovery }),
    ...(options.speechRefiner === undefined
      ? {}
      : { speechRefiner: options.speechRefiner }),
    ...(options.targetResolver === undefined
      ? {}
      : { targetResolver: options.targetResolver }),
    ...(options.spatial === undefined ? {} : { spatial: options.spatial }),
    ...(options.noteAgentShadow === undefined
      ? {}
      : { noteAgentShadow: options.noteAgentShadow }),
    ...(options.noteAgent === undefined ? {} : { noteAgent: options.noteAgent }),
  });
  const route: CompletedVoiceTurnRoute = direct.noteAgentProduction
    ?? (direct.noteAgentShadow === undefined
      ? direct.route
      : {
        execute: (turn, executeOptions) =>
          direct.noteAgentShadow?.executeAlongside(
            turn,
            direct.route,
            executeOptions,
          ) ?? direct.route.execute(turn, executeOptions),
      });
  const bridge = new DirectCommandVoiceTurnBridge({
    controller: voice.controller,
    route,
  });

  let disposed = false;
  return {
    voice,
    direct,
    dispose() {
      if (disposed) return;
      disposed = true;
      bridge.dispose();
      direct.dispose();
      voice.dispose();
    },
  };
}

function readBrowserMonotonicTime(): number {
  return globalThis.performance?.now() ?? Date.now();
}
