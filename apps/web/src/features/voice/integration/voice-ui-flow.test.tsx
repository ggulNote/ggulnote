import { toSessionTimeMs } from "@ggulnote/interaction-core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceTurnController } from "../application";
import { FakeVoiceTurnContextSource } from "../application/testing/fake-voice-turn-context-source";
import { FakeSpeechRecognitionProvider } from "../providers/testing/fake-speech-recognition-provider";
import { VoiceLensOverlay } from "./voice-lens-overlay";
import { VoiceTriggerControl } from "./voice-trigger-control";

let frameSequence = 0;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameSequence += 1;
    queueMicrotask(() => callback(frameSequence));
    return frameSequence;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function createHarness() {
  let now = 0;
  const clock = { now: () => toSessionTimeMs(now) };
  const provider = new FakeSpeechRecognitionProvider({
    clock,
    createSessionId: () => "session-1",
  });
  const context = new FakeVoiceTurnContextSource({
    frozenContext: {
      pageId: "page-1",
      sceneMode: "pdf",
      sceneRevision: 12,
      focusObjectId: "paragraph-12",
      focusBounds: { x: 100, y: 200, width: 200, height: 80 },
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
      bounds: { x: 100, y: 200, width: 200, height: 80 },
      stale: false,
    },
  });
  const controller = new VoiceTurnController({
    provider,
    contextSource: context,
    clock,
    createTurnId: () => "turn-1",
  });
  const pageElement = document.createElement("div");
  vi.spyOn(pageElement, "getBoundingClientRect").mockReturnValue(
    createDomRect(100, 160, 500, 700),
  );
  const toolbarElement = document.createElement("div");
  vi.spyOn(toolbarElement, "getBoundingClientRect").mockReturnValue(
    createDomRect(0, 0, 1_000, 120),
  );
  return {
    controller,
    provider,
    context,
    pageElement,
    toolbarElement,
    setNow: (value: number) => { now = value; },
  };
}

function Harness({
  controller,
  pageElement,
  toolbarElement,
  currentPageId = "page-1",
}: ReturnType<typeof createHarness> & {
  currentPageId?: string;
}): React.ReactElement {
  return (
    <>
      <VoiceTriggerControl controller={controller} />
      <VoiceLensOverlay
        controller={controller}
        currentPage={{ id: currentPageId, width: 1_000, height: 1_400 }}
        pageElement={pageElement}
        toolbarElement={toolbarElement}
      />
    </>
  );
}

describe("voice UI flow", () => {
  it("drives the real controller with a fake provider and preserves raw interim text", async () => {
    const harness = createHarness();
    render(<Harness {...harness} />);

    fireEvent.click(screen.getByRole("button", { name: "음성 입력 시작" }));
    await waitFor(() => expect(harness.provider.startCallCount).toBe(1));
    expect(screen.getByText("듣기 준비 중")).toBeInTheDocument();

    act(() => {
      harness.provider.emitSpeechStart({ at: 10 });
      harness.provider.emitInterim(
        0,
        "여기 밑줄 아니 밑줄 말고 노란색 하이라이트",
        { at: 20 },
      );
    });
    expect(
      screen.getByText("여기 밑줄 아니 밑줄 말고 노란색 하이라이트"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveAttribute(
        "data-fallback",
        "false",
      );
    });

    harness.context.setCapture({
      frozenContext: {
        pageId: "page-1",
        sceneMode: "pdf",
        sceneRevision: 13,
        focusObjectId: "paragraph-19",
        focusBounds: { x: 700, y: 700, width: 100, height: 40 },
        focusSource: "gaze",
        focusStale: false,
        capturedAt: 30,
      },
      focusSnapshot: {
        source: "gaze",
        capturedAt: 30,
        pageId: "page-1",
        sceneRevision: 13,
        objectId: "paragraph-19",
        bounds: { x: 700, y: 700, width: 100, height: 40 },
        stale: false,
      },
    });
    expect(harness.controller.getFrozenContext()).toMatchObject({
      focusObjectId: "paragraph-12",
      sceneRevision: 12,
    });

    act(() => {
      harness.provider.emitSpeechEnd({ at: 30 });
    });
    expect(screen.getByLabelText("음성 인식 마무리")).toBeInTheDocument();
    act(() => {
      harness.provider.emitFinal(0, "최종 원문", { at: 35 });
      harness.setNow(40);
      harness.provider.emitProviderEnd({ at: 40 });
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    harness.controller.dispose();
  });

  it("removes the lens immediately on cancel without a completed result", async () => {
    const harness = createHarness();
    render(<Harness {...harness} />);
    fireEvent.click(screen.getByRole("button", { name: "음성 입력 시작" }));
    await waitFor(() => expect(harness.provider.startCallCount).toBe(1));
    act(() => {
      harness.provider.emitSpeechStart({ at: 10 });
    });
    fireEvent.click(screen.getByRole("button", { name: "음성 입력 취소" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(harness.provider.abortCallCount).toBe(1);
    expect(harness.controller.getCompletedTurn()).toBeUndefined();
    harness.controller.dispose();
  });

  it("recalculates on zoom and falls back without re-anchoring after a page change", async () => {
    const harness = createHarness();
    const rendered = render(<Harness {...harness} />);
    fireEvent.click(screen.getByRole("button", { name: "음성 입력 시작" }));
    await waitFor(() => expect(harness.provider.startCallCount).toBe(1));
    act(() => {
      harness.provider.emitSpeechStart({ at: 10 });
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveAttribute(
        "data-fallback",
        "false",
      );
    });
    const initialLeft = screen.getByRole("status").style.left;

    vi.mocked(harness.pageElement.getBoundingClientRect).mockReturnValue(
      createDomRect(100, 160, 700, 980),
    );
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await waitFor(() => {
      expect(screen.getByRole("status").style.left).not.toBe(initialLeft);
    });
    expect(harness.controller.getFrozenContext()?.focusBounds).toEqual({
      x: 100,
      y: 200,
      width: 200,
      height: 80,
    });

    rendered.rerender(<Harness {...harness} currentPageId="page-2" />);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveAttribute(
        "data-fallback",
        "true",
      );
    });
    expect(harness.controller.getFrozenContext()?.pageId).toBe("page-1");
    harness.controller.dispose();
  });

  it("keeps listening feedback at fallback position when focus is absent", async () => {
    const harness = createHarness();
    harness.context.setCapture({
      frozenContext: {
        pageId: "page-1",
        sceneMode: "blank",
        sceneRevision: 20,
        focusSource: "none",
        focusStale: false,
        capturedAt: 10,
      },
      focusSnapshot: {
        source: "none",
        capturedAt: 10,
        pageId: "page-1",
        sceneRevision: 20,
        stale: false,
      },
    });
    render(<Harness {...harness} />);
    fireEvent.click(screen.getByRole("button", { name: "음성 입력 시작" }));
    await waitFor(() => expect(harness.provider.startCallCount).toBe(1));
    act(() => {
      harness.provider.emitSpeechStart({ at: 10 });
    });
    expect(screen.getByText("듣고 있어요")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveAttribute(
        "data-fallback",
        "true",
      );
    });
    harness.controller.dispose();
  });
});

function createDomRect(
  x: number,
  y: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON: () => ({}),
  };
}
