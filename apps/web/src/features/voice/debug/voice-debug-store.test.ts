import { describe, expect, it } from "vitest";
import { DEFAULT_COMMAND_RECOGNITION_CONFIG } from "../domain";
import { VoiceDebugStore } from "./voice-debug-store";
import { createVoiceDebugRuntime } from "./voice-debug-runtime";

function createStore() {
  return new VoiceDebugStore({
    providerId: "test-provider",
    config: DEFAULT_COMMAND_RECOGNITION_CONFIG,
    api: {
      speechRecognition: true,
      webkitSpeechRecognition: false,
    },
  });
}

describe("VoiceDebugStore", () => {
  it("uses monotonic sequence ordering and caps the event timeline", () => {
    const store = createStore();

    for (let index = 1; index <= 205; index += 1) {
      store.diagnostics.onProviderEvent?.({
        type: "audio-start",
        at: 10,
        sessionId: index % 2 === 0 ? "session-even" : "session-odd",
      });
    }

    const snapshot = store.getSnapshot();
    const events = snapshot.events;
    expect(events).toHaveLength(200);
    expect(events[0]?.sequence).toBe(6);
    expect(events[events.length - 1]?.sequence).toBe(205);
    expect(events.every((event) => event.timestamp === 10)).toBe(true);
    expect(events[0]?.id).toBe("voice-debug-event-6");
    expect(new Set(events.map((event) => event.sessionId))).toEqual(
      new Set(["session-even", "session-odd"]),
    );
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(events[0])).toBe(true);
  });

  it("clears events without resetting the stable sequence", () => {
    const store = createStore();
    store.diagnostics.onControlEvent?.({ type: "turn-requested", at: 1 });
    store.clearEvents();
    store.diagnostics.onControlEvent?.({ type: "turn-requested", at: 2 });

    expect(store.getSnapshot().events).toEqual([
      expect.objectContaining({
        id: "voice-debug-event-2",
        sequence: 2,
        timestamp: 2,
      }),
    ]);
  });

  it("keeps diagnostics failures isolated from callers", () => {
    const store = createStore();
    const unsubscribe = store.subscribe(() => {
      throw new Error("debug subscriber failed");
    });

    expect(() => {
      store.diagnostics.onControlEvent?.({ type: "turn-requested", at: 1 });
    }).not.toThrow();

    unsubscribe();
  });
});

describe("VoiceDebugRuntime fake provider integration", () => {
  it("runs the happy path through the actual VoiceTurnController", async () => {
    const runtime = createVoiceDebugRuntime("fake");

    await runtime.runScenario("happy-path");

    const snapshot = runtime.getSnapshot();
    expect(snapshot.turn.resultKind).toBe("Completed");
    expect(snapshot.transcript.rawFinal).toBe("이 문단에 노란색 하이라이트");
    expect(snapshot.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "TURN_REQUESTED",
      "PROVIDER_START",
      "SPEECH_START",
      "CONTEXT_FROZEN",
      "TRANSCRIPT_INTERIM",
      "TRANSCRIPT_FINAL",
      "PROVIDER_END",
      "TURN_COMPLETED",
    ]));
    expect(snapshot.recentTurns).toHaveLength(1);

    runtime.dispose();
  });

  it("preserves self-correction raw text and supports controller cancellation", async () => {
    const runtime = createVoiceDebugRuntime("fake");

    await runtime.runScenario("self-correction");
    expect(runtime.getSnapshot().transcript.rawFinal).toBe(
      "여기 밑줄 아니 밑줄 말고 노란색 하이라이트",
    );

    await runtime.runScenario("cancel");
    const snapshot = runtime.getSnapshot();
    expect(snapshot.turn.resultKind).toBe("Cancelled");
    expect(snapshot.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "CANCEL_REQUESTED",
      "PROVIDER_ABORT",
      "TURN_CANCELLED",
    ]));

    runtime.dispose();
  });

  it("exposes normalized provider errors without raw browser events", async () => {
    const runtime = createVoiceDebugRuntime("fake");

    await runtime.runScenario("error-permission");

    expect(runtime.getSnapshot().error).toMatchObject({
      normalizedCode: "not-allowed",
      providerCode: "not-allowed",
      recoverable: false,
      intentionalAbort: false,
    });
    expect(runtime.getSnapshot().turn.resultKind).toBe("Failed");

    runtime.dispose();
  });
});
