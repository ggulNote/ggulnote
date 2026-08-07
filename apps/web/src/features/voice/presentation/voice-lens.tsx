import type { VoiceLensPosition } from "./voice-lens-position";
import type { VoiceLensViewModel } from "./voice-lens-model";

export interface VoiceLensProps {
  viewModel: VoiceLensViewModel;
  position: VoiceLensPosition | null;
  lensRef?: (element: HTMLDivElement | null) => void;
}

export function VoiceLens({
  viewModel,
  position,
  lensRef,
}: VoiceLensProps): React.ReactElement | null {
  if (viewModel.state === "hidden") return null;

  const content = (() => {
    if (viewModel.state === "error") {
      return viewModel.errorMessage ?? "음성 입력 중 문제가 발생했습니다.";
    }
    if (viewModel.state === "finalizing") {
      return viewModel.displayText || "인식 마무리 중";
    }
    if (viewModel.state === "listening") {
      return viewModel.displayText || "듣고 있어요";
    }
    return viewModel.displayText || "듣고 있어요";
  })();

  const stateLabel = viewModel.state === "error"
    ? "음성 입력 오류"
    : viewModel.state === "finalizing"
      ? "음성 인식 마무리"
      : "음성 인식 중";

  return (
    <div
      ref={lensRef}
      role="status"
      aria-live="polite"
      aria-label={stateLabel}
      data-placement={position?.placement ?? "pending"}
      data-fallback={position?.isFallback ? "true" : "false"}
      className={[
        "pointer-events-none fixed z-40 max-h-24 w-[min(22rem,calc(100vw-2rem))]",
        "overflow-hidden rounded-xl border px-4 py-3 text-sm",
        "shadow-[0_6px_24px_rgba(15,23,42,0.08)] ring-1 backdrop-blur-[2px] backdrop-saturate-150",
        "transition-[left,top,opacity] duration-150 motion-reduce:transition-none",
        viewModel.state === "error"
          ? "border-red-400/35 bg-red-50/20 text-red-950 ring-red-900/10"
          : "border-white/60 bg-white/15 text-slate-950 ring-slate-900/10",
      ].join(" ")}
      style={{
        left: position ? position.x + "px" : "1rem",
        top: position ? position.y + "px" : "1rem",
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="shrink-0">
          🎙
        </span>
        <span className="min-w-0 overflow-hidden break-words">
          {content}
        </span>
      </div>
    </div>
  );
}
