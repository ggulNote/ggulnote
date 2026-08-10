"use client";

import type { EditorEngine } from "@ggulnote/editor-core";
import { useEffect, useRef, useState } from "react";
import type { VoiceTurnContextRead } from "../application";
import type { FrozenPageGroundingSnapshot } from "../domain";
import { HttpGroundedTargetRecoveryProvider } from "../providers";
import {
  createBrowserDirectCommandComposition,
  type BrowserDirectCommandComposition,
} from "./browser-direct-command-composition";
import { subscribeToDevelopmentDirectCommandTraces } from "./direct-command-development-trace";

export interface OwnedBrowserDirectCommandCompositionOptions {
  editorEngine: EditorEngine;
  readCurrentVoiceContext(): VoiceTurnContextRead;
  readCurrentGroundingSnapshot(): FrozenPageGroundingSnapshot | undefined;
  getCurrentSceneRevision(): number;
  getCurrentPage(): number;
  goToPage(page: number): void;
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
      recovery: new HttpGroundedTargetRecoveryProvider(),
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
