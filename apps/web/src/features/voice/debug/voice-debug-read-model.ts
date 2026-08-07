import type {
  CompletedVoiceTurn,
  TranscriptAccumulatorSnapshot,
  VoiceTurnControllerError,
  VoiceTurnControllerState,
  VoiceTurnRecord,
} from "../domain";
import { toVoiceDebugContextSnapshot } from "./voice-debug-context";
import { resolveVoiceTurnResultKind } from "./voice-debug-result-kind";
import type {
  VoiceDebugErrorSnapshot,
  VoiceDebugRecentTurnRecord,
  VoiceDebugTurnSnapshot,
} from "./voice-debug-types";

export interface VoiceDebugObservedTimes {
  requestedAt?: number;
  recognitionStartedAt?: number;
  audioStartedAt?: number;
  speechEndedAt?: number;
  providerEndedAt?: number;
  stopRequestedAt?: number;
  cancelRequestedAt?: number;
  firstInterimAt?: number;
  firstFinalAt?: number;
  completedAt?: number;
}

export function toVoiceDebugTurnSnapshot(
  state: VoiceTurnControllerState,
  observed: VoiceDebugObservedTimes = {},
): VoiceDebugTurnSnapshot {
  const snapshot: VoiceDebugTurnSnapshot = {
    status: state.status,
    resultKind: resolveVoiceTurnResultKind(state),
  };
  const turn = state.status === "capturing" || state.status === "finalizing"
    ? state.turn
    : undefined;
  const record = readRecord(state);

  assign(snapshot, "turnId", turn?.id ?? record?.id ?? readTerminalTurnId(state));
  assign(
    snapshot,
    "sessionId",
    turn?.providerSessionId ?? record?.providerSessionId ?? readTerminalSessionId(state),
  );
  assign(snapshot, "requestedAt", turn?.requestedAt ?? record?.requestedAt ?? readRequestedAt(state) ?? observed.requestedAt);
  assign(
    snapshot,
    "recognitionStartedAt",
    turn?.recognitionStartedAt ?? record?.recognitionStartedAt ?? readStartingTime(state, "recognitionStartedAt")
      ?? observed.recognitionStartedAt,
  );
  assign(
    snapshot,
    "audioStartedAt",
    turn?.audioStartedAt ?? record?.audioStartedAt ?? readStartingTime(state, "audioStartedAt")
      ?? observed.audioStartedAt,
  );
  assign(snapshot, "speechStartedAt", turn?.startedAt ?? record?.startedAt);
  assign(snapshot, "speechEndedAt", turn?.speechEndedAt ?? record?.speechEndedAt ?? observed.speechEndedAt);
  assign(snapshot, "providerEndedAt", record?.providerEndedAt ?? observed.providerEndedAt);
  assign(snapshot, "completedAt", record?.completedAt ?? readTerminalCompletedAt(state) ?? observed.completedAt);
  assign(snapshot, "stopRequestedAt", turn?.stopRequestedAt ?? record?.stopRequestedAt ?? observed.stopRequestedAt);
  assign(snapshot, "cancelRequestedAt", observed.cancelRequestedAt);
  assign(snapshot, "firstInterimAt", turn?.firstInterimAt ?? record?.firstInterimAt ?? observed.firstInterimAt);
  assign(snapshot, "firstFinalAt", turn?.firstFinalAt ?? record?.firstFinalAt ?? observed.firstFinalAt);

  return snapshot;
}

export function readTranscriptFromState(
  state: VoiceTurnControllerState,
): TranscriptAccumulatorSnapshot {
  if (state.status === "capturing" || state.status === "finalizing") {
    return state.turn.transcript;
  }
  if (state.status === "completed") return transcriptFromRecord(state.result);
  if (state.status === "discarded" && state.record) return transcriptFromRecord(state.record);
  if (state.status === "cancelled" || state.status === "failed") return state.transcript;
  return { finalText: "", interimText: "", displayText: "", finalSegments: [] };
}

export function readFrozenContextFromState(state: VoiceTurnControllerState) {
  if (state.status === "capturing" || state.status === "finalizing") {
    return toVoiceDebugContextSnapshot(state.turn.frozenContext);
  }
  if (state.status === "completed") return toVoiceDebugContextSnapshot(state.result.frozenContext);
  if (state.status === "discarded" && state.record) {
    return toVoiceDebugContextSnapshot(state.record.frozenContext);
  }
  if ((state.status === "cancelled" || state.status === "failed") && state.frozenContext) {
    return toVoiceDebugContextSnapshot(state.frozenContext);
  }
  return undefined;
}

export function readCompletedTurn(
  state: VoiceTurnControllerState,
): CompletedVoiceTurn | undefined {
  return state.status === "completed"
    ? { ...state.result, state: "completed" }
    : undefined;
}

export function toVoiceDebugErrorSnapshot(
  state: VoiceTurnControllerState,
  timestamp: number | undefined,
  intentionalAbort: boolean,
): VoiceDebugErrorSnapshot | undefined {
  if (state.status !== "failed" && state.status !== "unsupported") return undefined;
  const error = state.error;
  const result: VoiceDebugErrorSnapshot = {
    normalizedCode: error.code,
    recoverable: error.recoverable,
    intentionalAbort,
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(error.providerError?.code ? { providerCode: error.providerError.code } : {}),
    ...(state.status === "failed" && state.providerSessionId
      ? { sessionId: state.providerSessionId }
      : {}),
    ...(state.status === "failed" && state.turnId ? { turnId: state.turnId } : {}),
    ...(error.message ? { message: error.message } : {}),
  };
  return result;
}

export function toVoiceDebugRecentTurn(
  state: VoiceTurnControllerState,
  timestamp: number,
): VoiceDebugRecentTurnRecord | undefined {
  const kind = resolveVoiceTurnResultKind(state);
  if (kind === "Idle" || kind === "In Progress" || kind === "Unsupported") return undefined;
  const record = readRecord(state);
  const turnId = record?.id ?? readTerminalTurnId(state);
  if (!turnId) return undefined;
  const transcript = readTranscriptFromState(state);
  const requestedAt = record?.requestedAt ?? readRequestedAt(state) ?? timestamp;
  const completedAt = record?.completedAt ?? readTerminalCompletedAt(state);
  const frozen = readFrozenContextFromState(state);
  const error = readControllerError(state);
  return {
    turnId,
    resultKind: kind,
    status: kind,
    transcript: transcript.finalText || transcript.interimText,
    requestedAt,
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(frozen ? { frozenContext: frozen } : {}),
    ...(record ? { metrics: { ...record.metrics } } : {}),
    ...(error ? { error: { ...error } } : {}),
  };
}

export function readRecord(state: VoiceTurnControllerState): VoiceTurnRecord | undefined {
  if (state.status === "completed") return state.result;
  if (state.status === "discarded") return state.record;
  return undefined;
}

function transcriptFromRecord(record: VoiceTurnRecord): TranscriptAccumulatorSnapshot {
  return {
    finalText: record.rawTranscript,
    interimText: "",
    displayText: record.rawTranscript,
    finalSegments: record.finalSegments.map((segment) => ({ ...segment })),
  };
}

function readTerminalTurnId(state: VoiceTurnControllerState): string | undefined {
  return state.status === "cancelled" || state.status === "failed" ? state.turnId : undefined;
}

function readTerminalSessionId(state: VoiceTurnControllerState): string | undefined {
  if (state.status === "starting") return state.providerSessionId;
  return state.status === "cancelled" || state.status === "failed"
    ? state.providerSessionId
    : undefined;
}

function readRequestedAt(state: VoiceTurnControllerState): number | undefined {
  if (state.status === "starting") return state.requestedAt;
  if (state.status === "cancelled") return state.requestedAt;
  if (state.status === "failed") return state.requestedAt;
  return undefined;
}

function readStartingTime(
  state: VoiceTurnControllerState,
  key: "recognitionStartedAt" | "audioStartedAt",
): number | undefined {
  return state.status === "starting" ? state[key] : undefined;
}

function readTerminalCompletedAt(state: VoiceTurnControllerState): number | undefined {
  if (state.status === "cancelled") return state.cancelledAt;
  if (state.status === "failed") return state.failedAt;
  return undefined;
}

function readControllerError(
  state: VoiceTurnControllerState,
): VoiceTurnControllerError | undefined {
  return state.status === "failed" || state.status === "unsupported"
    ? state.error
    : undefined;
}

function assign<K extends keyof VoiceDebugTurnSnapshot>(
  target: VoiceDebugTurnSnapshot,
  key: K,
  value: VoiceDebugTurnSnapshot[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}
