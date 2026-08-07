import type {
  ActiveVoiceTurnSnapshot,
  FrozenVoiceTurnContext,
  VoiceFocusSnapshot,
  VoiceTurnControllerState,
  VoiceTurnRecord,
} from "../domain";
import { describe, expect, it } from "vitest";
import {
  resolveVoiceDebugMetricsFromState,
  toVoiceDebugMetrics,
} from "./voice-debug-metrics";

const frozenContext: FrozenVoiceTurnContext = {
  pageId: "page-1",
  sceneMode: "pdf",
  sceneRevision: 812,
  focusSource: "gaze",
  focusObjectId: "paragraph-12",
  focusStale: false,
  capturedAt: 20,
};

const focusSnapshot: VoiceFocusSnapshot = {
  source: "gaze",
  capturedAt: 20,
  pageId: "page-1",
  sceneRevision: 812,
  stale: false,
};

const transcript = {
  finalText: "",
  interimText: "",
  displayText: "",
  finalSegments: [],
};

describe("toVoiceDebugMetrics", () => {
  it("calculates latency metrics from phase C timestamps", () => {
    expect(toVoiceDebugMetrics({
      requestedAt: 10,
      recognitionStartedAt: 20,
      audioStartedAt: 30,
      startedAt: 40,
      firstInterimAt: 50,
      firstFinalAt: 190,
      speechEndedAt: 160,
      providerEndedAt: 180,
      completedAt: 210,
    })).toEqual({
      recognitionStartup: 10,
      audioReady: 20,
      speechFirstInterim: 10,
      speechFirstFinal: 150,
      speechEndFirstFinal: 30,
      speechEndFinal: 50,
      finalAfterSpeechEnd: 30,
      providerEnd: 20,
      totalTurn: 200,
    });
  });

  it("uses startedAt as speech-start fallback", () => {
    expect(toVoiceDebugMetrics({
      requestedAt: 10,
      startedAt: 40,
      firstInterimAt: 51,
      firstFinalAt: 55,
    })).toMatchObject({
      speechFirstInterim: 11,
      speechFirstFinal: 15,
    });
  });

  it("returns null for missing and reversed timestamps", () => {
    expect(toVoiceDebugMetrics({
      requestedAt: 10,
      recognitionStartedAt: 5,
      speechEndedAt: 20,
      firstFinalAt: 10,
      completedAt: 9,
      providerEndedAt: 10,
      firstInterimAt: 15,
    })).toMatchObject({
      recognitionStartup: null,
      audioReady: null,
      speechFirstInterim: null,
      speechFirstFinal: null,
      speechEndFirstFinal: null,
      speechEndFinal: null,
      finalAfterSpeechEnd: null,
      providerEnd: null,
      totalTurn: null,
    });
  });
});

describe("resolveVoiceDebugMetricsFromState", () => {
  it("uses active turn snapshot for capturing state", () => {
    const turn: ActiveVoiceTurnSnapshot = {
      id: "turn-1",
      state: "capturing",
      providerId: "web-speech",
      providerSessionId: "session-1",
      language: "ko-KR",
      requestedAt: 10,
      startedAt: 40,
      transcript,
      frozenContext,
      focusSnapshot,
      scene: {
        sceneRevisionAtSpeechStart: 812,
        pageIdAtSpeechStart: "page-1",
        sceneChangedDuringTurn: false,
        pageChangedDuringTurn: false,
      },
      metrics: {
        interimUpdateCount: 0,
        finalSegmentCount: 0,
        providerRestartCount: 0,
      },
    };

    const state: VoiceTurnControllerState = {
      status: "capturing",
      turn,
    };

    expect(resolveVoiceDebugMetricsFromState(state).speechFirstInterim).toBeNull();

    const nextState: VoiceTurnControllerState = {
      ...state,
      turn: {
        ...turn,
        firstInterimAt: 52,
        firstFinalAt: 58,
      },
    };

    expect(resolveVoiceDebugMetricsFromState(nextState).speechFirstInterim).toBe(12);
    expect(resolveVoiceDebugMetricsFromState(nextState).speechFirstFinal).toBe(18);
    expect(resolveVoiceDebugMetricsFromState(nextState).speechEndFirstFinal).toBeNull();
  });

  it("uses completion timestamps from completed records", () => {
    const result: VoiceTurnRecord = {
      id: "turn-1",
      providerId: "web-speech",
      providerSessionId: "session-1",
      language: "ko-KR",
      requestedAt: 5,
      recognitionStartedAt: 8,
      audioStartedAt: 12,
      startedAt: 20,
      firstInterimAt: 25,
      firstFinalAt: 35,
      speechEndedAt: 45,
      providerEndedAt: 60,
      completedAt: 70,
      state: "completed",
      rawTranscript: "안내",
      finalSegments: [{ id: "seg-1", index: 0, text: "안내" }],
      frozenContext,
      focusSnapshot,
      scene: {
        sceneRevisionAtSpeechStart: 812,
        pageIdAtSpeechStart: "page-1",
        sceneChangedDuringTurn: false,
        pageChangedDuringTurn: false,
      },
      metrics: {
        interimUpdateCount: 0,
        finalSegmentCount: 1,
        providerRestartCount: 0,
      },
    };

    const state: VoiceTurnControllerState = {
      status: "completed",
      result: result,
    };

    expect(resolveVoiceDebugMetricsFromState(state).totalTurn).toBe(65);
  });

  it("returns empty metrics for terminal states without debug timestamps", () => {
    const state: VoiceTurnControllerState = {
      status: "failed",
      error: {
        code: "network",
        recoverable: true,
      },
      failedAt: 200,
      transcript,
    };

    expect(resolveVoiceDebugMetricsFromState(state)).toEqual({
      recognitionStartup: null,
      audioReady: null,
      speechFirstInterim: null,
      speechFirstFinal: null,
      speechEndFirstFinal: null,
      speechEndFinal: null,
      finalAfterSpeechEnd: null,
      providerEnd: null,
      totalTurn: null,
    });
  });
});
