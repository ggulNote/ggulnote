import type {
  SpeechProviderAvailability,
  SpeechProviderEvent,
  SpeechRecognitionConfig,
  VoiceTurnControllerState,
} from "../domain";
import type {
  VoiceTurnControlDiagnosticEvent,
  VoiceTurnDiagnostics,
} from "../application/voice-turn-diagnostics";
import type { VoiceTurnController } from "../application/voice-turn-controller";
import { compareFrozenAndCurrentContext } from "./voice-debug-context";
import { resolveVoiceDebugMetricsFromState } from "./voice-debug-metrics";
import {
  readCompletedTurn,
  readFrozenContextFromState,
  readRecord,
  readTranscriptFromState,
  toVoiceDebugErrorSnapshot,
  toVoiceDebugRecentTurn,
  toVoiceDebugTurnSnapshot,
  type VoiceDebugObservedTimes,
} from "./voice-debug-read-model";
import {
  MAX_DEBUG_EVENTS,
  MAX_DEBUG_TURNS,
  type VoiceDebugContextSnapshot,
  type VoiceDebugEvent,
  type VoiceDebugEventType,
  type VoiceDebugLensPosition,
  type VoiceDebugProviderSnapshot,
  type VoiceDebugSnapshot,
  type VoiceDebugTranscriptSegment,
} from "./voice-debug-types";

export interface VoiceDebugStoreOptions {
  providerId: string;
  config: SpeechRecognitionConfig;
  api: {
    speechRecognition: boolean;
    webkitSpeechRecognition: boolean;
  };
  currentContext?: VoiceDebugContextSnapshot;
}

export class VoiceDebugStore {
  private readonly listeners = new Set<() => void>();
  private controller: VoiceTurnController | undefined;
  private controllerState: VoiceTurnControllerState = { status: "idle" };
  private provider: VoiceDebugProviderSnapshot;
  private observed: VoiceDebugObservedTimes = {};
  private events: VoiceDebugEvent[] = [];
  private recentTurns: VoiceDebugSnapshot["recentTurns"] = [];
  private currentContext: VoiceDebugContextSnapshot | undefined;
  private lensPosition: VoiceDebugLensPosition | undefined;
  private sequence = 0;
  private lastHistoryKey: string | undefined;
  private intentionalAbort = false;
  private disposed = false;
  private snapshot: VoiceDebugSnapshot;

  public readonly diagnostics: VoiceTurnDiagnostics = {
    onControlEvent: (event) => this.safely(() => this.handleControlEvent(event)),
    onProviderEvent: (event) => this.safely(() => this.handleProviderEvent(event)),
    onStateChange: (previous, next) => this.safely(() => this.handleStateChange(previous, next)),
  };

  public constructor(options: VoiceDebugStoreOptions) {
    this.currentContext = cloneContext(options.currentContext);
    this.provider = {
      providerId: options.providerId,
      availabilityChecked: false,
      supported: false,
      api: { ...options.api },
      localSupported: false,
      localAvailabilityStatus: "unknown",
      contextualBiasingSupported: false,
      language: options.config.lang,
      interimResults: options.config.interimResults,
      continuous: options.config.continuous,
      maxAlternatives: options.config.maxAlternatives,
      isRunning: false,
      startCount: 0,
      endCount: 0,
    };
    this.snapshot = this.buildSnapshot();
  }

  public attachController(controller: VoiceTurnController): void {
    this.controller = controller;
    this.controllerState = controller.getState();
    this.publish();
  }

  public getSnapshot = (): VoiceDebugSnapshot => this.snapshot;

  public subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public setAvailability(availability: SpeechProviderAvailability): void {
    if (this.disposed) return;
    this.provider = {
      ...this.provider,
      availabilityChecked: true,
      supported: availability.supported,
      ...(availability.constructorName
        ? { constructorName: availability.constructorName }
        : {}),
      localSupported: availability.local.supported,
      localAvailabilityStatus: availability.local.status,
      contextualBiasingSupported: availability.contextualBiasingSupported,
    };
    this.publish();
  }

  public setCurrentContext(context: VoiceDebugContextSnapshot): void {
    if (this.disposed) return;
    this.currentContext = cloneContext(context);
    this.publish();
  }

  public setLensPosition(position: VoiceDebugLensPosition | undefined): void {
    if (this.disposed) return;
    this.lensPosition = position ? cloneLensPosition(position) : undefined;
    this.publish();
  }

  public clearEvents(): void {
    this.events = [];
    this.publish();
  }

  public clearHistory(): void {
    this.recentTurns = [];
    this.lastHistoryKey = undefined;
    this.publish();
  }

  public dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.controller = undefined;
  }

  private handleControlEvent(event: VoiceTurnControlDiagnosticEvent): void {
    if (event.type === "turn-requested") {
      this.observed = { requestedAt: event.at };
      this.intentionalAbort = false;
      this.provider = {
        ...this.provider,
        intentionalStop: false,
        intentionalAbort: false,
      };
      this.appendEvent("TURN_REQUESTED", event.at);
    } else if (event.type === "stop-requested") {
      this.observed.stopRequestedAt = event.at;
      this.provider = { ...this.provider, intentionalStop: true };
      this.appendEvent("STOP_REQUESTED", event.at);
    } else {
      this.observed.cancelRequestedAt = event.at;
      this.intentionalAbort = true;
      this.provider = {
        ...this.provider,
        isRunning: false,
        intentionalAbort: true,
      };
      this.appendEvent("CANCEL_REQUESTED", event.at);
      this.appendEvent("PROVIDER_ABORT", event.at);
    }
    this.publish();
  }

  private handleProviderEvent(event: SpeechProviderEvent): void {
    switch (event.type) {
      case "provider-start":
        this.observed.recognitionStartedAt ??= event.at;
        this.provider = {
          ...this.provider,
          sessionId: event.sessionId,
          isRunning: true,
          startCount: this.provider.startCount + 1,
        };
        this.appendEvent("PROVIDER_START", event.at, event.sessionId);
        break;
      case "audio-start":
        this.observed.audioStartedAt ??= event.at;
        this.appendEvent("AUDIO_START", event.at, event.sessionId);
        break;
      case "speech-start":
        this.appendEvent("SPEECH_START", event.at, event.sessionId);
        break;
      case "transcript":
        if (event.isFinal) this.observed.firstFinalAt ??= event.at;
        else this.observed.firstInterimAt ??= event.at;
        this.appendEvent(
          event.isFinal ? "TRANSCRIPT_FINAL" : "TRANSCRIPT_INTERIM",
          event.at,
          event.sessionId,
          currentTurnId(this.controllerState),
          `resultIndex=${event.segmentIndex} length=${event.text.length}`,
        );
        break;
      case "speech-end":
        this.observed.speechEndedAt ??= event.at;
        this.appendEvent(
          "SPEECH_END",
          event.at,
          event.sessionId,
          currentTurnId(this.controllerState),
        );
        break;
      case "audio-end":
        this.appendEvent(
          "AUDIO_END",
          event.at,
          event.sessionId,
          currentTurnId(this.controllerState),
        );
        break;
      case "provider-end":
        this.observed.providerEndedAt ??= event.at;
        this.provider = {
          ...this.provider,
          isRunning: false,
          endCount: this.provider.endCount + 1,
          intentionalStop: event.intentional || this.provider.intentionalStop,
        };
        this.appendEvent(
          "PROVIDER_END",
          event.at,
          event.sessionId,
          currentTurnId(this.controllerState),
          event.intentional ? "intentional=true" : "intentional=false",
        );
        break;
      case "error":
        this.appendEvent(
          "PROVIDER_ERROR",
          event.at,
          event.sessionId,
          currentTurnId(this.controllerState),
          `code=${event.error.code} recoverable=${event.error.recoverable}`,
        );
        break;
    }
    this.publish();
  }

  private handleStateChange(
    previous: VoiceTurnControllerState,
    next: VoiceTurnControllerState,
  ): void {
    this.controllerState = next;
    if (
      next.status === "capturing"
      && previous.status !== "capturing"
      && previous.status !== "finalizing"
    ) {
      this.appendEvent(
        "CONTEXT_FROZEN",
        next.turn.startedAt,
        next.turn.providerSessionId,
        next.turn.id,
        `page=${next.turn.frozenContext.pageId} revision=${next.turn.frozenContext.sceneRevision}`,
      );
    }

    const terminal = terminalEvent(next, this.observed.requestedAt);
    if (terminal) {
      this.observed.completedAt ??= terminal.at;
      this.appendEvent(
        terminal.type,
        terminal.at,
        terminal.sessionId,
        terminal.turnId,
        terminal.summary,
      );
      this.addHistory(next, terminal.at);
    }
    this.publish();
  }

  private addHistory(state: VoiceTurnControllerState, timestamp: number): void {
    const record = toVoiceDebugRecentTurn(state, timestamp);
    if (!record) return;
    const key = `${state.status}:${record.turnId}:${record.completedAt ?? timestamp}`;
    if (key === this.lastHistoryKey) return;
    this.lastHistoryKey = key;
    const withMetrics = {
      ...record,
      metricsForDisplay: resolveVoiceDebugMetricsFromState(state),
    };
    this.recentTurns = [...this.recentTurns, withMetrics].slice(-MAX_DEBUG_TURNS);
  }

  private appendEvent(
    type: VoiceDebugEventType,
    timestamp: number,
    sessionId?: string,
    turnId?: string,
    summary?: string,
  ): void {
    this.sequence += 1;
    const event: VoiceDebugEvent = {
      id: "voice-debug-event-" + this.sequence,
      sequence: this.sequence,
      timestamp,
      type,
      ...(turnId ? { turnId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(summary ? { summary } : {}),
    };
    this.events = [...this.events, event].slice(-MAX_DEBUG_EVENTS);
  }

  private publish(): void {
    if (this.disposed) return;
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A debug subscriber must not affect diagnostics or Voice Core.
      }
    }
  }

  private buildSnapshot(): VoiceDebugSnapshot {
    const transcript = readTranscriptFromState(this.controllerState);
    const turn = toVoiceDebugTurnSnapshot(this.controllerState, this.observed);
    const frozenContext = readFrozenContextFromState(this.controllerState);
    const currentContext = cloneContext(this.currentContext);
    const record = readRecord(this.controllerState);
    const contextDiff = compareFrozenAndCurrentContext({
      frozenContext,
      ...(record
        ? {
            completedSceneChangeFlags: {
              pageChangedDuringTurn: record.scene.pageChangedDuringTurn,
              sceneChangedDuringTurn: record.scene.sceneChangedDuringTurn,
            },
          }
        : {}),
      currentContext,
    });
    const segments: VoiceDebugTranscriptSegment[] = (
      this.controller?.getTranscriptSegmentsSnapshot() ?? []
    ).map((segment) => ({
      resultIndex: segment.index,
      segmentId: segment.id,
      sessionId: turn.sessionId ?? "-",
      isFinal: segment.isFinal,
      length: segment.text.length,
      text: segment.text,
    }));
    const errorTimestamp = this.controllerState.status === "failed"
      ? this.controllerState.failedAt
      : this.observed.providerEndedAt ?? this.observed.completedAt ?? turn.requestedAt;
    const error = toVoiceDebugErrorSnapshot(
      this.controllerState,
      errorTimestamp,
      this.intentionalAbort,
    );
    const completed = readCompletedTurn(this.controllerState);
    const value: VoiceDebugSnapshot = {
      provider: cloneProvider(this.provider),
      turn: { ...turn },
      transcript: {
        rawInterim: transcript.interimText,
        rawFinal: transcript.finalText,
        segments,
      },
      contextDiff,
      metrics: resolveVoiceDebugMetricsFromState(this.controllerState),
      events: this.events.map((event) => ({ ...event })),
      recentTurns: this.recentTurns.map((recent) => cloneRecent(recent)),
      ...(frozenContext ? { frozenContext } : {}),
      ...(currentContext ? { currentContext } : {}),
      ...(this.lensPosition
        ? { lensPosition: cloneLensPosition(this.lensPosition) }
        : {}),
      ...(error ? { error } : {}),
      ...(completed ? { completed } : {}),
    };
    return deepFreeze(value);
  }

  private safely(action: () => void): void {
    if (this.disposed) return;
    try {
      action();
    } catch {
      // Diagnostics are intentionally best effort.
    }
  }
}

function terminalEvent(state: VoiceTurnControllerState, fallbackAt?: number): {
  type: VoiceDebugEventType;
  at: number;
  turnId?: string;
  sessionId?: string;
  summary?: string;
} | undefined {
  if (state.status === "completed") {
    return {
      type: "TURN_COMPLETED",
      at: state.result.completedAt ?? state.result.requestedAt,
      turnId: state.result.id,
      sessionId: state.result.providerSessionId,
    };
  }
  if (state.status === "discarded") {
    const at = state.record?.completedAt ?? state.record?.requestedAt ?? fallbackAt;
    if (at === undefined) return undefined;
    return {
      type: "TURN_DISCARDED",
      at,
      turnId: state.record?.id,
      sessionId: state.record?.providerSessionId,
      summary: "reason=" + state.reason,
    };
  }
  if (state.status === "cancelled") {
    return {
      type: "TURN_CANCELLED",
      at: state.cancelledAt,
      turnId: state.turnId,
      sessionId: state.providerSessionId,
      summary: `reason=${state.reason}`,
    };
  }
  if (state.status === "failed") {
    return {
      type: "TURN_FAILED",
      at: state.failedAt,
      turnId: state.turnId,
      sessionId: state.providerSessionId,
      summary: `code=${state.error.code}`,
    };
  }
  return undefined;
}

function currentTurnId(state: VoiceTurnControllerState): string | undefined {
  if (state.status === "capturing" || state.status === "finalizing") {
    return state.turn.id;
  }
  return undefined;
}

function cloneProvider(provider: VoiceDebugProviderSnapshot): VoiceDebugProviderSnapshot {
  return { ...provider, api: { ...provider.api } };
}

function cloneContext(
  context: VoiceDebugContextSnapshot | undefined,
): VoiceDebugContextSnapshot | undefined {
  return context
    ? {
        ...context,
        ...(context.focusBounds ? { focusBounds: { ...context.focusBounds } } : {}),
      }
    : undefined;
}

function cloneLensPosition(position: VoiceDebugLensPosition): VoiceDebugLensPosition {
  return {
    ...position,
    ...(position.anchorScreenRect
      ? { anchorScreenRect: { ...position.anchorScreenRect } }
      : {}),
    lensSize: { ...position.lensSize },
    safeRect: { ...position.safeRect },
    finalScreenPosition: { ...position.finalScreenPosition },
  };
}

function cloneRecent(
  recent: VoiceDebugSnapshot["recentTurns"][number],
): VoiceDebugSnapshot["recentTurns"][number] {
  return {
    ...recent,
    ...(recent.frozenContext ? { frozenContext: cloneContext(recent.frozenContext) } : {}),
    ...(recent.metrics ? { metrics: { ...recent.metrics } } : {}),
    ...(recent.metricsForDisplay
      ? { metricsForDisplay: { ...recent.metricsForDisplay } }
      : {}),
    ...(recent.error
      ? {
          error: {
            ...recent.error,
            ...(recent.error.providerError
              ? { providerError: { ...recent.error.providerError } }
              : {}),
          },
        }
      : {}),
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
