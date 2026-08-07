import type {
  SpeechProviderClock,
  SpeechProviderErrorDetail,
  SpeechProviderEvent,
  SpeechProviderEventListener,
  SpeechProviderSessionIdFactory,
  SpeechRecognitionConfig,
} from "../domain";
import { normalizeVoiceTranscriptSegmentText } from "../domain";
import type { SpeechRecognitionProvider } from "./speech-recognition-provider";
import {
  detectWebSpeechFeatures,
  getBrowserWebSpeechGlobalScope,
  normalizeSpeechBiasPhrases,
  readLocalRecognitionStatus,
  resolveWebSpeechConstructor,
} from "./web-speech-compat";
import type {
  ResolvedWebSpeechConstructor,
  WebSpeechGlobalScope,
  WebSpeechRecognitionErrorEventLike,
  WebSpeechRecognitionLike,
  WebSpeechRecognitionResultEventLike,
} from "./web-speech-compat";

export interface WebSpeechRecognitionProviderOptions {
  clock: SpeechProviderClock;
  providerId?: string;
  createSessionId?: SpeechProviderSessionIdFactory;
  getGlobalScope?: () => WebSpeechGlobalScope | undefined;
}

interface ActiveWebSpeechSession {
  id: string;
  recognition: WebSpeechRecognitionLike;
  finalSegmentIndexes: Set<number>;
  terminationRequest?: "stop" | "abort";
}

export class WebSpeechRecognitionStartError extends Error {
  public readonly detail: SpeechProviderErrorDetail;

  public constructor(detail: SpeechProviderErrorDetail) {
    super(detail.message ?? `Web Speech recognition failed: ${detail.code}`);
    this.name = "WebSpeechRecognitionStartError";
    this.detail = { ...detail };
  }
}

export class WebSpeechRecognitionProvider implements SpeechRecognitionProvider {
  public readonly id: string;

  private readonly listeners = new Set<SpeechProviderEventListener>();
  private readonly clock: SpeechProviderClock;
  private readonly createSessionId: SpeechProviderSessionIdFactory;
  private readonly getGlobalScope: () => WebSpeechGlobalScope | undefined;
  private activeSession: ActiveWebSpeechSession | undefined;
  private disposed = false;
  private startPending = false;
  private lifecycleGeneration = 0;
  private sessionSequence = 0;

  public constructor(options: WebSpeechRecognitionProviderOptions) {
    this.id = options.providerId ?? "web-speech";
    this.clock = options.clock;
    this.getGlobalScope = options.getGlobalScope ?? getBrowserWebSpeechGlobalScope;
    this.createSessionId =
      options.createSessionId ?? (() => this.createDefaultSessionId());
  }

  public async getAvailability(config: SpeechRecognitionConfig) {
    this.assertNotDisposed();
    const detection = await detectWebSpeechFeatures(config, this.getGlobalScope());
    return {
      ...detection.availability,
      local: { ...detection.availability.local },
    };
  }

  public async start(config: SpeechRecognitionConfig): Promise<void> {
    this.assertNotDisposed();
    if (this.activeSession || this.startPending) {
      throw createStartError(
        "invalid-state",
        "Speech recognition is already active or starting.",
      );
    }

    this.startPending = true;
    const generation = this.lifecycleGeneration;
    let recognition: WebSpeechRecognitionLike | undefined;
    let session: ActiveWebSpeechSession | undefined;

    try {
      const scope = this.getGlobalScope();
      const resolved = resolveWebSpeechConstructor(scope);
      if (!resolved) {
        throw createStartError(
          "unsupported",
          "Web Speech recognition is unavailable in this environment.",
        );
      }

      recognition = constructRecognition(resolved);
      applyRecognitionConfig(recognition, config);
      await configureLocalRecognition(recognition, resolved, config);

      if (this.disposed || generation !== this.lifecycleGeneration) {
        safeAbort(recognition);
        throw createStartError(
          "aborted",
          "Speech recognition start was cancelled during provider disposal.",
        );
      }

      session = {
        id: this.createSessionId(),
        recognition,
        finalSegmentIndexes: new Set<number>(),
      };
      this.activeSession = session;
      this.attachEventHandlers(session);
      this.applyContextualPhrases(scope, session, config);

      try {
        recognition.start();
      } catch (error) {
        const detail = normalizeWebSpeechStartFailure(error);
        this.emitSessionError(session, detail);
        throw new WebSpeechRecognitionStartError(detail);
      }
    } catch (error) {
      if (session && this.activeSession === session) {
        this.releaseSession(session);
      } else if (recognition) {
        clearEventHandlers(recognition);
      }

      if (error instanceof WebSpeechRecognitionStartError) {
        throw error;
      }
      throw new WebSpeechRecognitionStartError(
        normalizeWebSpeechStartFailure(error),
      );
    } finally {
      this.startPending = false;
    }
  }

  public stop(): void {
    const session = this.activeSession;
    if (this.disposed || !session || session.terminationRequest) {
      return;
    }

    session.terminationRequest = "stop";
    try {
      session.recognition.stop();
    } catch (error) {
      this.emitSessionError(session, normalizeWebSpeechStartFailure(error));
    }
  }

  public abort(): void {
    const session = this.activeSession;
    if (
      this.disposed ||
      !session ||
      session.terminationRequest === "abort"
    ) {
      return;
    }

    session.terminationRequest = "abort";
    try {
      session.recognition.abort();
    } catch (error) {
      this.emitSessionError(session, normalizeWebSpeechStartFailure(error));
    }
  }

  public subscribe(listener: SpeechProviderEventListener): () => void {
    if (this.disposed) {
      return () => undefined;
    }

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.lifecycleGeneration += 1;
    const session = this.activeSession;
    if (session) {
      this.releaseSession(session);
      safeAbort(session.recognition);
    }
    this.listeners.clear();
  }

  public get activeSessionId(): string | undefined {
    return this.activeSession?.id;
  }

  private attachEventHandlers(session: ActiveWebSpeechSession): void {
    const { recognition } = session;
    recognition.onstart = () => {
      this.emitSimpleEvent(session, "provider-start");
    };
    recognition.onaudiostart = () => {
      this.emitSimpleEvent(session, "audio-start");
    };
    recognition.onspeechstart = () => {
      this.emitSimpleEvent(session, "speech-start");
    };
    recognition.onresult = (event) => {
      this.handleResult(session, event);
    };
    recognition.onspeechend = () => {
      this.emitSimpleEvent(session, "speech-end");
    };
    recognition.onaudioend = () => {
      this.emitSimpleEvent(session, "audio-end");
    };
    recognition.onerror = (event) => {
      this.handleError(session, event);
    };
    recognition.onend = () => {
      this.handleEnd(session);
    };
  }

  private applyContextualPhrases(
    scope: WebSpeechGlobalScope | undefined,
    session: ActiveWebSpeechSession,
    config: SpeechRecognitionConfig,
  ): void {
    const Phrase = scope?.SpeechRecognitionPhrase;
    if (
      typeof Phrase !== "function" ||
      !("phrases" in session.recognition)
    ) {
      return;
    }

    const phrases = normalizeSpeechBiasPhrases(config.phrases);
    if (phrases.length === 0) {
      return;
    }

    try {
      session.recognition.phrases = phrases.map((phrase) =>
        phrase.boost === undefined
          ? new Phrase(phrase.text)
          : new Phrase(phrase.text, phrase.boost),
      );
    } catch (error) {
      try {
        session.recognition.phrases = [];
      } catch {
        // A rejecting experimental setter must not block base recognition.
      }
      this.emitSessionError(session, {
        code: "phrases-not-supported",
        message: "Contextual speech phrases were rejected; recognition will continue without them.",
        recoverable: true,
        retryPolicy: "restart-once",
        rawMessage: readErrorMessage(error),
      });
    }
  }

  private handleResult(
    session: ActiveWebSpeechSession,
    event: WebSpeechRecognitionResultEventLike,
  ): void {
    if (!this.isCurrentSession(session)) {
      return;
    }

    const resultCount = event.results.length;
    const startIndex = normalizeResultStartIndex(event.resultIndex, resultCount);
    for (let index = startIndex; index < resultCount; index += 1) {
      const result = event.results[index] ?? event.results.item?.(index);
      if (!result || session.finalSegmentIndexes.has(index)) {
        continue;
      }

      const alternative = result[0] ?? result.item?.(0);
      const text = alternative
        ? normalizeVoiceTranscriptSegmentText(alternative.transcript)
        : "";
      if (!alternative || !text) {
        continue;
      }

      if (result.isFinal) {
        session.finalSegmentIndexes.add(index);
      }

      const transcriptEvent: SpeechProviderEvent = {
        type: "transcript",
        at: this.readTime(),
        sessionId: session.id,
        segmentId: `speech:${session.id}:result:${index}`,
        segmentIndex: index,
        text,
        isFinal: result.isFinal,
      };
      if (
        alternative.confidence !== undefined &&
        Number.isFinite(alternative.confidence)
      ) {
        transcriptEvent.confidence = alternative.confidence;
      }
      this.emit(transcriptEvent);
    }
  }
  private handleError(
    session: ActiveWebSpeechSession,
    event: WebSpeechRecognitionErrorEventLike,
  ): void {
    if (!this.isCurrentSession(session)) {
      return;
    }

    this.emitSessionError(
      session,
      normalizeWebSpeechRecognitionError(event.error, event.message),
    );
  }

  private handleEnd(session: ActiveWebSpeechSession): void {
    if (!this.isCurrentSession(session)) {
      return;
    }

    const event: SpeechProviderEvent = {
      type: "provider-end",
      at: this.readTime(),
      sessionId: session.id,
      intentional: session.terminationRequest !== undefined,
    };
    this.releaseSession(session);
    this.emit(event);
  }

  private emitSimpleEvent(
    session: ActiveWebSpeechSession,
    type:
      | "provider-start"
      | "audio-start"
      | "speech-start"
      | "speech-end"
      | "audio-end",
  ): void {
    if (!this.isCurrentSession(session)) {
      return;
    }

    this.emit({
      type,
      at: this.readTime(),
      sessionId: session.id,
    });
  }

  private emitSessionError(
    session: ActiveWebSpeechSession,
    error: SpeechProviderErrorDetail,
  ): void {
    if (!this.isCurrentSession(session)) {
      return;
    }

    this.emit({
      type: "error",
      at: this.readTime(),
      sessionId: session.id,
      error: { ...error },
    });
  }

  private emit(event: SpeechProviderEvent): void {
    if (this.disposed) {
      return;
    }

    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  private isCurrentSession(session: ActiveWebSpeechSession): boolean {
    return !this.disposed && this.activeSession === session;
  }

  private releaseSession(session: ActiveWebSpeechSession): void {
    clearEventHandlers(session.recognition);
    if (this.activeSession === session) {
      this.activeSession = undefined;
    }
  }

  private readTime(): number {
    const value = Number(this.clock.now());
    if (!Number.isFinite(value)) {
      throw new RangeError("Speech provider clock must return a finite number.");
    }
    return value;
  }

  private createDefaultSessionId(): string {
    this.sessionSequence += 1;
    const randomUuid = globalThis.crypto?.randomUUID?.();
    return randomUuid
      ? `web-speech-session-${randomUuid}`
      : `web-speech-session-${this.sessionSequence}`;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Speech recognition provider is disposed.");
    }
  }
}

export function normalizeWebSpeechRecognitionError(
  rawCode: unknown,
  rawMessage?: unknown,
): SpeechProviderErrorDetail {
  const code = typeof rawCode === "string" ? rawCode : "unknown";
  const message = typeof rawMessage === "string" && rawMessage.length > 0
    ? rawMessage
    : undefined;

  switch (code) {
    case "no-speech":
      return createErrorDetail(code, message, true, "restart-while-mode-active");
    case "network":
      return createErrorDetail(code, message, true, "restart-while-mode-active");
    case "phrases-not-supported":
      return createErrorDetail(code, message, true, "restart-once");
    case "invalid-state":
      return createErrorDetail(code, message, true, "restart-once");
    case "aborted":
    case "audio-capture":
    case "not-allowed":
    case "service-not-allowed":
    case "language-not-supported":
      return createErrorDetail(code, message, false, "none");
    default:
      return createErrorDetail("unknown", message, false, "none", code);
  }
}

function constructRecognition(
  resolved: ResolvedWebSpeechConstructor,
): WebSpeechRecognitionLike {
  try {
    return new resolved.Recognition();
  } catch (error) {
    throw new WebSpeechRecognitionStartError(
      normalizeWebSpeechStartFailure(error),
    );
  }
}

function applyRecognitionConfig(
  recognition: WebSpeechRecognitionLike,
  config: SpeechRecognitionConfig,
): void {
  recognition.lang = config.lang;
  recognition.continuous = config.continuous;
  recognition.interimResults = config.interimResults;
  recognition.maxAlternatives = config.maxAlternatives;
}

async function configureLocalRecognition(
  recognition: WebSpeechRecognitionLike,
  resolved: ResolvedWebSpeechConstructor,
  config: SpeechRecognitionConfig,
): Promise<void> {
  if (config.mode === "browser-default") {
    return;
  }

  const localFeatureSupported =
    "processLocally" in recognition &&
    typeof resolved.Recognition.available === "function";
  if (!localFeatureSupported) {
    if (config.mode === "local-required") {
      throw createStartError(
        "unsupported",
        "Local speech recognition is not supported by this browser.",
      );
    }
    return;
  }

  const status = await readLocalRecognitionStatus(
    resolved.Recognition,
    config.lang,
  );
  if (status === "available") {
    recognition.processLocally = true;
    return;
  }

  if (config.mode === "local-required") {
    throw createStartError(
      "language-not-supported",
      `A local speech recognition pack is not available for ${config.lang}.`,
    );
  }
}

function normalizeWebSpeechStartFailure(error: unknown): SpeechProviderErrorDetail {
  if (error instanceof WebSpeechRecognitionStartError) {
    return { ...error.detail };
  }

  if (isNamedError(error, "InvalidStateError")) {
    return createErrorDetail(
      "invalid-state",
      readErrorMessage(error),
      true,
      "restart-once",
    );
  }

  return createErrorDetail(
    "unknown",
    readErrorMessage(error),
    false,
    "none",
  );
}

function createStartError(
  code: "unsupported" | "aborted" | "language-not-supported" | "invalid-state",
  message: string,
): WebSpeechRecognitionStartError {
  const detail = code === "invalid-state"
    ? createErrorDetail(code, message, true, "restart-once")
    : createErrorDetail(code, message, false, "none");
  return new WebSpeechRecognitionStartError(detail);
}

function createErrorDetail(
  code: SpeechProviderErrorDetail["code"],
  message: string | undefined,
  recoverable: boolean,
  retryPolicy: SpeechProviderErrorDetail["retryPolicy"],
  rawCode: string = code,
): SpeechProviderErrorDetail {
  const detail: SpeechProviderErrorDetail = {
    code,
    recoverable,
    retryPolicy,
    rawCode,
  };
  if (message !== undefined) {
    detail.message = message;
    detail.rawMessage = message;
  }
  return detail;
}

function normalizeResultStartIndex(
  rawIndex: number,
  resultCount: number,
): number {
  if (resultCount <= 0) {
    return 0;
  }

  if (!Number.isFinite(rawIndex)) {
    return 0;
  }

  const index = Math.trunc(rawIndex);
  if (!Number.isFinite(index)) {
    return 0;
  }

  return Math.min(Math.max(0, index), resultCount);
}

function clearEventHandlers(recognition: WebSpeechRecognitionLike): void {
  recognition.onstart = null;
  recognition.onaudiostart = null;
  recognition.onspeechstart = null;
  recognition.onresult = null;
  recognition.onspeechend = null;
  recognition.onaudioend = null;
  recognition.onerror = null;
  recognition.onend = null;
}

function safeAbort(recognition: WebSpeechRecognitionLike): void {
  try {
    recognition.abort();
  } catch {
    // Disposal must remain idempotent even when a browser rejects abort().
  }
}

function isNamedError(error: unknown, name: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === name
  );
}

function readErrorMessage(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return undefined;
}
