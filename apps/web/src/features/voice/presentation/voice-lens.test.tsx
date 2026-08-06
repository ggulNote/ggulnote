import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ActiveVoiceTurnSnapshot,
  VoiceTurnControllerState,
} from "../domain";
import { VoiceLens } from "./voice-lens";
import { createVoiceLensViewModel } from "./voice-lens-model";

afterEach(cleanup);

const turn: ActiveVoiceTurnSnapshot = {
  id: "turn-1",
  state: "capturing",
  providerId: "fake",
  providerSessionId: "session-1",
  language: "ko-KR",
  requestedAt: 0,
  startedAt: 10,
  transcript: {
    finalText: "",
    interimText: "여기 밑줄 아니 밑줄 말고 노란색 하이라이트",
    displayText: "여기 밑줄 아니 밑줄 말고 노란색 하이라이트",
    finalSegments: [],
  },
  frozenContext: {
    pageId: "page-1",
    sceneMode: "pdf",
    sceneRevision: 12,
    focusObjectId: "paragraph-12",
    focusBounds: { x: 10, y: 20, width: 100, height: 40 },
    focusSource: "gaze",
    focusStale: false,
    capturedAt: 10,
  },
  focusSnapshot: {
    source: "gaze",
    capturedAt: 10,
    pageId: "page-1",
    sceneRevision: 12,
    objectId: "paragraph-12",
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    stale: false,
  },
  scene: {
    sceneRevisionAtSpeechStart: 12,
    pageIdAtSpeechStart: "page-1",
    sceneChangedDuringTurn: false,
    pageChangedDuringTurn: false,
  },
  metrics: {
    interimUpdateCount: 1,
    finalSegmentCount: 0,
    providerRestartCount: 0,
  },
};

const position = {
  x: 100,
  y: 120,
  placement: "right" as const,
  isFallback: false,
};

function renderState(state: VoiceTurnControllerState) {
  return render(
    <VoiceLens
      viewModel={createVoiceLensViewModel(state)}
      position={position}
    />,
  );
}

describe("VoiceLens", () => {
  it("renders starting, listening, raw interim, and finalizing feedback", () => {
    const starting = renderState({
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
    expect(screen.getByText("듣기 준비 중")).toBeInTheDocument();
    starting.unmount();

    const transcribing = renderState({ status: "capturing", turn });
    expect(
      screen.getByText("여기 밑줄 아니 밑줄 말고 노란색 하이라이트"),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-placement",
      "right",
    );
    expect(screen.getByRole("status")).toHaveClass("pointer-events-none");
    transcribing.unmount();

    renderState({
      status: "finalizing",
      turn: {
        ...turn,
        state: "finalizing",
        transcript: {
          ...turn.transcript,
          interimText: "",
          displayText: "",
        },
      },
    });
    expect(screen.getByText("인식 마무리 중")).toBeInTheDocument();
  });

  it.each([
    { status: "idle" as const },
    {
      status: "completed" as const,
      result: {
        id: "turn-1",
        providerId: "fake",
        providerSessionId: "session-1",
        language: "ko-KR",
        requestedAt: 0,
        startedAt: 10,
        state: "completed" as const,
        rawTranscript: "완료",
        finalSegments: [],
        frozenContext: turn.frozenContext,
        focusSnapshot: turn.focusSnapshot,
        scene: turn.scene,
        metrics: turn.metrics,
      },
    },
    { status: "discarded" as const, reason: "empty-transcript" as const },
    {
      status: "cancelled" as const,
      reason: "user" as const,
      requestedAt: 0,
      cancelledAt: 10,
      transcript: turn.transcript,
    },
  ])("removes the lens for $status", (state) => {
    renderState(state as VoiceTurnControllerState);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("maps failures and unsupported browsers to user-facing messages", () => {
    const failed = renderState({
      status: "failed",
      error: { code: "not-allowed", recoverable: false },
      failedAt: 10,
      transcript: turn.transcript,
    });
    expect(screen.getByText("마이크 권한을 허용해 주세요.")).toBeInTheDocument();
    failed.unmount();

    renderState({
      status: "unsupported",
      error: { code: "unsupported", recoverable: false },
    });
    expect(screen.getByText(/현재 브라우저에서는/)).toBeInTheDocument();
  });
});
