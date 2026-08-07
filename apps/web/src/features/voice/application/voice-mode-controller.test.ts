import { describe, expect, it, vi } from "vitest";
import type { VoiceTurnControllerState } from "../domain";
import type { SpeechProviderError } from "../domain";
import { VoiceModeControllerImpl } from "./voice-mode-controller";

type RetryPolicy = SpeechProviderError["retryPolicy"];

class FakeScheduler {
  private callbacks = new Map<number, () => void>();
  private nextHandle = 0;

  public setTimeout(callback: () => void, _delayMs: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  public clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as number);
  }

  public flush(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback());
  }
}

class FakeVoiceTurnController {
  private listeners = new Set<(state: VoiceTurnControllerState) => void>();
  private state: VoiceTurnControllerState = { status: "idle" };
  public readonly start = vi.fn(async () => undefined);
  public readonly stop = vi.fn();
  public readonly cancel = vi.fn();

  public getState(): VoiceTurnControllerState {
    return this.state;
  }

  public subscribe(listener: (state: VoiceTurnControllerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public emit(state: VoiceTurnControllerState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      listener(state);
    }
  }
}

function toTurnState(value: object): VoiceTurnControllerState {
  return value as VoiceTurnControllerState;
}

const transcriptSnapshot = {
  finalText: "",
  interimText: "",
  displayText: "",
  finalSegments: [],
};

function createStartingState(sessionId: string): VoiceTurnControllerState {
  return toTurnState({
    status: "starting",
    providerId: "test-provider",
    requestedAt: 1,
    config: {
      lang: "ko-KR",
      maxAlternatives: 1,
      interimResults: true,
      continuous: true,
      mode: "normal",
      phrases: [],
      quality: "accurate",
      processLocally: false,
      contextualBiasingSupported: false,
      contextualBiasingSupportedLocally: false,
      contextualBiasingSupportedLocalStatus: "unknown",
      processLocallySupported: false,
      processLocallySupportedLocally: false,
      webkitFallback: false,
    },
    providerSessionId: sessionId,
  });
}

function createCapturingState(sessionId: string): VoiceTurnControllerState {
  return toTurnState({
    status: "capturing",
    turn: {
      id: "turn-1",
      state: "capturing",
      providerId: "test-provider",
      providerSessionId: sessionId,
      language: "ko-KR",
      requestedAt: 1,
      startedAt: 2,
      transcript: transcriptSnapshot,
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
        finalSegmentCount: 0,
        providerRestartCount: 0,
      },
    },
  });
}

function createCompletedState(sessionId: string): VoiceTurnControllerState {
  return toTurnState({
    status: "completed",
    result: {
      id: "turn-1",
      providerId: "test-provider",
      providerSessionId: sessionId,
      language: "ko-KR",
      requestedAt: 1,
      startedAt: 2,
      state: "completed",
      rawTranscript: "확인",
      finalSegments: [],
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
        finalSegmentCount: 0,
        providerRestartCount: 0,
      },
    },
  });
}

function createFailedState(
  code: SpeechProviderError["code"],
  retryPolicy: RetryPolicy,
): VoiceTurnControllerState {
  return toTurnState({
    status: "failed",
    error: {
      code: "provider-start-failed",
      recoverable: retryPolicy !== "none",
      providerError: {
        code,
        recoverable: retryPolicy !== "none",
        retryPolicy,
      },
    },
    requestedAt: 1,
    failedAt: 2,
    transcript: transcriptSnapshot,
    providerSessionId: "session-1",
  });
}

function createPermissionDeniedState(): VoiceTurnControllerState {
  return toTurnState({
    status: "failed",
    error: {
      code: "not-allowed",
      recoverable: false,
      providerError: {
        code: "not-allowed",
        recoverable: false,
        retryPolicy: "none",
      },
    },
    requestedAt: 1,
    failedAt: 2,
    transcript: transcriptSnapshot,
    providerSessionId: "session-1",
  });
}

function createUnsupportedState(): VoiceTurnControllerState {
  return toTurnState({
    status: "unsupported",
    error: {
      code: "unsupported",
      recoverable: false,
      providerError: {
        code: "unsupported",
        recoverable: false,
        retryPolicy: "none",
      },
    },
  });
}

describe("VoiceModeControllerImpl", () => {
  it("start delegates to enable", async () => {
    const turnController = new FakeVoiceTurnController();
    const controller = new VoiceModeControllerImpl({ turnController });

    await controller.start();

    expect(turnController.start).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ state: "starting", enabled: true });
  });

  it("stop disables mode and blocks a terminal-state restart", async () => {
    const turnController = new FakeVoiceTurnController();
    const scheduler = new FakeScheduler();
    const controller = new VoiceModeControllerImpl({ turnController, scheduler });

    await controller.start();
    controller.stop();
    turnController.emit(createCompletedState("session-1"));
    scheduler.flush();

    expect(turnController.stop).toHaveBeenCalledTimes(1);
    expect(turnController.start).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ state: "off", enabled: false });
  });

  it("cancel disables mode and blocks a terminal-state restart", async () => {
    const turnController = new FakeVoiceTurnController();
    const scheduler = new FakeScheduler();
    const controller = new VoiceModeControllerImpl({ turnController, scheduler });

    await controller.start();
    controller.cancel();
    turnController.emit(toTurnState({
      status: "cancelled",
      reason: "user-cancel",
      cancelledAt: 2,
      providerSessionId: "session-1",
    }));
    scheduler.flush();

    expect(turnController.cancel).toHaveBeenCalledTimes(1);
    expect(turnController.start).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ state: "off", enabled: false });
  });
  it("ignores duplicate enable calls and starts turn once", async () => {
    const turnController = new FakeVoiceTurnController();
    const controller = new VoiceModeControllerImpl({ turnController, maxRecoverableRestarts: 0 });

    await controller.enable();
    await controller.enable();

    expect(turnController.start).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ state: "starting", enabled: true });
  });

  it("transitions to ready and schedules next turn when completed", async () => {
    const turnController = new FakeVoiceTurnController();
    const scheduler = new FakeScheduler();
    const controller = new VoiceModeControllerImpl({
      turnController,
      restartBackoffMs: 0,
      scheduler,
      maxRecoverableRestarts: 1,
    });

    await controller.enable();
    turnController.emit(createStartingState("session-1"));
    turnController.emit(createCapturingState("session-1"));
    expect(controller.getState()).toMatchObject({ state: "speech-active", enabled: true });

    turnController.emit(createCompletedState("session-1"));
    expect(controller.getState()).toMatchObject({ state: "ready", enabled: true, restartCount: 0 });

    scheduler.flush();
    expect(turnController.start).toHaveBeenCalledTimes(2);
  });

  it("retries recoverable failures within limit and stops at cap", async () => {
    const turnController = new FakeVoiceTurnController();
    const scheduler = new FakeScheduler();
    const controller = new VoiceModeControllerImpl({
      turnController,
      restartBackoffMs: 0,
      scheduler,
      maxRecoverableRestarts: 1,
    });

    await controller.enable();
    turnController.emit(createStartingState("session-1"));
    turnController.emit(createCapturingState("session-1"));
    turnController.emit(createFailedState("network", "restart-while-mode-active"));

    expect(controller.getState()).toMatchObject({ state: "recovering", restartCount: 1 });

    scheduler.flush();
    expect(turnController.start).toHaveBeenCalledTimes(2);

    turnController.emit(createFailedState("network", "restart-while-mode-active"));
    expect(controller.getState()).toMatchObject({ state: "error", restartCount: 0 });
    expect(turnController.start).toHaveBeenCalledTimes(2);
  });

  it("does not restart after disable", async () => {
    const turnController = new FakeVoiceTurnController();
    const scheduler = new FakeScheduler();
    const controller = new VoiceModeControllerImpl({
      turnController,
      restartBackoffMs: 0,
      scheduler,
    });

    await controller.enable();
    turnController.emit(createStartingState("session-1"));
    turnController.emit(createCapturingState("session-1"));
    turnController.emit(createFailedState("network", "restart-while-mode-active"));
    expect(controller.getState().state).toBe("recovering");

    controller.disable();
    expect(controller.getState()).toMatchObject({ state: "off", enabled: false });
    expect(turnController.stop).toHaveBeenCalledTimes(1);

    scheduler.flush();
    expect(turnController.start).toHaveBeenCalledTimes(1);
  });

  it("dispose unsubscribes listeners and blocks further control calls", async () => {
    const turnController = new FakeVoiceTurnController();
    const controller = new VoiceModeControllerImpl({ turnController });
    const listener = vi.fn();

    controller.subscribe(listener);
    await controller.start();
    turnController.emit(createStartingState("session-1"));

    const callsBeforeDispose = listener.mock.calls.length;
    controller.dispose();

    await controller.start();
    controller.stop();
    controller.cancel();
    turnController.emit(createCapturingState("session-1"));

    expect(listener.mock.calls.length).toBe(callsBeforeDispose);
    expect(turnController.start).toHaveBeenCalledTimes(1);
    expect(turnController.stop).toHaveBeenCalledTimes(0);
    expect(turnController.cancel).toHaveBeenCalledTimes(0);
  });

  it("maps permission denied to terminal mode state", async () => {
    const turnController = new FakeVoiceTurnController();
    const controller = new VoiceModeControllerImpl({ turnController });

    await controller.enable();
    turnController.emit(createStartingState("session-1"));
    turnController.emit(createPermissionDeniedState());

    expect(controller.getState()).toMatchObject({
      state: "permission-denied",
      enabled: false,
      restartCount: 0,
    });
  });

  it("maps unsupported to terminal state", async () => {
    const turnController = new FakeVoiceTurnController();
    const controller = new VoiceModeControllerImpl({ turnController });

    await controller.enable();
    turnController.emit(createUnsupportedState());

    expect(controller.getState()).toMatchObject({
      state: "unsupported",
      enabled: false,
      restartCount: 0,
    });
  });
});
