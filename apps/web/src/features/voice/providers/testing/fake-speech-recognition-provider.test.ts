import { InteractionClock } from "@ggulnote/interaction-core";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMMAND_RECOGNITION_CONFIG } from "../../domain";
import { FakeSpeechRecognitionProvider } from "./fake-speech-recognition-provider";

function createProvider(
  createSessionId: () => string = () => "session-1",
): {
  provider: FakeSpeechRecognitionProvider;
  setNow: (value: number) => void;
} {
  let now = 1_000;
  const clock = new InteractionClock(() => now);
  const provider = new FakeSpeechRecognitionProvider({ clock, createSessionId });

  return {
    provider,
    setNow: (value) => {
      now = value;
    },
  };
}

describe("FakeSpeechRecognitionProvider", () => {
  it("records config, creates one session, and rejects duplicate start", async () => {
    const { provider } = createProvider();
    const config = {
      ...DEFAULT_COMMAND_RECOGNITION_CONFIG,
      phrases: [{ text: "하이라이트", boost: 3 }],
    };

    await provider.start(config);
    config.phrases[0].text = "밑줄";

    expect(provider.activeSessionId).toBe("session-1");
    expect(provider.startCallCount).toBe(1);
    expect(provider.lastConfig?.phrases[0].text).toBe("하이라이트");
    await expect(provider.start(config)).rejects.toThrow("already active");
    expect(provider.startCallCount).toBe(1);
  });

  it("emits normalized events on the injected InteractionClock", async () => {
    const { provider, setNow } = createProvider();
    const listener = vi.fn();
    provider.subscribe(listener);
    await provider.start(DEFAULT_COMMAND_RECOGNITION_CONFIG);

    provider.emitProviderStart();
    provider.emitAudioStart({ at: 3 });
    provider.emitSpeechStart({ at: 4 });
    provider.emitInterim(0, "이 문단에", { at: 5, confidence: 0.8 });
    provider.emitFinal(0, "이 문단에 밑줄", { at: 6 });
    provider.emitSpeechEnd({ at: 7 });
    provider.emitAudioEnd({ at: 8 });
    setNow(1_009);
    provider.emitProviderEnd({ intentional: false });

    expect(listener.mock.calls.map(([event]) => event.type)).toEqual([
      "provider-start",
      "audio-start",
      "speech-start",
      "transcript",
      "transcript",
      "speech-end",
      "audio-end",
      "provider-end",
    ]);
    expect(listener.mock.calls[0][0]).toEqual({
      type: "provider-start",
      at: 0,
      sessionId: "session-1",
    });
    expect(listener.mock.calls[3][0]).toEqual({
      type: "transcript",
      at: 5,
      sessionId: "session-1",
      segmentId: "speech:session-1:result:0",
      segmentIndex: 0,
      text: "이 문단에",
      isFinal: false,
      confidence: 0.8,
    });
    expect(listener.mock.calls.at(-1)?.[0]).toMatchObject({ at: 9, intentional: false });
  });

  it("keeps stop and abort distinct and idempotent", async () => {
    const { provider } = createProvider();
    const listener = vi.fn();
    provider.subscribe(listener);
    await provider.start(DEFAULT_COMMAND_RECOGNITION_CONFIG);

    provider.stop();
    provider.stop();
    provider.abort();
    provider.abort();
    provider.emitProviderEnd();

    expect(provider.stopCallCount).toBe(1);
    expect(provider.abortCallCount).toBe(1);
    expect(listener).toHaveBeenLastCalledWith({
      type: "provider-end",
      at: 0,
      sessionId: "session-1",
      intentional: true,
    });
    expect(provider.activeSessionId).toBeUndefined();
  });

  it("supports controlled session ids and late previous-session events", async () => {
    const ids = ["session-1", "session-2"];
    const { provider } = createProvider(() => ids.shift() ?? "unexpected");
    const events: string[] = [];
    provider.subscribe((event) => events.push(event.sessionId));

    await provider.start(DEFAULT_COMMAND_RECOGNITION_CONFIG);
    provider.emitProviderEnd({ intentional: false });
    await provider.start(DEFAULT_COMMAND_RECOGNITION_CONFIG);
    provider.emitFinal(0, "늦은 결과", { sessionId: "session-1" });
    provider.emitSpeechStart();

    expect(provider.activeSessionId).toBe("session-2");
    expect(events).toEqual(["session-1", "session-1", "session-2"]);
  });

  it("returns isolated availability snapshots", async () => {
    const { provider } = createProvider();
    const availability = await provider.getAvailability(DEFAULT_COMMAND_RECOGNITION_CONFIG);
    availability.local.status = "available";

    await expect(provider.getAvailability(DEFAULT_COMMAND_RECOGNITION_CONFIG)).resolves.toEqual({
      supported: true,
      constructorName: "SpeechRecognition",
      local: { supported: false, status: "unknown" },
      contextualBiasingSupported: false,
    });
  });

  it("unsubscribes and ignores events after idempotent dispose", async () => {
    const { provider } = createProvider();
    const listener = vi.fn();
    const unsubscribe = provider.subscribe(listener);
    await provider.start(DEFAULT_COMMAND_RECOGNITION_CONFIG);
    unsubscribe();
    provider.emitSpeechStart();
    expect(listener).not.toHaveBeenCalled();

    provider.subscribe(listener);
    provider.dispose();
    provider.dispose();
    provider.emit({
      type: "provider-start",
      at: 1,
      sessionId: "session-1",
    });

    expect(listener).not.toHaveBeenCalled();
    expect(provider.activeSessionId).toBeUndefined();
    await expect(provider.start(DEFAULT_COMMAND_RECOGNITION_CONFIG)).rejects.toThrow("disposed");
  });

  it("emits normalized errors without browser event objects", async () => {
    const { provider } = createProvider();
    const listener = vi.fn();
    provider.subscribe(listener);
    await provider.start(DEFAULT_COMMAND_RECOGNITION_CONFIG);

    provider.emitError({
      code: "not-allowed",
      message: "permission denied",
      recoverable: false,
      retryPolicy: "none",
    });

    expect(listener).toHaveBeenCalledWith({
      type: "error",
      at: 0,
      sessionId: "session-1",
      error: {
        code: "not-allowed",
        message: "permission denied",
        recoverable: false,
        retryPolicy: "none",
      },
    });
  });
});
