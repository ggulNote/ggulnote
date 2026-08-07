import type {
  LocalRecognitionStatus,
  SpeechBiasPhrase,
  SpeechProviderAvailability,
  SpeechRecognitionConfig,
} from "../domain";

export const MAX_SPEECH_BIAS_PHRASES = 30;
export const MAX_SPEECH_BIAS_PHRASE_LENGTH = 40;
export const MIN_SPEECH_BIAS_BOOST = 0;
export const MAX_SPEECH_BIAS_BOOST = 10;

export interface WebSpeechEventLike {
  readonly timeStamp?: number;
}

export interface WebSpeechRecognitionAlternativeLike {
  readonly transcript: string;
  readonly confidence?: number;
}

export interface WebSpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: WebSpeechRecognitionAlternativeLike;
  item?(index: number): WebSpeechRecognitionAlternativeLike | null;
}

export interface WebSpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: WebSpeechRecognitionResultLike;
  item?(index: number): WebSpeechRecognitionResultLike | null;
}

export interface WebSpeechRecognitionResultEventLike extends WebSpeechEventLike {
  readonly resultIndex: number;
  readonly results: WebSpeechRecognitionResultListLike;
}

export interface WebSpeechRecognitionErrorEventLike extends WebSpeechEventLike {
  readonly error?: string;
  readonly message?: string;
}

type WebSpeechEventHandler<TEvent extends WebSpeechEventLike = WebSpeechEventLike> =
  | ((event: TEvent) => void)
  | null;

export interface WebSpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  phrases?: unknown[];
  processLocally?: boolean;
  onstart: WebSpeechEventHandler;
  onaudiostart: WebSpeechEventHandler;
  onspeechstart: WebSpeechEventHandler;
  onresult: WebSpeechEventHandler<WebSpeechRecognitionResultEventLike>;
  onspeechend: WebSpeechEventHandler;
  onaudioend: WebSpeechEventHandler;
  onerror: WebSpeechEventHandler<WebSpeechRecognitionErrorEventLike>;
  onend: WebSpeechEventHandler;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface WebSpeechLocalAvailabilityOptions {
  langs: string[];
  processLocally: boolean;
}

export interface WebSpeechRecognitionConstructor {
  new (): WebSpeechRecognitionLike;
  available?(
    options: WebSpeechLocalAvailabilityOptions,
  ): Promise<string>;
  install?(
    options: WebSpeechLocalAvailabilityOptions,
  ): Promise<boolean>;
}

export interface WebSpeechRecognitionPhraseConstructor {
  new (phrase: string, boost?: number): unknown;
}

export interface WebSpeechGlobalScope {
  SpeechRecognition?: WebSpeechRecognitionConstructor;
  webkitSpeechRecognition?: WebSpeechRecognitionConstructor;
  SpeechRecognitionPhrase?: WebSpeechRecognitionPhraseConstructor;
}

export interface ResolvedWebSpeechConstructor {
  constructorName: "SpeechRecognition" | "webkitSpeechRecognition";
  Recognition: WebSpeechRecognitionConstructor;
}

export interface WebSpeechFeatureDetection {
  availability: SpeechProviderAvailability;
  phraseConstructorSupported: boolean;
  phrasesPropertySupported: boolean;
  processLocallySupported: boolean;
  availableSupported: boolean;
  installSupported: boolean;
}

export interface NormalizedSpeechBiasPhrase {
  text: string;
  boost?: number;
}

export function getBrowserWebSpeechGlobalScope(): WebSpeechGlobalScope | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window as unknown as WebSpeechGlobalScope;
}

export function resolveWebSpeechConstructor(
  scope: WebSpeechGlobalScope | undefined,
): ResolvedWebSpeechConstructor | undefined {
  if (typeof scope?.SpeechRecognition === "function") {
    return {
      constructorName: "SpeechRecognition",
      Recognition: scope.SpeechRecognition,
    };
  }

  if (typeof scope?.webkitSpeechRecognition === "function") {
    return {
      constructorName: "webkitSpeechRecognition",
      Recognition: scope.webkitSpeechRecognition,
    };
  }

  return undefined;
}

export async function detectWebSpeechFeatures(
  config: SpeechRecognitionConfig,
  scope: WebSpeechGlobalScope | undefined = getBrowserWebSpeechGlobalScope(),
): Promise<WebSpeechFeatureDetection> {
  const resolved = resolveWebSpeechConstructor(scope);
  if (!resolved) {
    return createUnsupportedFeatureDetection();
  }

  let probe: WebSpeechRecognitionLike | undefined;
  try {
    probe = new resolved.Recognition();
  } catch {
    // A present constructor still means basic API support. Start will surface
    // construction failures without making module import or availability fatal.
  }

  const phraseConstructorSupported =
    typeof scope?.SpeechRecognitionPhrase === "function";
  const phrasesPropertySupported = probe ? "phrases" in probe : false;
  const processLocallySupported = probe ? "processLocally" in probe : false;
  const availableSupported = typeof resolved.Recognition.available === "function";
  const installSupported = typeof resolved.Recognition.install === "function";
  const localSupported = processLocallySupported && availableSupported;
  const localStatus = localSupported
    ? await readLocalRecognitionStatus(resolved.Recognition, config.lang)
    : "unknown";

  return {
    availability: {
      supported: true,
      constructorName: resolved.constructorName,
      local: {
        supported: localSupported,
        status: localStatus,
      },
      contextualBiasingSupported:
        phraseConstructorSupported && phrasesPropertySupported,
    },
    phraseConstructorSupported,
    phrasesPropertySupported,
    processLocallySupported,
    availableSupported,
    installSupported,
  };
}

export async function readLocalRecognitionStatus(
  Recognition: WebSpeechRecognitionConstructor,
  lang: string,
): Promise<LocalRecognitionStatus> {
  if (typeof Recognition.available !== "function") {
    return "unknown";
  }

  try {
    const status = await Recognition.available({
      langs: [lang],
      processLocally: true,
    });
    return normalizeLocalRecognitionStatus(status);
  } catch {
    return "unknown";
  }
}

export function normalizeSpeechBiasPhrases(
  phrases: readonly SpeechBiasPhrase[],
): NormalizedSpeechBiasPhrase[] {
  const normalized: NormalizedSpeechBiasPhrase[] = [];
  const seen = new Set<string>();

  for (const phrase of phrases) {
    if (normalized.length >= MAX_SPEECH_BIAS_PHRASES) {
      break;
    }

    const text = phrase.text.trim();
    if (
      text.length === 0 ||
      text.length > MAX_SPEECH_BIAS_PHRASE_LENGTH ||
      seen.has(text)
    ) {
      continue;
    }

    seen.add(text);
    const value: NormalizedSpeechBiasPhrase = { text };
    if (phrase.boost !== undefined && Number.isFinite(phrase.boost)) {
      value.boost = Math.min(
        MAX_SPEECH_BIAS_BOOST,
        Math.max(MIN_SPEECH_BIAS_BOOST, phrase.boost),
      );
    }
    normalized.push(value);
  }

  return normalized;
}

function createUnsupportedFeatureDetection(): WebSpeechFeatureDetection {
  return {
    availability: {
      supported: false,
      local: {
        supported: false,
        status: "unknown",
      },
      contextualBiasingSupported: false,
    },
    phraseConstructorSupported: false,
    phrasesPropertySupported: false,
    processLocallySupported: false,
    availableSupported: false,
    installSupported: false,
  };
}

function normalizeLocalRecognitionStatus(status: string): LocalRecognitionStatus {
  switch (status) {
    case "unavailable":
    case "downloadable":
    case "downloading":
    case "available":
      return status;
    default:
      return "unknown";
  }
}
