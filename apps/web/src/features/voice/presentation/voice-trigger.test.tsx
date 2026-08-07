import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ActiveVoiceTurnSnapshot,
  VoiceTurnControllerState,
} from "../domain";
import { VoiceTrigger } from "./voice-trigger";

afterEach(cleanup);

const activeTurn: ActiveVoiceTurnSnapshot = {
  id: "turn-1",
  state: "capturing",
  providerId: "fake",
  providerSessionId: "session-1",
  language: "ko-KR",
  requestedAt: 0,
  startedAt: 10,
  transcript: {
    finalText: "",
    interimText: "",
    displayText: "",
    finalSegments: [],
  },
  frozenContext: {
    pageId: "page-1",
    sceneMode: "pdf",
    sceneRevision: 4,
    focusSource: "selection",
    focusStale: false,
    capturedAt: 10,
  },
  focusSnapshot: {
    source: "selection",
    capturedAt: 10,
    pageId: "page-1",
    sceneRevision: 4,
    stale: false,
  },
  scene: {
    sceneRevisionAtSpeechStart: 4,
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

function renderTrigger(
  state: VoiceTurnControllerState,
) {
  const actions = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    cancel: vi.fn(),
  };
  const rendered = render(
    <VoiceTrigger
      state={state}
      onStart={actions.start}
      onStop={actions.stop}
      onCancel={actions.cancel}
    />,
  );
  return { ...rendered, actions };
}

describe("VoiceTrigger", () => {
  it("starts from idle through a semantic button", () => {
    const { actions } = renderTrigger({ status: "idle" });
    const start = screen.getByRole("button", { name: "음성 입력 시작" });
    fireEvent.click(start);
    expect(actions.start).toHaveBeenCalledTimes(1);
  });

  it("offers stop and cancel while capturing", () => {
    const { actions } = renderTrigger({
      status: "capturing",
      turn: activeTurn,
    });
    fireEvent.click(screen.getByRole("button", { name: "음성 입력 중지" }));
    fireEvent.click(screen.getByRole("button", { name: "음성 입력 취소" }));
    expect(actions.stop).toHaveBeenCalledTimes(1);
    expect(actions.cancel).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate starts while starting or finalizing", () => {
    const starting = renderTrigger({
      status: "starting",
      providerId: "fake",
      requestedAt: 0,
      config: {
        lang: "ko-KR",
        continuous: true,
        interimResults: true,
        maxAlternatives: 1,
        mode: "browser-default",
        quality: "command",
        phrases: [],
      },
    });
    expect(
      screen.getByRole("button", { name: "음성 입력 준비 중" }),
    ).toBeDisabled();
    starting.unmount();

    renderTrigger({
      status: "finalizing",
      turn: { ...activeTurn, state: "finalizing" },
    });
    expect(
      screen.getByRole("button", { name: "인식 마무리 중" }),
    ).toBeDisabled();
  });

  it("supports retry after failure and disables unsupported browsers", () => {
    const failed = renderTrigger({
      status: "failed",
      error: { code: "network", recoverable: true },
      failedAt: 10,
      transcript: {
        finalText: "",
        interimText: "",
        displayText: "",
        finalSegments: [],
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "음성 입력 다시 시도" }),
    );
    expect(failed.actions.start).toHaveBeenCalledTimes(1);
    failed.unmount();

    renderTrigger({
      status: "unsupported",
      error: { code: "unsupported", recoverable: false },
    });
    expect(
      screen.getByRole("button", { name: "음성 입력 시작" }),
    ).toBeDisabled();
    expect(screen.getByText(/현재 브라우저에서는/)).toBeInTheDocument();
  });
});
