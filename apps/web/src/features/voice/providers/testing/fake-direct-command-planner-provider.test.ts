import { describe, expect, it } from "vitest";
import {
  DIRECT_COMMAND_NAMES,
  type DirectCommandPlannerInput,
  type DirectPlannerResult,
} from "../../domain";
import { FakeDirectCommandPlannerProvider } from "./fake-direct-command-planner-provider";

const EXECUTABLE_RESULT = {
  status: "EXECUTABLE",
  planId: "plan-1",
  turnId: "turn-1",
  sceneRevision: 4,
  normalizedIntent: "현재 포커스에 밑줄",
  relation: "NEW",
  command: {
    capability: "annotation",
    operation: "underline",
    target: { kind: "FROZEN_FOCUS" },
    payload: {},
  },
} satisfies DirectPlannerResult;

function createInput(): DirectCommandPlannerInput {
  return {
    turn: {
      turnId: "turn-1",
      language: "ko-KR",
      rawFinalTranscript: "여기 밑줄 쳐줘",
    },
    frozenContext: {
      pageId: "document-1-page-1",
      sceneMode: "pdf",
      sceneRevision: 4,
      focusSource: "selection",
      focusStale: false,
      capturedAt: 100,
      focus: {
        ref: "FROZEN_FOCUS",
        objectId: "pdf:line-1",
        kind: "line",
        source: "pdf",
        text: "중요한 문장",
        editable: false,
        annotatable: true,
        bounds: { x: 10, y: 20, width: 100, height: 16 },
      },
    },
    allowedCommands: DIRECT_COMMAND_NAMES,
  };
}

describe("FakeDirectCommandPlannerProvider", () => {
  it("returns a fixed result and records isolated input snapshots", async () => {
    const provider = new FakeDirectCommandPlannerProvider({
      result: EXECUTABLE_RESULT,
    });
    const input = createInput();
    const planned = provider.plan(input);
    input.turn.rawFinalTranscript = "변경된 입력";

    await expect(planned).resolves.toEqual(EXECUTABLE_RESULT);
    expect(provider.planCallCount).toBe(1);
    expect(provider.lastInput?.turn.rawFinalTranscript).toBe("여기 밑줄 쳐줘");

    const calls = provider.calls;
    calls[0].input.turn.rawFinalTranscript = "외부 변경";
    expect(provider.lastInput?.turn.rawFinalTranscript).toBe("여기 밑줄 쳐줘");
  });

  it("injects and clears planner errors", async () => {
    const provider = new FakeDirectCommandPlannerProvider({
      result: EXECUTABLE_RESULT,
    });
    const error = new Error("planner unavailable");

    provider.injectError(error);
    await expect(provider.plan(createInput())).rejects.toBe(error);

    provider.clearError();
    await expect(provider.plan(createInput())).resolves.toEqual(EXECUTABLE_RESULT);
    expect(provider.planCallCount).toBe(2);
  });

  it("observes pre-aborted and in-flight AbortSignals", async () => {
    const provider = new FakeDirectCommandPlannerProvider({
      result: EXECUTABLE_RESULT,
    });
    const preAborted = new AbortController();
    preAborted.abort();

    await expect(
      provider.plan(createInput(), { signal: preAborted.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const inFlight = new AbortController();
    const pending = provider.plan(createInput(), { signal: inFlight.signal });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    inFlight.abort();
    await rejection;

    expect(provider.planCallCount).toBe(2);
    expect(provider.calls[1].signal).toBe(inFlight.signal);
  });
});
