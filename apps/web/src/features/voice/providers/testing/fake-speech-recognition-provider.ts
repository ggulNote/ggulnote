import type {
  SpeechProviderAvailability,
  SpeechProviderClock,
  SpeechProviderError,
  SpeechProviderEvent,
  SpeechProviderEventListener,
  SpeechProviderSessionIdFactory,
  SpeechRecognitionConfig,
} from "../../domain";
import { cloneSpeechRecognitionConfig } from "../../domain";
import type { SpeechRecognitionProvider } from "../speech-recognition-provider";

export interface FakeSpeechRecognitionProviderOptions {
  clock: SpeechProviderClock;
  providerId?: string;
  createSessionId?: SpeechProviderSessionIdFactory;
  availability?: SpeechProviderAvailability;
}

export interface FakeSpeechEventOptions {
  at?: number;
  sessionId?: string;
}

export interface FakeTranscriptEventOptions extends FakeSpeechEventOptions {
  confidence?: number;
  segmentId?: string;
}

const DEFAULT_FAKE_AVAILABILITY: SpeechProviderAvailability = {
  supported: true,
  constructorName: "SpeechRecognition",
  local: {
    supported: false,
    status: "unknown",
  },
  contextualBiasingSupported: false,
};

function cloneAvailability(value: SpeechProviderAvailability): SpeechProviderAvailability {
  return {
    ...value,
    local: { ...value.local },
  };
}

export class FakeSpeechRecognitionProvider implements SpeechRecognitionProvider {
  public readonly id: string;

  private readonly listeners = new Set<SpeechProviderEventListener>();
  private readonly clock: SpeechProviderClock;
  private readonly createSessionId: SpeechProviderSessionIdFactory;
  private readonly availability: SpeechProviderAvailability;
  private sessionSequence = 0;
  private currentSessionId: string | undefined;
  private terminationRequest: "stop" | "abort" | undefined;
  private disposed = false;
  private lastStartedConfig: SpeechRecognitionConfig | undefined;
  private startCalls = 0;
  private stopCalls = 0;
  private abortCalls = 0;

  public constructor(options: FakeSpeechRecognitionProviderOptions) {
    this.id = options.providerId ?? "fake-web-speech";
    this.clock = options.clock;
    this.createSessionId = options.createSessionId ?? (() => {
      this.sessionSequence += 1;
      return `fake-speech-session-${this.sessionSequence}`;
    });
    this.availability = cloneAvailability(options.availability ?? DEFAULT_FAKE_AVAILABILITY);
  }

  public async getAvailability(
    _config: SpeechRecognitionConfig,
  ): Promise<SpeechProviderAvailability> {
    this.assertNotDisposed();
    return cloneAvailability(this.availability);
  }

  public async start(config: SpeechRecognitionConfig): Promise<void> {
    this.assertNotDisposed();
    if (this.currentSessionId) {
      throw new Error("Speech recognition is already active.");
    }

    this.startCalls += 1;
    this.lastStartedConfig = cloneSpeechRecognitionConfig(config);
    this.currentSessionId = this.createSessionId();
    this.terminationRequest = undefined;
  }

  public stop(): void {
    if (this.disposed || !this.currentSessionId || this.terminationRequest) {
      return;
    }

    this.stopCalls += 1;
    this.terminationRequest = "stop";
  }

  public abort(): void {
    if (this.disposed || !this.currentSessionId || this.terminationRequest === "abort") {
      return;
    }

    this.abortCalls += 1;
    this.terminationRequest = "abort";
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
    this.currentSessionId = undefined;
    this.terminationRequest = undefined;
    this.listeners.clear();
  }

  public get activeSessionId(): string | undefined {
    return this.currentSessionId;
  }

  public get startCallCount(): number {
    return this.startCalls;
  }

  public get stopCallCount(): number {
    return this.stopCalls;
  }

  public get abortCallCount(): number {
    return this.abortCalls;
  }

  public get lastConfig(): SpeechRecognitionConfig | undefined {
    return this.lastStartedConfig
      ? cloneSpeechRecognitionConfig(this.lastStartedConfig)
      : undefined;
  }

  public emitProviderStart(options: FakeSpeechEventOptions = {}): void {
    this.emitSimpleEvent("provider-start", options);
  }

  public emitAudioStart(options: FakeSpeechEventOptions = {}): void {
    this.emitSimpleEvent("audio-start", options);
  }

  public emitSpeechStart(options: FakeSpeechEventOptions = {}): void {
    this.emitSimpleEvent("speech-start", options);
  }

  public emitInterim(
    segmentIndex: number,
    text: string,
    options: FakeTranscriptEventOptions = {},
  ): void {
    this.emitTranscript(segmentIndex, text, false, options);
  }

  public emitFinal(
    segmentIndex: number,
    text: string,
    options: FakeTranscriptEventOptions = {},
  ): void {
    this.emitTranscript(segmentIndex, text, true, options);
  }

  public emitSpeechEnd(options: FakeSpeechEventOptions = {}): void {
    this.emitSimpleEvent("speech-end", options);
  }

  public emitAudioEnd(options: FakeSpeechEventOptions = {}): void {
    this.emitSimpleEvent("audio-end", options);
  }

  public emitProviderEnd(options: FakeSpeechEventOptions & { intentional?: boolean } = {}): void {
    const sessionId = this.resolveSessionId(options.sessionId);
    const event: SpeechProviderEvent = {
      type: "provider-end",
      at: this.resolveTime(options.at),
      sessionId,
      intentional: options.intentional ?? this.terminationRequest !== undefined,
    };

    this.emit(event);
    if (sessionId === this.currentSessionId) {
      this.currentSessionId = undefined;
      this.terminationRequest = undefined;
    }
  }

  public emitError(error: SpeechProviderError, options: FakeSpeechEventOptions = {}): void {
    this.emit({
      type: "error",
      at: this.resolveTime(options.at),
      sessionId: this.resolveSessionId(options.sessionId),
      error: { ...error },
    });
  }

  public emit(event: SpeechProviderEvent): void {
    if (this.disposed) {
      return;
    }

    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  private emitSimpleEvent(
    type: "provider-start" | "audio-start" | "speech-start" | "speech-end" | "audio-end",
    options: FakeSpeechEventOptions,
  ): void {
    this.emit({
      type,
      at: this.resolveTime(options.at),
      sessionId: this.resolveSessionId(options.sessionId),
    });
  }

  private emitTranscript(
    segmentIndex: number,
    text: string,
    isFinal: boolean,
    options: FakeTranscriptEventOptions,
  ): void {
    const sessionId = this.resolveSessionId(options.sessionId);
    const event: SpeechProviderEvent = {
      type: "transcript",
      at: this.resolveTime(options.at),
      sessionId,
      segmentId: options.segmentId ?? `speech:${sessionId}:result:${segmentIndex}`,
      segmentIndex,
      text,
      isFinal,
    };

    if (options.confidence !== undefined) {
      event.confidence = options.confidence;
    }

    this.emit(event);
  }

  private resolveSessionId(sessionId: string | undefined): string {
    const resolved = sessionId ?? this.currentSessionId;
    if (!resolved) {
      throw new Error("No fake speech recognition session is active.");
    }

    return resolved;
  }

  private resolveTime(at: number | undefined): number {
    const resolved = at ?? Number(this.clock.now());
    if (!Number.isFinite(resolved)) {
      throw new RangeError("Fake speech event time must be finite.");
    }

    return resolved;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Speech recognition provider is disposed.");
    }
  }
}
