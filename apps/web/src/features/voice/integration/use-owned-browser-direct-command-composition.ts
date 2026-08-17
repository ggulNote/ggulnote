"use client";

import type { EditorEngine } from "@ggulnote/editor-core";
import type { TldrawEditorAdapter } from "../../editor/adapters/tldraw";
import { useEffect, useRef, useState } from "react";
import type { VoiceTurnContextRead } from "../application";
import type { FrozenPageGroundingSnapshot } from "../domain";
import {
  HttpGroundedTargetRecoveryProvider,
  HttpSpeechRefinerProvider,
} from "../providers";
import {
  createBrowserDirectCommandComposition,
  type BrowserDirectCommandComposition,
} from "./browser-direct-command-composition";
import type { EditorSpatialPlacementCompositionOptions } from "./editor-direct-command-composition";
import { subscribeToDevelopmentDirectCommandTraces } from "./direct-command-development-trace";
import { HttpNoteDecisionProvider } from "../note-agent";

export interface OwnedBrowserDirectCommandCompositionOptions {
  editorEngine: EditorEngine;
  readCurrentVoiceContext(): VoiceTurnContextRead;
  readCurrentGroundingSnapshot(): FrozenPageGroundingSnapshot | undefined;
  getCurrentSceneRevision(): number;
  getCurrentPage(): number;
  goToPage(page: number): void;
  getTldrawAdapter?(): TldrawEditorAdapter | undefined;
  spatial?: EditorSpatialPlacementCompositionOptions;
}

class DirectCommandCompositionReaders {
  public constructor(
    private options: OwnedBrowserDirectCommandCompositionOptions,
  ) {}

  public readCurrentVoiceContext = (): VoiceTurnContextRead =>
    this.options.readCurrentVoiceContext();

  public readCurrentGroundingSnapshot = ():
  FrozenPageGroundingSnapshot | undefined =>
    this.options.readCurrentGroundingSnapshot();

  public getCurrentSceneRevision = (): number =>
    this.options.getCurrentSceneRevision();

  public getCurrentPage = (): number => this.options.getCurrentPage();

  public goToPage = (page: number): void => this.options.goToPage(page);

  public getTldrawAdapter = (): TldrawEditorAdapter | undefined =>
    this.options.getTldrawAdapter?.();

  public getSpatialBaseCanvas = (): HTMLCanvasElement | null =>
    this.options.spatial?.getBaseCanvas() ?? null;

  public getSpatialOverlayCanvas = (): HTMLCanvasElement | null =>
    this.options.spatial?.getOverlayCanvas() ?? null;

  public mountSpatialPreviewCanvas = (canvas: HTMLCanvasElement): void | (() => void) =>
    this.options.spatial?.mountPreviewCanvas(canvas);

  public update(options: OwnedBrowserDirectCommandCompositionOptions): void {
    this.options = options;
  }
}

export function useOwnedBrowserDirectCommandComposition(
  options: OwnedBrowserDirectCommandCompositionOptions,
): BrowserDirectCommandComposition {
  const ownerGenerationRef = useRef(0);
  const [readers] = useState(() =>
    new DirectCommandCompositionReaders(options),
  );
  const [composition] = useState(() =>
    createBrowserDirectCommandComposition({
      editorEngine: options.editorEngine,
      readCurrentVoiceContext: readers.readCurrentVoiceContext,
      readCurrentGroundingSnapshot: readers.readCurrentGroundingSnapshot,
      getCurrentSceneRevision: readers.getCurrentSceneRevision,
      getCurrentPage: readers.getCurrentPage,
      goToPage: readers.goToPage,
      getTldrawAdapter: readers.getTldrawAdapter,
      recovery: new HttpGroundedTargetRecoveryProvider(),
      speechRefiner: new HttpSpeechRefinerProvider(),
      ...noteAgentRoutingOptions(),
      ...(options.spatial === undefined
        ? {}
        : {
            spatial: {
              getBaseCanvas: readers.getSpatialBaseCanvas,
              getOverlayCanvas: readers.getSpatialOverlayCanvas,
              mountPreviewCanvas: readers.mountSpatialPreviewCanvas,
              ...(options.spatial.placementJudge === undefined
                ? {}
                : { placementJudge: options.spatial.placementJudge }),
            },
          }),
    }),
  );

  useEffect(() => {
    readers.update(options);
  }, [options, readers]);

  useEffect(() => {
    ownerGenerationRef.current += 1;
    const generation = ownerGenerationRef.current;
    return () => {
      queueMicrotask(() => {
        if (ownerGenerationRef.current === generation) {
          composition.dispose();
        }
      });
    };
  }, [composition]);

  useEffect(
    () => subscribeToDevelopmentDirectCommandTraces(composition.direct.traces),
    [composition],
  );

  return composition;
}

function noteAgentRoutingOptions(): Pick<
  Parameters<typeof createBrowserDirectCommandComposition>[0],
  "noteAgent"
> | Record<string, never> {
  const configured = process.env.NEXT_PUBLIC_NOTE_AGENT_ROUTE;
  const legacyShadow = process.env.NEXT_PUBLIC_NOTE_AGENT_SHADOW_MODE === "1";
  if (configured !== "production" && configured !== "shadow" && !legacyShadow) {
    return {};
  }
  return {
    noteAgent: {
      mode: configured === "production" ? "PRODUCTION" : "SHADOW",
      provider: new HttpNoteDecisionProvider(),
    },
  };
}
