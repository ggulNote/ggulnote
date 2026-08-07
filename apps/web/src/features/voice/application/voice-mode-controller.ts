import type { SpeechProviderError, VoiceTurnControllerState } from "../domain";
import type { VoiceModeSnapshot, VoiceModeState } from "../domain";
import type { VoiceTurnController } from "./voice-turn-controller";

type VoiceTurnControllerPort = Pick<
  VoiceTurnController,
  "getState" | "start" | "stop" | "cancel" | "subscribe"
>;

export interface VoiceModeControllerScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface VoiceModeControllerOptions {
  turnController: VoiceTurnControllerPort;
  restartBackoffMs?: number;
  maxRecoverableRestarts?: number;
  scheduler?: VoiceModeControllerScheduler;
}

export interface VoiceModeController {
  getState(): VoiceModeSnapshot;
  start(): Promise<void>;
  stop(): void;
  cancel(): void;
  enable(): Promise<void>;
  disable(): void;
  subscribe(listener: (snapshot: VoiceModeSnapshot) => void): () => void;
  dispose(): void;
}

const DEFAULT_RESTART_BACKOFF_MS = 500;
const DEFAULT_MAX_RECOVERABLE_RESTARTS = 1;

export class VoiceModeControllerImpl implements VoiceModeController {
  private readonly turnController: VoiceTurnControllerPort;
  private readonly restartBackoffMs: number;
  private readonly maxRecoverableRestarts: number;
  private readonly scheduler: VoiceModeControllerScheduler;
  private readonly listeners = new Set<(snapshot: VoiceModeSnapshot) => void>();
  private readonly unsubscribeTurn: () => void;
  private state: VoiceModeSnapshot = {
    state: "off",
    enabled: false,
    restartCount: 0,
  };
  private disposed = false;
  private restartHandle: unknown;
  private pendingStart = false;

  public constructor(options: VoiceModeControllerOptions) {
    this.turnController = options.turnController;
    this.restartBackoffMs = options.restartBackoffMs ?? DEFAULT_RESTART_BACKOFF_MS;
    this.maxRecoverableRestarts = options.maxRecoverableRestarts
      ?? DEFAULT_MAX_RECOVERABLE_RESTARTS;
    this.scheduler = options.scheduler ?? createDefaultScheduler();
    this.unsubscribeTurn = this.turnController.subscribe((state) => {
      this.handleTurnState(state);
    });
  }

  public getState(): VoiceModeSnapshot {
    return cloneVoiceModeSnapshot(this.state);
  }

  public async enable(): Promise<void> {
    if (this.disposed) return;
    if (this.state.enabled) return;

    this.updateState({
      state: "starting",
      enabled: true,
      lastError: undefined,
    });
    await this.startTurn();
  }

  public async start(): Promise<void> {
    await this.enable();
  }

  public stop(): void {
    if (this.disposed) return;
    this.disableMode();
    this.turnController.stop();
  }

  public cancel(): void {
    if (this.disposed) return;
    this.disableMode();
    this.turnController.cancel();
  }

  public disable(): void {
    if (this.disposed) return;
    if (!this.state.enabled && this.state.state === "off") return;

    this.disableMode();
    this.turnController.stop();
  }

  public subscribe(listener: (snapshot: VoiceModeSnapshot) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearRestartTimer();
    this.unsubscribeTurn();
    this.listeners.clear();
  }

  private async startTurn(): Promise<void> {
    if (!this.state.enabled || this.disposed) return;
    if (this.pendingStart) return;

    const turnState = this.turnController.getState();
    if (!canStartFrom(turnState.status)) return;

    this.pendingStart = true;
    try {
      await this.turnController.start();
    } finally {
      this.pendingStart = false;
    }
  }

  private handleTurnState(next: VoiceTurnControllerState): void {
    if (this.disposed) return;

    const providerSessionId = getTurnProviderSessionId(next);
    const lastError = readSpeechProviderError(next);

    if (!this.state.enabled && next.status !== "unsupported") {
      return;
    }

    if (next.status === "starting") {
      this.updateState({
        state: "starting",
        enabled: this.state.enabled,
        providerSessionId: providerSessionId ?? this.state.providerSessionId,
      });
      return;
    }

    if (next.status === "capturing" || next.status === "finalizing") {
      this.updateState({
        state: "speech-active",
        enabled: this.state.enabled,
        providerSessionId: providerSessionId ?? this.state.providerSessionId,
      });
      this.clearRestartTimer();
      return;
    }

    if (next.status === "completed" || next.status === "discarded") {
      this.clearRestartTimer();
      const restart = this.state.enabled;
      this.updateState({
        state: "ready",
        enabled: this.state.enabled,
        providerSessionId,
        restartCount: 0,
        lastError: undefined,
      });
      if (restart) {
        this.scheduleRestart(this.restartBackoffMs);
      }
      return;
    }

    if (next.status === "unsupported") {
      const nextState = readUnsupportedModeState(next.error.code);
      this.clearRestartTimer();
      this.updateState({
        state: nextState,
        enabled: false,
        providerSessionId,
        restartCount: 0,
        lastError: next.error.providerError ?? {
          code: "unsupported",
          recoverable: false,
          retryPolicy: "none",
        },
      });
      return;
    }

    if (next.status === "failed") {
      if (!lastError) {
        this.clearRestartTimer();
        this.updateState({
          state: "error",
          enabled: this.state.enabled,
          providerSessionId,
          restartCount: 0,
          lastError: {
            code: "unknown",
            message: next.error.message,
            recoverable: false,
            retryPolicy: "none",
          },
        });
        return;
      }

      if (lastError.code === "not-allowed" || lastError.code === "service-not-allowed") {
        this.clearRestartTimer();
        this.updateState({
          state: "permission-denied",
          enabled: false,
          providerSessionId,
          restartCount: 0,
          lastError,
        });
        return;
      }

      if (lastError.code === "unsupported" || lastError.code === "language-not-supported") {
        this.clearRestartTimer();
        this.updateState({
          state: "unsupported",
          enabled: false,
          providerSessionId,
          restartCount: 0,
          lastError,
        });
        return;
      }

      if (
        !lastError.recoverable
        || lastError.retryPolicy === "none"
        || this.state.restartCount >= this.maxRecoverableRestarts
      ) {
        this.clearRestartTimer();
        this.updateState({
          state: "error",
          enabled: this.state.enabled,
          providerSessionId,
          restartCount: 0,
          lastError,
        });
        return;
      }

      const nextRestartCount = this.state.restartCount + 1;
      this.updateState({
        state: "recovering",
        enabled: true,
        providerSessionId,
        restartCount: nextRestartCount,
        lastError,
      });
      this.scheduleRestart(this.restartBackoffMs);
      return;
    }

    if (next.status === "cancelled") {
      this.clearRestartTimer();
      if (this.state.enabled) {
        this.updateState({
          state: "ready",
          enabled: true,
          providerSessionId,
          restartCount: 0,
          lastError: undefined,
        });
        this.scheduleRestart(this.restartBackoffMs);
      } else {
        this.updateState({
          state: "off",
          enabled: false,
          providerSessionId,
        });
      }
      return;
    }

    if (next.status === "idle") {
      if (
        this.state.state === "starting"
        || this.state.state === "speech-active"
        || this.state.state === "recovering"
      ) {
        this.updateState({
          state: "ready",
          enabled: this.state.enabled,
          providerSessionId,
          restartCount: 0,
          lastError: undefined,
        });
      }
    }
  }

  private disableMode(): void {
    this.clearRestartTimer();
    this.updateState({
      state: "off",
      enabled: false,
      restartCount: 0,
      lastError: undefined,
    });
  }

  private scheduleRestart(delayMs: number): void {
    this.clearRestartTimer();
    if (!this.state.enabled || this.disposed) return;
    this.restartHandle = this.scheduler.setTimeout(() => {
      this.restartHandle = undefined;
      if (!this.state.enabled || this.disposed) return;
      void this.startTurn();
    }, Math.max(0, delayMs));
  }

  private clearRestartTimer(): void {
    if (this.restartHandle !== undefined) {
      this.scheduler.clearTimeout(this.restartHandle);
    }
    this.restartHandle = undefined;
  }

  private updateState(next: Partial<VoiceModeSnapshot>): void {
    this.state = cloneVoiceModeSnapshot({
      ...this.state,
      ...next,
    });

    for (const listener of [...this.listeners]) {
      listener(cloneVoiceModeSnapshot(this.state));
    }
  }
}

function createDefaultScheduler(): VoiceModeControllerScheduler {
  return {
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle as number),
  };
}

function canStartFrom(status: VoiceTurnControllerState["status"]): boolean {
  return status === "idle" || isTerminalVoiceTurnStatus(status);
}

function getTurnProviderSessionId(state: VoiceTurnControllerState): string | undefined {
  if (state.status === "starting") return state.providerSessionId;
  if (state.status === "capturing" || state.status === "finalizing") return state.turn.providerSessionId;
  if (state.status === "completed") return state.result.providerSessionId;
  if (state.status === "discarded") return state.record?.providerSessionId;
  if (state.status === "cancelled" || state.status === "failed") return state.providerSessionId;
  return undefined;
}

function readSpeechProviderError(
  state: VoiceTurnControllerState,
): SpeechProviderError | undefined {
  if (state.status !== "failed" && state.status !== "unsupported") return undefined;

  if (state.error.providerError) return {
    ...state.error.providerError,
  };

  return {
    code: mapSpeechErrorCode(state.error.code),
    message: state.error.message,
    recoverable: state.error.recoverable,
    retryPolicy: "none",
  };
}

function readUnsupportedModeState(code: string): VoiceModeState {
  if (code === "language-not-supported") return "unsupported";
  if (code === "unsupported") return "unsupported";
  return "error";
}

function mapSpeechErrorCode(code: string): SpeechProviderError["code"] {
  return code === "unsupported" || code === "no-speech"
    || code === "aborted"
    || code === "audio-capture"
    || code === "network"
    || code === "not-allowed"
    || code === "service-not-allowed"
    || code === "language-not-supported"
    || code === "phrases-not-supported"
    || code === "invalid-state"
    || code === "unknown"
    ? code
    : "unknown";
}

function cloneVoiceModeSnapshot(snapshot: VoiceModeSnapshot): VoiceModeSnapshot {
  return {
    ...snapshot,
    ...(snapshot.lastError ? { lastError: { ...snapshot.lastError } } : {}),
  };
}

function isTerminalVoiceTurnStatus(status: VoiceTurnControllerState["status"]): boolean {
  return status === "completed"
    || status === "discarded"
    || status === "cancelled"
    || status === "failed"
    || status === "unsupported"
    || status === "idle";
}
