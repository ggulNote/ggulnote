import { describe, expect, it } from "vitest";
import type { VoiceTurnControllerState, VoiceTurnControllerError, VoiceTurnDiscardReason } from "../domain";
import { resolveVoiceTurnResultKind } from "./voice-debug-result-kind";

describe("resolveVoiceTurnResultKind", () => {
  it("returns Completed for completed state", () => {
    const state = {
      status: "completed",
      result: {
        id: "turn-completed",
        providerId: "web-speech",
        providerSessionId: "session-completed",
        language: "ko-KR",
        requestedAt: 1,
        startedAt: 2,
        state: "completed",
        rawTranscript: "테스트",
        finalSegments: [],
        frozenContext: {
          pageId: "page-1",
          sceneMode: "pdf",
          sceneRevision: 10,
          focusSource: "gaze",
          focusStale: false,
          capturedAt: 1,
        },
        focusSnapshot: {
          source: "gaze",
          capturedAt: 1,
          pageId: "page-1",
          sceneRevision: 10,
          stale: false,
        },
        scene: {
          sceneRevisionAtSpeechStart: 10,
          pageIdAtSpeechStart: "page-1",
          sceneChangedDuringTurn: false,
          pageChangedDuringTurn: false,
        },
        metrics: {
          interimUpdateCount: 0,
          finalSegmentCount: 0,
          providerRestartCount: 0,
        },
      },
    } as VoiceTurnControllerState;

    expect(resolveVoiceTurnResultKind(state)).toBe("Completed");
  });

  it("returns Discarded for discarded state", () => {
    const reason: VoiceTurnDiscardReason = "no-speech";
    const state = {
      status: "discarded",
      reason,
      record: {
        id: "turn-discarded",
        providerId: "web-speech",
        providerSessionId: "session-discarded",
        language: "ko-KR",
        requestedAt: 11,
        startedAt: 12,
        state: "discarded",
        rawTranscript: "",
        finalSegments: [],
        frozenContext: {
          pageId: "page-1",
          sceneMode: "pdf",
          sceneRevision: 11,
          focusSource: "gaze",
          focusStale: false,
          capturedAt: 11,
        },
        focusSnapshot: {
          source: "gaze",
          capturedAt: 11,
          pageId: "page-1",
          sceneRevision: 11,
          stale: false,
        },
        scene: {
          sceneRevisionAtSpeechStart: 11,
          pageIdAtSpeechStart: "page-1",
          sceneChangedDuringTurn: false,
          pageChangedDuringTurn: false,
        },
        metrics: {
          interimUpdateCount: 0,
          finalSegmentCount: 0,
          providerRestartCount: 0,
        },
      },
    } as VoiceTurnControllerState;

    expect(resolveVoiceTurnResultKind(state)).toBe("Discarded");
  });

  it("returns Failed for failed state", () => {
    const error: VoiceTurnControllerError = {
      code: "network",
      message: "voice api error",
      recoverable: true,
    };
    const state = {
      status: "failed",
      error,
      failedAt: 21,
      requestedAt: 20,
      turnId: "turn-failed",
      providerSessionId: "session-failed",
      transcript: {
        finalText: "",
        interimText: "",
        displayText: "",
        finalSegments: [],
      },
    } as VoiceTurnControllerState;

    expect(resolveVoiceTurnResultKind(state)).toBe("Failed");
  });
});
