"use client";

import { useEffect, useRef, useState } from "react";
import type {
  VoiceTurnContextRead,
} from "../application";
import type { VoiceTurnController } from "../application";
import {
  createBrowserVoiceTurnComposition,
  type BrowserVoiceTurnComposition,
} from "./browser-voice-turn-composition";

class VoiceContextReader {
  public constructor(
    private readContext: () => VoiceTurnContextRead,
  ) {}

  public read = (): VoiceTurnContextRead => this.readContext();

  public update(readContext: () => VoiceTurnContextRead): void {
    this.readContext = readContext;
  }
}

export function useOwnedBrowserVoiceTurnController(
  readCurrentContext: () => VoiceTurnContextRead,
): VoiceTurnController {
  const ownerGenerationRef = useRef(0);
  const [contextReader] = useState(() =>
    new VoiceContextReader(readCurrentContext),
  );
  const [composition] = useState<BrowserVoiceTurnComposition>(() =>
    createBrowserVoiceTurnComposition({
      readCurrentContext: contextReader.read,
    }),
  );

  useEffect(() => {
    contextReader.update(readCurrentContext);
  }, [contextReader, readCurrentContext]);

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

  return composition.controller;
}
