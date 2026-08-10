import { EditorEngine } from "@ggulnote/editor-core";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { CompletedVoiceTurn } from "../domain";
import { useOwnedBrowserDirectCommandComposition } from "./use-owned-browser-direct-command-composition";

afterEach(cleanup);

const TURN: CompletedVoiceTurn = {
  id: "turn-after-unmount",
  providerId: "fake",
  providerSessionId: "session-1",
  language: "ko-KR",
  requestedAt: 0,
  startedAt: 1,
  completedAt: 2,
  state: "completed",
  rawTranscript: "여기 밑줄",
  finalSegments: [{ id: "segment-1", index: 0, text: "여기 밑줄" }],
  frozenContext: {
    pageId: "page-1",
    sceneMode: "pdf",
    sceneRevision: 1,
    focusSource: "none",
    focusStale: false,
    capturedAt: 1,
  },
  focusSnapshot: {
    source: "none",
    capturedAt: 1,
    pageId: "page-1",
    sceneRevision: 1,
    stale: false,
  },
  scene: {
    sceneRevisionAtSpeechStart: 1,
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

describe("useOwnedBrowserDirectCommandComposition", () => {
  it("keeps one session composition through Strict Mode and disposes route on unmount", async () => {
    const editorEngine = new EditorEngine();
    const { result, rerender, unmount } = renderHook(
      () => useOwnedBrowserDirectCommandComposition({
        editorEngine,
        readCurrentVoiceContext: () => {
          throw new Error("Context is not read before speech-start.");
        },
        readCurrentGroundingSnapshot: () => undefined,
        getCurrentSceneRevision: () => 1,
        getCurrentPage: () => 1,
        goToPage: () => undefined,
      }),
      { wrapper: StrictMode },
    );
    const initial = result.current;

    rerender();
    expect(result.current).toBe(initial);
    expect(result.current.voice.controller.getState().status).toBe("idle");

    unmount();
    await act(async () => Promise.resolve());

    await expect(initial.direct.route.execute(TURN)).resolves.toEqual({
      status: "ERROR",
      turnId: TURN.id,
      errorCode: "ABORTED",
    });
  });
});
