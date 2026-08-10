import { toSessionTimeMs } from "@ggulnote/interaction-core";
import { describe, expect, it, vi } from "vitest";
import {
  VoiceTurnController,
} from "../application";
import { FakeVoiceTurnContextSource } from "../application/testing/fake-voice-turn-context-source";
import type {
  DirectCommandRouteResult,
} from "../domain";
import { FakeSpeechRecognitionProvider } from "../providers/testing/fake-speech-recognition-provider";
import {
  DirectCommandVoiceTurnBridge,
  type CompletedVoiceTurnRoute,
} from "./direct-command-voice-turn-bridge";

function createHarness(route: CompletedVoiceTurnRoute) {
  let now = 0;
  let turnSequence = 0;
  const clock = { now: () => toSessionTimeMs(now) };
  const provider = new FakeSpeechRecognitionProvider({ clock });
  const context = new FakeVoiceTurnContextSource({
    frozenContext: {
      pageId: "page-1",
      sceneMode: "pdf",
      sceneRevision: 7,
      focusObjectId: "pdf:line:1",
      focusBounds: { x: 10, y: 20, width: 100, height: 20 },
      focusSource: "selection",
      focusStale: false,
      capturedAt: 1,
    },
    focusSnapshot: {
      source: "selection",
      capturedAt: 1,
      pageId: "page-1",
      sceneRevision: 7,
      objectId: "pdf:line:1",
      bounds: { x: 10, y: 20, width: 100, height: 20 },
      stale: false,
    },
  });
  const controller = new VoiceTurnController({
    provider,
    contextSource: context,
    clock,
    createTurnId: () => `turn-${++turnSequence}`,
  });
  const bridge = new DirectCommandVoiceTurnBridge({ controller, route });
  return {
    bridge,
    controller,
    provider,
    setNow(value: number) {
      now = value;
    },
  };
}

async function completeTurn(
  harness: ReturnType<typeof createHarness>,
  transcript: string,
): Promise<void> {
  await harness.controller.start();
  harness.provider.emitSpeechStart({ at: 1 });
  for (let index = 0; index < 10; index += 1) {
    harness.provider.emitInterim(0, transcript.slice(0, index + 1), {
      at: 2 + index,
    });
  }
  harness.provider.emitFinal(0, transcript, { at: 20 });
  harness.setNow(21);
  harness.provider.emitProviderEnd({ at: 21 });
  await Promise.resolve();
}

describe("DirectCommandVoiceTurnBridge", () => {
  it("passes ten interim updates and one completed turn to the route exactly once", async () => {
    const execute = vi.fn(async (turn): Promise<DirectCommandRouteResult> => ({
      status: "CANCELLED",
      turnId: turn.id,
    }));
    const harness = createHarness({ execute });

    await completeTurn(harness, "여기 밑줄 쳐줘");

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      state: "completed",
      rawTranscript: "여기 밑줄 쳐줘",
      frozenContext: {
        pageId: "page-1",
        sceneRevision: 7,
        focusObjectId: "pdf:line:1",
      },
    });
    harness.bridge.dispose();
    harness.controller.dispose();
  });

  it("does not execute discarded no-speech or cancelled turns", async () => {
    const execute = vi.fn(async (turn): Promise<DirectCommandRouteResult> => ({
      status: "CANCELLED",
      turnId: turn.id,
    }));
    const harness = createHarness({ execute });

    await harness.controller.start();
    harness.provider.emitProviderEnd({ at: 1 });
    await harness.controller.start();
    harness.provider.emitSpeechStart({ at: 2 });
    harness.controller.cancel();
    await Promise.resolve();

    expect(execute).not.toHaveBeenCalled();
    harness.bridge.dispose();
    harness.controller.dispose();
  });

  it("aborts an in-flight route and prevents delivery after dispose", async () => {
    let aborted = false;
    const execute = vi.fn((_turn, options) =>
      new Promise<DirectCommandRouteResult>((resolve) => {
        options?.signal?.addEventListener("abort", () => {
          aborted = true;
          resolve({
            status: "ERROR",
            turnId: "turn-1",
            errorCode: "ABORTED",
          });
        }, { once: true });
      }),
    );
    const harness = createHarness({ execute });

    await completeTurn(harness, "여기 밑줄 쳐줘");
    harness.bridge.dispose();
    await Promise.resolve();

    expect(aborted).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    harness.controller.dispose();
  });

  it("continues delivering later completed turns after a route failure", async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error("planner timeout"))
      .mockResolvedValueOnce({
        status: "CANCELLED",
        turnId: "turn-2",
      } satisfies DirectCommandRouteResult);
    const harness = createHarness({ execute });

    await completeTurn(harness, "첫 번째 명령");
    await completeTurn(harness, "두 번째 명령");

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map((call) => call[0].id)).toEqual([
      "turn-1",
      "turn-2",
    ]);
    harness.bridge.dispose();
    harness.controller.dispose();
  });
});
