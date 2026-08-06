import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMMAND_RECOGNITION_CONFIG } from "../domain";
import type {
  WebSpeechGlobalScope,
  WebSpeechRecognitionConstructor,
  WebSpeechRecognitionLike,
} from "./web-speech-compat";
import {
  MAX_SPEECH_BIAS_PHRASES,
  detectWebSpeechFeatures,
  normalizeSpeechBiasPhrases,
  resolveWebSpeechConstructor,
} from "./web-speech-compat";

function createRecognitionConstructor(options: {
  phrases?: boolean;
  local?: boolean;
  localStatus?: string;
  install?: boolean;
} = {}): WebSpeechRecognitionConstructor {
  class Recognition implements WebSpeechRecognitionLike {
    public lang = "";
    public continuous = false;
    public interimResults = false;
    public maxAlternatives = 0;
    public onstart = null;
    public onaudiostart = null;
    public onspeechstart = null;
    public onresult = null;
    public onspeechend = null;
    public onaudioend = null;
    public onerror = null;
    public onend = null;

    public constructor() {
      if (options.phrases) {
        Object.defineProperty(this, "phrases", {
          value: [],
          writable: true,
          configurable: true,
        });
      }
      if (options.local) {
        Object.defineProperty(this, "processLocally", {
          value: false,
          writable: true,
          configurable: true,
        });
      }
    }

    public start(): void {}
    public stop(): void {}
    public abort(): void {}
  }

  const Constructor = Recognition as unknown as WebSpeechRecognitionConstructor;
  if (options.local) {
    Constructor.available = vi.fn(async () => options.localStatus ?? "available");
  }
  if (options.install) {
    Constructor.install = vi.fn(async () => true);
  }
  return Constructor;
}

describe("Web Speech feature detection", () => {
  it("prefers the standard constructor over the prefixed constructor", () => {
    const standard = createRecognitionConstructor();
    const prefixed = createRecognitionConstructor();

    expect(
      resolveWebSpeechConstructor({
        SpeechRecognition: standard,
        webkitSpeechRecognition: prefixed,
      }),
    ).toEqual({
      constructorName: "SpeechRecognition",
      Recognition: standard,
    });
  });

  it("falls back to webkitSpeechRecognition", async () => {
    const prefixed = createRecognitionConstructor();
    const detection = await detectWebSpeechFeatures(
      DEFAULT_COMMAND_RECOGNITION_CONFIG,
      { webkitSpeechRecognition: prefixed },
    );

    expect(detection.availability).toMatchObject({
      supported: true,
      constructorName: "webkitSpeechRecognition",
    });
  });

  it("reports unsupported when neither constructor exists", async () => {
    await expect(
      detectWebSpeechFeatures(DEFAULT_COMMAND_RECOGNITION_CONFIG, undefined),
    ).resolves.toEqual({
      availability: {
        supported: false,
        local: { supported: false, status: "unknown" },
        contextualBiasingSupported: false,
      },
      phraseConstructorSupported: false,
      phrasesPropertySupported: false,
      processLocallySupported: false,
      availableSupported: false,
      installSupported: false,
    });
  });

  it("detects phrase, local availability, and install features without installing", async () => {
    const Recognition = createRecognitionConstructor({
      phrases: true,
      local: true,
      localStatus: "downloadable",
      install: true,
    });
    const phraseConstructor = class {
      public constructor(
        public readonly text: string,
        public readonly boost?: number,
      ) {}
    };
    const scope: WebSpeechGlobalScope = {
      SpeechRecognition: Recognition,
      SpeechRecognitionPhrase: phraseConstructor,
    };

    const detection = await detectWebSpeechFeatures(
      DEFAULT_COMMAND_RECOGNITION_CONFIG,
      scope,
    );

    expect(detection).toMatchObject({
      availability: {
        supported: true,
        local: { supported: true, status: "downloadable" },
        contextualBiasingSupported: true,
      },
      phraseConstructorSupported: true,
      phrasesPropertySupported: true,
      processLocallySupported: true,
      availableSupported: true,
      installSupported: true,
    });
    expect(Recognition.install).not.toHaveBeenCalled();
  });

  it("limits, deduplicates, validates length, and clamps phrase boosts", () => {
    const phrases = Array.from({ length: 35 }, (_, index) => ({
      text: `용어-${index}`,
      boost: index === 0 ? -2 : index === 1 ? 20 : 3,
    }));
    phrases.splice(2, 0, { text: "용어-1", boost: 4 });
    phrases.splice(3, 0, { text: "x".repeat(41), boost: 4 });

    const normalized = normalizeSpeechBiasPhrases(phrases);

    expect(normalized).toHaveLength(MAX_SPEECH_BIAS_PHRASES);
    expect(normalized[0]).toEqual({ text: "용어-0", boost: 0 });
    expect(normalized[1]).toEqual({ text: "용어-1", boost: 10 });
    expect(normalized.filter((phrase) => phrase.text === "용어-1")).toHaveLength(1);
    expect(normalized.some((phrase) => phrase.text.length > 40)).toBe(false);
  });
});
