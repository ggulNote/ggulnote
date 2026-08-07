import { InteractionClock } from "@ggulnote/interaction-core";
import { describe, expect, it } from "vitest";
import type { SpeechProviderEvent, SpeechProviderErrorCode } from "../domain";
import { DEFAULT_COMMAND_RECOGNITION_CONFIG } from "../domain";
import { FakeSpeechRecognitionProvider } from "../providers/testing/fake-speech-recognition-provider";
import { runFakeVoiceScenario } from "./fake-provider-scenarios";

type ErrorScenario = {
  scenario: "error-permission" | "error-no-speech" | "error-network";
  code: SpeechProviderErrorCode;
  recoverable: boolean;
};

function createFakeProvider() {
  let now = 1_000;
  const clock = new InteractionClock(() => now);
  const provider = new FakeSpeechRecognitionProvider({
    clock,
    createSessionId: () => "session-1",
  });

  return {
    provider,
  };
}

describe("runFakeVoiceScenario", () => {
  it("plays happy path with expected event sequence and timestamp mapping", async () => {
    const { provider } = createFakeProvider();
    const events: SpeechProviderEvent[] = [];
    provider.subscribe((event) => {
      events.push(event);
    });

    const playback = runFakeVoiceScenario(provider, "happy-path", {
      baseAt: 2_000,
      delayMs: 0,
    });

    await playback.done;

    expect(playback.isRunning()).toBe(false);
    expect(events.map((event) => event.type)).toEqual([
      "provider-start",
      "audio-start",
      "speech-start",
      "transcript",
      "transcript",
      "speech-end",
      "audio-end",
      "provider-end",
    ]);
    expect(events[0]).toMatchObject({ type: "provider-start", at: 2_000, sessionId: "session-1" });
    expect(events[3]).toMatchObject({ type: "transcript", at: 2_035, segmentId: "debug:interim:1" });
    expect(events[events.length - 1]).toMatchObject({ type: "provider-end", at: 2_115, intentional: false });
  });

  it("supports self-correction with multiple interim updates and one final transcript", async () => {
    const { provider } = createFakeProvider();
    const events: SpeechProviderEvent[] = [];
    provider.subscribe((event) => events.push(event));

    await runFakeVoiceScenario(provider, "self-correction", { baseAt: 5_000 }).done;

    const transcripts = events.filter((event): event is Extract<SpeechProviderEvent, { type: "transcript" }> =>
      event.type === "transcript",
    );

    expect(transcripts).toHaveLength(5);
    expect(transcripts.map((event) => event.text)).toEqual([
      "여기 밑줄",
      "여기 밑줄 아니",
      "여기 밑줄 아니 밑줄 말고",
      "여기 밑줄 아니 밑줄 말고 노란색",
      "여기 밑줄 아니 밑줄 말고 노란색 하이라이트",
    ]);
    expect(transcripts.slice(0, -1).every((transcript) => !transcript.isFinal)).toBe(true);
    expect(transcripts[transcripts.length - 1]?.isFinal).toBe(true);
  });

  it("emits expected error metadata for debug error scenarios", async () => {
    const scenarios: ErrorScenario[] = [
      {
        scenario: "error-permission",
        code: "not-allowed",
        recoverable: false,
      },
      {
        scenario: "error-no-speech",
        code: "no-speech",
        recoverable: true,
      },
      {
        scenario: "error-network",
        code: "network",
        recoverable: true,
      },
    ];

    for (const entry of scenarios) {
      const { provider } = createFakeProvider();
      const events: SpeechProviderEvent[] = [];
      provider.subscribe((event) => {
        events.push(event);
      });

      await runFakeVoiceScenario(provider, entry.scenario, {
        baseAt: 4_000,
        config: {
          ...DEFAULT_COMMAND_RECOGNITION_CONFIG,
          phrases: [{ text: "테스트", boost: 2 }],
        },
        delayMs: 0,
      }).done;

      const errorEvent = events.find((event) => event.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent).toMatchObject({
        type: "error",
        error: {
          code: entry.code,
          recoverable: entry.recoverable,
        },
      });

      expect(events[events.length - 1]).toMatchObject({
        type: "provider-end",
        intentional: false,
      });
    }
  });

  it("marks cancel as intentional end and forwards abort intent", async () => {
    const { provider } = createFakeProvider();
    const events: SpeechProviderEvent[] = [];
    provider.subscribe((event) => events.push(event));

    await runFakeVoiceScenario(provider, "cancel", {
      baseAt: 3_000,
      delayMs: 0,
    }).done;

    expect(events.map((event) => event.type)).toContain("provider-end");
    expect(events[events.length - 1]).toMatchObject({
      type: "provider-end",
      at: 3_060,
      intentional: true,
    });
    expect(provider.abortCallCount).toBe(1);
  });
});
