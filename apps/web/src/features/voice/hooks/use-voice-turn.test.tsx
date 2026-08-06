import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VoiceTurnControllerState } from "../domain";
import {
  useVoiceTurn,
  type VoiceTurnControllerPort,
} from "./use-voice-turn";

afterEach(cleanup);

class FakeVoiceTurnController implements VoiceTurnControllerPort {
  private listeners = new Set<(state: VoiceTurnControllerState) => void>();
  private state: VoiceTurnControllerState = { status: "idle" };
  public readonly start = vi.fn(async () => undefined);
  public readonly stop = vi.fn();
  public readonly cancel = vi.fn();
  public subscribeCount = 0;
  public unsubscribeCount = 0;

  public getState(): VoiceTurnControllerState {
    return this.state;
  }

  public subscribe(
    listener: (state: VoiceTurnControllerState) => void,
  ): () => void {
    this.subscribeCount += 1;
    this.listeners.add(listener);
    return () => {
      this.unsubscribeCount += 1;
      this.listeners.delete(listener);
    };
  }

  public emit(state: VoiceTurnControllerState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener(state);
  }
}

describe("useVoiceTurn", () => {
  it("reflects controller state and forwards user actions", async () => {
    const controller = new FakeVoiceTurnController();
    const { result } = renderHook(() => useVoiceTurn(controller));
    expect(result.current.state.status).toBe("idle");

    act(() => {
      controller.emit({
        status: "unsupported",
        error: { code: "unsupported", recoverable: false },
      });
    });
    expect(result.current.state.status).toBe("unsupported");

    await act(async () => result.current.start());
    act(() => result.current.stop());
    act(() => result.current.cancel());
    expect(controller.start).toHaveBeenCalledTimes(1);
    expect(controller.stop).toHaveBeenCalledTimes(1);
    expect(controller.cancel).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes without disposing or auto-starting in Strict Mode", () => {
    const controller = new FakeVoiceTurnController();
    const { unmount } = renderHook(
      () => useVoiceTurn(controller),
      { wrapper: StrictMode },
    );

    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.subscribeCount).toBeGreaterThan(0);
    unmount();
    expect(controller.unsubscribeCount).toBe(controller.subscribeCount);
  });

  it("switches subscriptions when the controller instance changes", () => {
    const first = new FakeVoiceTurnController();
    const second = new FakeVoiceTurnController();
    const { result, rerender } = renderHook(
      ({ controller }) => useVoiceTurn(controller),
      { initialProps: { controller: first as VoiceTurnControllerPort } },
    );

    rerender({ controller: second });
    act(() => {
      first.emit({
        status: "unsupported",
        error: { code: "unsupported", recoverable: false },
      });
    });
    expect(result.current.state.status).toBe("idle");
    expect(first.unsubscribeCount).toBe(1);
    expect(second.subscribeCount).toBe(1);
  });
});
