import type {
  FrozenVoiceTurnContext,
  VoiceTurnControllerError,
  VoiceTurnControllerState,
} from "../domain";

export type VoiceLensState =
  | "hidden"
  | "listening"
  | "transcribing"
  | "finalizing"
  | "error";

export interface VoiceLensViewModel {
  state: VoiceLensState;
  turnId?: string;
  finalText: string;
  interimText: string;
  displayText: string;
  frozenContext?: FrozenVoiceTurnContext;
  errorMessage?: string;
}

const HIDDEN_LENS: VoiceLensViewModel = {
  state: "hidden",
  finalText: "",
  interimText: "",
  displayText: "",
};

export function createVoiceLensViewModel(
  state: VoiceTurnControllerState,
): VoiceLensViewModel {
  switch (state.status) {
    case "starting":
      return {
        state: "listening",
        finalText: "",
        interimText: "",
        displayText: "듣기 준비 중",
      };
    case "capturing":
      return fromActiveTurn(
        state.turn.transcript.displayText ? "transcribing" : "listening",
        state.turn,
      );
    case "finalizing":
      return fromActiveTurn("finalizing", state.turn);
    case "failed":
      return {
        state: "error",
        ...(state.turnId ? { turnId: state.turnId } : {}),
        finalText: state.transcript.finalText,
        interimText: state.transcript.interimText,
        displayText: "",
        ...(state.frozenContext
          ? { frozenContext: cloneFrozenContext(state.frozenContext) }
          : {}),
        errorMessage: getVoiceErrorMessage(state.error),
      };
    case "unsupported":
      return {
        state: "error",
        finalText: "",
        interimText: "",
        displayText: "",
        errorMessage: getVoiceErrorMessage(state.error),
      };
    case "idle":
    case "completed":
    case "discarded":
    case "cancelled":
      return { ...HIDDEN_LENS };
  }
}

export function getVoiceErrorMessage(
  error: VoiceTurnControllerError,
): string {
  switch (error.code) {
    case "not-allowed":
      return "마이크 권한을 허용해 주세요.";
    case "service-not-allowed":
      return "브라우저에서 음성 인식 서비스를 사용할 수 없습니다.";
    case "audio-capture":
      return "마이크를 사용할 수 없습니다.";
    case "no-speech":
      return "음성이 감지되지 않았습니다.";
    case "network":
      return "음성 인식 연결에 문제가 발생했습니다.";
    case "language-not-supported":
      return "현재 음성 언어를 사용할 수 없습니다.";
    case "unsupported":
      return "현재 브라우저에서는 음성 입력을 지원하지 않습니다.";
    case "aborted":
      return "음성 입력이 취소되었습니다.";
    case "context-capture-failed":
      return "현재 문서 위치를 확인할 수 없습니다.";
    case "provider-start-failed":
    case "invalid-state":
    case "phrases-not-supported":
    case "unknown":
      return "음성 입력 중 문제가 발생했습니다.";
  }
}

function fromActiveTurn(
  lensState: Exclude<VoiceLensState, "hidden" | "error">,
  turn: Extract<
    VoiceTurnControllerState,
    { status: "capturing" | "finalizing" }
  >["turn"],
): VoiceLensViewModel {
  return {
    state: lensState,
    turnId: turn.id,
    finalText: turn.transcript.finalText,
    interimText: turn.transcript.interimText,
    displayText: turn.transcript.displayText,
    frozenContext: cloneFrozenContext(turn.frozenContext),
  };
}

function cloneFrozenContext(
  context: FrozenVoiceTurnContext,
): FrozenVoiceTurnContext {
  return {
    ...context,
    ...(context.focusBounds
      ? { focusBounds: { ...context.focusBounds } }
      : {}),
  };
}
