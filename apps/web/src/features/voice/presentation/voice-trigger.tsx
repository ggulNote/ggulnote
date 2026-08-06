import type { VoiceTurnControllerState } from "../domain";
import { getVoiceErrorMessage } from "./voice-lens-model";

export interface VoiceTriggerProps {
  state: VoiceTurnControllerState;
  disabled?: boolean;
  onStart: () => Promise<void> | void;
  onStop: () => void;
  onCancel: () => void;
}

export function VoiceTrigger({
  state,
  disabled = false,
  onStart,
  onStop,
  onCancel,
}: VoiceTriggerProps): React.ReactElement {
  const isStarting = state.status === "starting";
  const isCapturing = state.status === "capturing";
  const isFinalizing = state.status === "finalizing";
  const isActive = isStarting || isCapturing || isFinalizing;
  const isUnsupported = state.status === "unsupported";
  const isFailed = state.status === "failed";

  const primaryLabel = isCapturing
    ? "음성 입력 중지"
    : isStarting
      ? "음성 입력 준비 중"
      : isFinalizing
        ? "인식 마무리 중"
        : isFailed
          ? "음성 입력 다시 시도"
          : "음성 입력 시작";

  const statusText = (() => {
    if (isStarting) return "마이크를 준비하고 있습니다.";
    if (isCapturing) return "음성을 듣고 있습니다.";
    if (isFinalizing) return "인식을 마무리하고 있습니다.";
    if (state.status === "failed" || state.status === "unsupported") {
      return getVoiceErrorMessage(state.error);
    }
    return "음성 입력 대기 중";
  })();

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="음성 입력">
      <button
        type="button"
        aria-label={primaryLabel}
        disabled={
          disabled
          || isUnsupported
          || isStarting
          || isFinalizing
        }
        className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={() => {
          if (isCapturing) {
            onStop();
            return;
          }
          void onStart();
        }}
      >
        <span aria-hidden="true">🎙</span>{" "}
        {primaryLabel}
      </button>

      {isActive ? (
        <button
          type="button"
          aria-label="음성 입력 취소"
          className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={onCancel}
        >
          취소
        </button>
      ) : null}

      <span className="text-xs text-slate-600" aria-live="polite">
        {statusText}
      </span>
    </div>
  );
}
