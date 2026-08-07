import { InteractionClock } from "@ggulnote/interaction-core";
import { describe, expect, it, vi } from "vitest";
import type { SpeechProviderEvent, SpeechRecognitionConfig } from "../domain";
import { DEFAULT_COMMAND_RECOGNITION_CONFIG } from "../domain";
import type {
  WebSpeechGlobalScope,
  WebSpeechRecognitionConstructor,
  WebSpeechRecognitionErrorEventLike,
  WebSpeechRecognitionLike,
  WebSpeechRecognitionResultEventLike,
  WebSpeechRecognitionResultLike,
  WebSpeechRecognitionResultListLike,
} from "./web-speech-compat";
import {
  WebSpeechRecognitionProvider,
  WebSpeechRecognitionStartError,
  normalizeWebSpeechRecognitionError,
} from "./web-speech-recognition-provider";

interface MockBrowserOptions {
  prefixed?: boolean;
  phrases?: boolean;
  local?: boolean;
  localStatus?: string;
  startError?: Error;
}

class MockRecognition implements WebSpeechRecognitionLike {
  public lang = "";
  public continuous = false;
  public interimResults = false;
  public maxAlternatives = 0;
  public declare phrases?: unknown[];
  public declare processLocally?: boolean;
  public onstart: WebSpeechRecognitionLike["onstart"] = null;
  public onaudiostart: WebSpeechRecognitionLike["onaudiostart"] = null;
  public onspeechstart: WebSpeechRecognitionLike["onspeechstart"] = null;
  public onresult: WebSpeechRecognitionLike["onresult"] = null;
  public onspeechend: WebSpeechRecognitionLike["onspeechend"] = null;
  public onaudioend: WebSpeechRecognitionLike["onaudioend"] = null;
  public onerror: WebSpeechRecognitionLike["onerror"] = null;
  public onend: WebSpeechRecognitionLike["onend"] = null;
  public readonly start = vi.fn(() => {
    if (this.options.startError) {
      throw this.options.startError;
    }
  });
  public readonly stop = vi.fn();
  public readonly abort = vi.fn();

  public constructor(private readonly options: MockBrowserOptions) {
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

  public emitStart(): void {
    this.onstart?.({});
  }

  public emitAudioStart(): void {
    this.onaudiostart?.({});
  }

  public emitSpeechStart(): void {
    this.onspeechstart?.({});
  }

  public emitResult(event: WebSpeechRecognitionResultEventLike): void {
    this.onresult?.(event);
  }

  public emitSpeechEnd(): void {
    this.onspeechend?.({});
  }

  public emitAudioEnd(): void {
    this.onaudioend?.({});
  }

  public emitError(error: string, message?: string): void {
    const event: WebSpeechRecognitionErrorEventLike = { error };
    if (message !== undefined) {
      Object.assign(event, { message });
    }
    this.onerror?.(event);
  }

  public emitEnd(): void {
    this.onend?.({});
  }
}

function createMockBrowser(options: MockBrowserOptions = {}): {
  scope: WebSpeechGlobalScope;
  instances: MockRecognition[];
  phraseValues: Array<{ text: string; boost?: number }>;
} {
  const instances: MockRecognition[] = [];
  const phraseValues: Array<{ text: string; boost?: number }> = [];
  const Constructor = class extends MockRecognition {
    public constructor() {
      super(options);
      instances.push(this);
    }
  } as unknown as WebSpeechRecognitionConstructor;

  if (options.local) {
    Constructor.available = vi.fn(async () => options.localStatus ?? "available");
  }

  const scope: WebSpeechGlobalScope = options.prefixed
    ? { webkitSpeechRecognition: Constructor }
    : { SpeechRecognition: Constructor };
  if (options.phrases) {
    scope.SpeechRecognitionPhrase = class {
      public constructor(text: string, boost?: number) {
        const phrase: { text: string; boost?: number } = { text };
        if (boost !== undefined) {
          phrase.boost = boost;
        }
        phraseValues.push(phrase);
      }
    };
  }

  return { scope, instances, phraseValues };
}

function createProvider(scope: WebSpeechGlobalScope): {
  provider: WebSpeechRecognitionProvider;
  setNow: (value: number) => void;
} {
  let now = 1_000;
  const sessionIds = ["session-1", "session-2", "session-3"];
  const provider = new WebSpeechRecognitionProvider({
    clock: new InteractionClock(() => now),
    createSessionId: () => sessionIds.shift() ?? "unexpected-session",
    getGlobalScope: () => scope,
  });

  return {
    provider,
    setNow: (value) => {
      now = value;
    },
  };
}

function createResult(
  text: string,
  isFinal: boolean,
  confidence = 0.9,
): WebSpeechRecognitionResultLike {
  const alternative = { transcript: text, confidence };
  const values = [alternative] as unknown as WebSpeechRecognitionResultLike;
  Object.assign(values, {
    isFinal,
    item: (index: number) => (index === 0 ? alternative : null),
  });
  return values;
}

function createResultEvent(
  resultIndex: number,
  values: WebSpeechRecognitionResultLike[],
  timeStamp?: number,
): WebSpeechRecognitionResultEventLike {
  const results = values as unknown as WebSpeechRecognitionResultListLike;
  Object.assign(results, {
    item: (index: number) => values[index] ?? null,
  });
  const event: WebSpeechRecognitionResultEventLike = { resultIndex, results };
  if (timeStamp !== undefined) {
    Object.assign(event, { timeStamp });
  }
  return event;
}

function commandConfig(
  patch: Partial<SpeechRecognitionConfig> = {},
): SpeechRecognitionConfig {
  return {
    ...DEFAULT_COMMAND_RECOGNITION_CONFIG,
    ...patch,
    phrases: patch.phrases ? [...patch.phrases] : [],
  };
}

describe("WebSpeechRecognitionProvider", () => {
  it("applies config and blocks concurrent duplicate start", async () => {
    const browser = createMockBrowser();
    const { provider } = createProvider(browser.scope);
    const config = commandConfig({
      lang: "ko-KR",
      continuous: true,
      interimResults: true,
      maxAlternatives: 1,
    });

    const firstStart = provider.start(config);
    await expect(provider.start(config)).rejects.toMatchObject({
      detail: { code: "invalid-state" },
    });
    await firstStart;

    expect(browser.instances).toHaveLength(1);
    expect(browser.instances[0]).toMatchObject({
      lang: "ko-KR",
      continuous: true,
      interimResults: true,
      maxAlternatives: 1,
    });
    expect(browser.instances[0].start).toHaveBeenCalledTimes(1);
  });

  it("prefers SpeechRecognition over webkitSpeechRecognition", async () => {
    const speechInstances: MockRecognition[] = [];
    const webkitInstances: MockRecognition[] = [];

    const SpeechRecognition = class extends MockRecognition {
      public constructor() {
        super({});
        speechInstances.push(this);
      }
    } as unknown as WebSpeechRecognitionConstructor;
    const webkitSpeechRecognition = class extends MockRecognition {
      public constructor() {
        super({});
        webkitInstances.push(this);
      }
    } as unknown as WebSpeechRecognitionConstructor;

    const { provider } = createProvider({
      SpeechRecognition,
      webkitSpeechRecognition,
    });

    await provider.start(commandConfig());
    const availability = await provider.getAvailability(commandConfig());

    expect(availability).toMatchObject({
      supported: true,
      constructorName: "SpeechRecognition",
    });
    expect(speechInstances).toHaveLength(2);
    expect(webkitInstances).toHaveLength(0);
  });

  it("falls back to webkitSpeechRecognition when SpeechRecognition is unavailable", async () => {
    const webkitInstances: MockRecognition[] = [];

    const webkitSpeechRecognition = class extends MockRecognition {
      public constructor() {
        super({});
        webkitInstances.push(this);
      }
    } as unknown as WebSpeechRecognitionConstructor;

    const { provider } = createProvider({
      webkitSpeechRecognition,
    });

    await provider.start(commandConfig());
    const availability = await provider.getAvailability(commandConfig());

    expect(availability).toMatchObject({
      supported: true,
      constructorName: "webkitSpeechRecognition",
    });
    expect(webkitInstances).toHaveLength(2);
  });
  it("normalizes lifecycle and transcript events on the injected clock", async () => {
    const browser = createMockBrowser();
    const { provider, setNow } = createProvider(browser.scope);
    const events: SpeechProviderEvent[] = [];
    provider.subscribe((event) => events.push(event));
    await provider.start(commandConfig());
    const recognition = browser.instances[0];

    recognition.emitStart();
    recognition.emitAudioStart();
    recognition.emitSpeechStart();
    setNow(1_012);
    recognition.emitResult(createResultEvent(0, [createResult(" 이 문단에 ", false, 0.8)]));
    recognition.emitSpeechEnd();
    recognition.emitAudioEnd();
    recognition.emitEnd();

    expect(events.map((event) => event.type)).toEqual([
      "provider-start",
      "audio-start",
      "speech-start",
      "transcript",
      "speech-end",
      "audio-end",
      "provider-end",
    ]);
    expect(events[3]).toEqual({
      type: "transcript",
      at: 12,
      sessionId: "session-1",
      segmentId: "speech:session-1:result:0",
      segmentIndex: 0,
      text: "이 문단에",
      isFinal: false,
      confidence: 0.8,
    });
    expect(events.at(-1)).toMatchObject({
      type: "provider-end",
      sessionId: "session-1",
      intentional: false,
    });
  });

  it("starts at resultIndex, replaces interim, and emits each final index once", async () => {
    const browser = createMockBrowser();
    const { provider } = createProvider(browser.scope);
    const transcripts: Extract<SpeechProviderEvent, { type: "transcript" }>[] = [];
    provider.subscribe((event) => {
      if (event.type === "transcript") {
        transcripts.push(event);
      }
    });
    await provider.start(commandConfig());
    const recognition = browser.instances[0];

    recognition.emitResult(
      createResultEvent(1, [
        createResult("이전 확정", true),
        createResult("임시", false),
      ]),
    );
    recognition.emitResult(
      createResultEvent(1, [
        createResult("이전 확정", true),
        createResult("최종", true),
      ]),
    );
    recognition.emitResult(
      createResultEvent(1, [
        createResult("이전 확정", true),
        createResult("중복 최종", true),
      ]),
    );
    recognition.emitResult(
      createResultEvent(1, [
        createResult("이전 확정", true),
        createResult("역행 임시", false),
      ]),
    );

    expect(transcripts.map((event) => ({
      index: event.segmentIndex,
      text: event.text,
      final: event.isFinal,
    }))).toEqual([
      { index: 1, text: "임시", final: false },
      { index: 1, text: "최종", final: true },
    ]);
  });


  it("ignores out-of-range positive resultIndex and starts from 0 for negative", async () => {
    const browser = createMockBrowser();
    const { provider } = createProvider(browser.scope);
    const transcripts: Extract<SpeechProviderEvent, { type: "transcript" }>[] = [];
    provider.subscribe((event) => {
      if (event.type === "transcript") {
        transcripts.push(event);
      }
    });
    await provider.start(commandConfig());
    const recognition = browser.instances[0];

    recognition.emitResult(
      createResultEvent(4, [
        createResult("첫번째", false),
        createResult("두번째", true),
      ]),
    );
    recognition.emitResult(
      createResultEvent(-1, [
        createResult("재시작", false),
      ]),
    );

    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]).toMatchObject({
      sessionId: "session-1",
      segmentIndex: 0,
      text: "재시작",
      isFinal: false,
    });
  });
  it("ignores handlers retained from an ended previous session", async () => {
    const browser = createMockBrowser();
    const { provider } = createProvider(browser.scope);
    const events: SpeechProviderEvent[] = [];
    provider.subscribe((event) => events.push(event));
    await provider.start(commandConfig());
    const first = browser.instances[0];
    const lateResult = first.onresult;
    first.emitEnd();

    await provider.start(commandConfig());
    lateResult?.(createResultEvent(0, [createResult("늦은 이전 결과", true)]));
    browser.instances[1].emitResult(
      createResultEvent(0, [createResult("현재 결과", true)]),
    );

    const transcripts = events.filter((event) => event.type === "transcript");
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]).toMatchObject({
      sessionId: "session-2",
      text: "현재 결과",
    });
  });

  it("keeps stop, abort, intentional end, and unexpected end distinct", async () => {
    const browser = createMockBrowser();
    const { provider } = createProvider(browser.scope);
    const endEvents: Extract<SpeechProviderEvent, { type: "provider-end" }>[] = [];
    provider.subscribe((event) => {
      if (event.type === "provider-end") {
        endEvents.push(event);
      }
    });

    await provider.start(commandConfig());
    provider.stop();
    provider.stop();
    provider.abort();
    provider.abort();
    expect(browser.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(browser.instances[0].abort).toHaveBeenCalledTimes(1);
    browser.instances[0].emitEnd();

    await provider.start(commandConfig());
    browser.instances[1].emitEnd();

    expect(endEvents.map((event) => event.intentional)).toEqual([true, false]);
  });

  it("detaches handlers, aborts once, and ignores events after idempotent dispose", async () => {
    const browser = createMockBrowser();
    const { provider } = createProvider(browser.scope);
    const listener = vi.fn();
    provider.subscribe(listener);
    await provider.start(commandConfig());
    const recognition = browser.instances[0];
    const retainedStart = recognition.onstart;

    provider.dispose();
    provider.dispose();
    retainedStart?.({});

    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(recognition.onstart).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    await expect(provider.start(commandConfig())).rejects.toThrow("disposed");
  });

  it("ignores browser event timeStamp and uses injected clock for all provider events", async () => {
    const browser = createMockBrowser();
    const { provider, setNow } = createProvider(browser.scope);
    const events: SpeechProviderEvent[] = [];
    provider.subscribe((event) => events.push(event));

    await provider.start(commandConfig());
    const recognition = browser.instances[0];
    setNow(1_010);
    recognition.onstart?.({ timeStamp: 1_000_000 });
    setNow(1_020);
    recognition.onaudiostart?.({ timeStamp: 2_000_000 });
    setNow(1_030);
    recognition.onspeechstart?.({ timeStamp: 3_000_000 });
    setNow(1_040);
    recognition.emitResult(
      createResultEvent(
        0,
        [createResult("다음", true)],
        4_000_000,
      ),
    );
    setNow(1_050);
    recognition.onspeechend?.({ timeStamp: 5_000_000 });
    setNow(1_060);
    recognition.onaudioend?.({ timeStamp: 6_000_000 });
    setNow(1_070);
    recognition.onend?.({ timeStamp: 7_000_000 });

    expect(events.map((event) => event.at)).toEqual([
      10,
      20,
      30,
      40,
      50,
      60,
      70,
    ]);
    expect(events[3]).toMatchObject({
      type: "transcript",
      at: 40,
      sessionId: "session-1",
      segmentId: "speech:session-1:result:0",
      segmentIndex: 0,
      isFinal: true,
    });
  });

  it.each([
    ["not-allowed", false, "none"],
    ["service-not-allowed", false, "none"],
    ["audio-capture", false, "none"],
    ["no-speech", true, "restart-while-mode-active"],
    ["network", true, "restart-while-mode-active"],
    ["aborted", false, "none"],
    ["language-not-supported", false, "none"],
    ["phrases-not-supported", true, "restart-once"],
    ["something-new", false, "none"],
  ] as const)(
    "normalizes browser error %s",
    (rawCode, recoverable, retryPolicy) => {
      expect(normalizeWebSpeechRecognitionError(rawCode, "raw message")).toMatchObject({
        code: rawCode === "something-new" ? "unknown" : rawCode,
        recoverable,
        retryPolicy,
        rawCode,
        rawMessage: "raw message",
      });
    },
  );

  it("emits normalized browser errors without exposing the raw event", async () => {
    const browser = createMockBrowser();
    const { provider } = createProvider(browser.scope);
    const listener = vi.fn();
    provider.subscribe(listener);
    await provider.start(commandConfig());

    browser.instances[0].emitError("not-allowed", "permission denied");

    expect(listener).toHaveBeenCalledWith({
      type: "error",
      at: 0,
      sessionId: "session-1",
      error: {
        code: "not-allowed",
        message: "permission denied",
        recoverable: false,
        retryPolicy: "none",
        rawCode: "not-allowed",
        rawMessage: "permission denied",
      },
    });
  });

  it("uses supported contextual phrases and clamps their boosts", async () => {
    const browser = createMockBrowser({ phrases: true });
    const { provider } = createProvider(browser.scope);

    await provider.start(commandConfig({
      phrases: [
        { text: " 하이라이트 ", boost: 20 },
        { text: "하이라이트", boost: 2 },
        { text: "밑줄", boost: -1 },
      ],
    }));

    expect(browser.phraseValues).toEqual([
      { text: "하이라이트", boost: 10 },
      { text: "밑줄", boost: 0 },
    ]);
    expect(browser.instances[0].phrases).toHaveLength(2);
  });

  it("continues base recognition when contextual phrases are unsupported", async () => {
    const browser = createMockBrowser();
    const { provider } = createProvider(browser.scope);

    await provider.start(commandConfig({
      phrases: [{ text: "하이라이트", boost: 4 }],
    }));

    expect(browser.instances[0].start).toHaveBeenCalledTimes(1);
    expect(browser.instances[0].phrases).toBeUndefined();
  });

  it("enables available local recognition without installing packs", async () => {
    const browser = createMockBrowser({ local: true, localStatus: "available" });
    const { provider } = createProvider(browser.scope);

    await provider.start(commandConfig({ mode: "local-preferred" }));

    expect(browser.instances[0].processLocally).toBe(true);
  });

  it("rejects unavailable local-required mode without starting recognition", async () => {
    const browser = createMockBrowser({ local: true, localStatus: "unavailable" });
    const { provider } = createProvider(browser.scope);

    await expect(
      provider.start(commandConfig({ mode: "local-required" })),
    ).rejects.toMatchObject({
      detail: { code: "language-not-supported" },
    });
    expect(browser.instances[0].start).not.toHaveBeenCalled();
  });

  it("normalizes synchronous InvalidStateError from browser start", async () => {
    const invalidState = new Error("already started");
    invalidState.name = "InvalidStateError";
    const browser = createMockBrowser({ startError: invalidState });
    const { provider } = createProvider(browser.scope);
    const listener = vi.fn();
    provider.subscribe(listener);

    await expect(provider.start(commandConfig())).rejects.toBeInstanceOf(
      WebSpeechRecognitionStartError,
    );
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: "error",
      error: expect.objectContaining({ code: "invalid-state" }),
    }));
    expect(provider.activeSessionId).toBeUndefined();
  });
});
