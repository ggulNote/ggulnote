import { describe, expect, it } from "vitest";
import type { VoiceTurnControllerState } from "../domain";
import {
  readTranscriptFromState,
  toVoiceDebugErrorSnapshot,
  toVoiceDebugTurnSnapshot,
} from "./voice-debug-read-model";

describe("voice debug read model", () => {
  it("maps starting state and observed timestamps without inventing zero values", () => {
    const state: VoiceTurnControllerState = {
      status: "starting",
      providerId: "web-speech",
      requestedAt: 10,
      config: {
        lang: "ko-KR",
        continuous: true,
        interimResults: true,
        maxAlternatives: 1,
        mode: "browser-default",
        quality: "command",
        phrases: [],
      },
      providerSessionId: "session-1",
      recognitionStartedAt: 20,
    };

    expect(toVoiceDebugTurnSnapshot(state, { audioStartedAt: 30 })).toMatchObject({
      sessionId: "session-1",
      status: "starting",
      resultKind: "In Progress",
      requestedAt: 10,
      recognitionStartedAt: 20,
      audioStartedAt: 30,
    });
    expect(toVoiceDebugTurnSnapshot(state).completedAt).toBeUndefined();

    const unsupported: VoiceTurnControllerState = {
      status: "unsupported",
      error: { code: "unsupported", recoverable: false },
    };
    expect(toVoiceDebugTurnSnapshot(unsupported, { requestedAt: 40 }).requestedAt).toBe(40);
  });

  it("maps normalized and provider error metadata", () => {
    const state = {
      status: "failed",
      requestedAt: 10,
      failedAt: 30,
      turnId: "turn-1",
      providerSessionId: "session-1",
      transcript: {
        finalText: "",
        interimText: "부분",
        displayText: "부분",
        finalSegments: [],
      },
      error: {
        code: "network",
        recoverable: true,
        providerError: {
          code: "network",
          recoverable: true,
          retryPolicy: "restart-once",
        },
      },
    } satisfies VoiceTurnControllerState;

    expect(toVoiceDebugErrorSnapshot(state, 30, false)).toMatchObject({
      normalizedCode: "network",
      providerCode: "network",
      turnId: "turn-1",
      sessionId: "session-1",
      timestamp: 30,
      recoverable: true,
    });
    expect(readTranscriptFromState(state).interimText).toBe("부분");
    expect(toVoiceDebugErrorSnapshot(state, undefined, false)).not.toHaveProperty("timestamp");
  });
});
