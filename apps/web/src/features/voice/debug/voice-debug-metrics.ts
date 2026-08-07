import type {
  ActiveVoiceTurnSnapshot,
  VoiceTurnControllerState,
  VoiceTurnRecord,
} from "../domain";
import type { VoiceDebugMetrics } from "./voice-debug-types";

export interface VoiceDebugTimestampInput {
  requestedAt?: number;
  recognitionStartedAt?: number;
  audioStartedAt?: number;
  startedAt?: number;
  speechStartedAt?: number;
  speechEndedAt?: number;
  firstInterimAt?: number;
  firstFinalAt?: number;
  providerEndedAt?: number;
  completedAt?: number;
}

export function toVoiceDebugMetrics(input: VoiceDebugTimestampInput): VoiceDebugMetrics {
  const speechStartedAt = input.speechStartedAt ?? input.startedAt;
  return {
    recognitionStartup: safeDuration(input.requestedAt, input.recognitionStartedAt),
    audioReady: safeDuration(input.requestedAt, input.audioStartedAt),
    speechFirstInterim: safeDuration(speechStartedAt, input.firstInterimAt),
    speechFirstFinal: safeDuration(speechStartedAt, input.firstFinalAt),
    speechEndFirstFinal: safeDuration(input.speechEndedAt, input.firstFinalAt),
    speechEndFinal: safeDuration(input.speechEndedAt, input.completedAt),
    finalAfterSpeechEnd: positiveOnly(input.speechEndedAt, input.firstFinalAt),
    providerEnd: safeDuration(input.speechEndedAt, input.providerEndedAt),
    totalTurn: safeDuration(input.requestedAt, input.completedAt),
  };
}

export function resolveVoiceDebugMetricsFromState(
  state: VoiceTurnControllerState,
): VoiceDebugMetrics {
  switch (state.status) {
    case "completed":
      return toVoiceDebugMetrics(state.result);
    case "discarded":
      return state.record ? toVoiceDebugMetrics(state.record) : emptyMetrics();
    case "starting":
      return toVoiceDebugMetrics({
        requestedAt: state.requestedAt,
        recognitionStartedAt: state.recognitionStartedAt,
        audioStartedAt: state.audioStartedAt,
      });
    case "capturing":
    case "finalizing":
      return toVoiceDebugMetrics(state.turn);
    case "failed":
    case "cancelled":
    case "unsupported":
    case "idle":
      return emptyMetrics();
  }
}

export function toVoiceDebugMetricsFromRecord(record: VoiceTurnRecord): VoiceDebugMetrics {
  return toVoiceDebugMetrics(record);
}

export function toVoiceDebugMetricsFromTurn(turn: ActiveVoiceTurnSnapshot): VoiceDebugMetrics {
  return toVoiceDebugMetrics(turn);
}

function emptyMetrics(): VoiceDebugMetrics {
  return {
    recognitionStartup: null,
    audioReady: null,
    speechFirstInterim: null,
    speechFirstFinal: null,
    speechEndFirstFinal: null,
    speechEndFinal: null,
    finalAfterSpeechEnd: null,
    providerEnd: null,
    totalTurn: null,
  };
}

function safeDuration(start: number | undefined, end: number | undefined): number | null {
  if (start === undefined || end === undefined) {
    return null;
  }
  const value = end - start;
  return value >= 0 ? value : null;
}

function positiveOnly(start: number | undefined, end: number | undefined): number | null {
  const value = safeDuration(start, end);
  return value !== null && value > 0 ? value : null;
}
