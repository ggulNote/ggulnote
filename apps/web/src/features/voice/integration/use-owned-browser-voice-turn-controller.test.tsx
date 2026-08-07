import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useOwnedBrowserVoiceTurnController } from "./use-owned-browser-voice-turn-controller";

afterEach(cleanup);

describe("useOwnedBrowserVoiceTurnController", () => {
  it("survives Strict Mode effect replay without auto-starting or disposing", async () => {
    const { result, unmount } = renderHook(
      () => useOwnedBrowserVoiceTurnController(() => {
        throw new Error("Context is not read before speech-start.");
      }),
      { wrapper: StrictMode },
    );

    expect(result.current.getState().status).toBe("idle");
    await act(async () => {
      await Promise.resolve();
      await result.current.start();
    });
    expect(result.current.getState().status).toBe("unsupported");
    unmount();
    await act(async () => Promise.resolve());
  });
});
