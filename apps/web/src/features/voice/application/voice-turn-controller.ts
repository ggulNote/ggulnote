import type { InteractionClock } from "@ggulnote/interaction-core";
import {
  DEFAULT_COMMAND_RECOGNITION_CONFIG,
  TranscriptAccumulator,
  cloneSpeechRecognitionConfig,
  isTerminalVoiceTurnStatus,
  reduceVoiceTurnLifecycle,
  type ActiveVoiceTurnSnapshot,
  type FrozenVoiceTurnContext,
  type SpeechProviderError,
  type SpeechProviderEvent,
  type SpeechRecognitionConfig,
  type TranscriptAccumulatorSnapshot,
  type TranscriptAccumulatorSegmentSnapshot,
  type VoiceFocusSnapshot,
  type VoiceTurnCancelReason,
  type VoiceTurnControllerError,
  type VoiceTurnControllerState,
  type VoiceTurnMetrics,
  type VoiceTurnRecord,
  type VoiceTurnTimingConfig,
} from "../domain";
import type { SpeechRecognitionProvider } from "../providers";
import type { VoiceCurrentSceneReference, VoiceTurnContextSource } from "./voice-turn-context-source";
import type {
  VoiceTurnControlDiagnosticEvent,
  VoiceTurnDiagnostics,
} from "./voice-turn-diagnostics";

export interface VoiceTurnScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface VoiceTurnControllerOptions {
  provider: SpeechRecognitionProvider;
  contextSource: VoiceTurnContextSource;
  clock: Pick<InteractionClock, "now">;
  createTurnId: () => string;
  config?: SpeechRecognitionConfig;
  timing?: Partial<VoiceTurnTimingConfig>;
  scheduler?: VoiceTurnScheduler;
  diagnostics?: VoiceTurnDiagnostics;
}

export type VoiceTurnStateListener = (state: VoiceTurnControllerState) => void;

export const DEFAULT_VOICE_TURN_TIMING_CONFIG: VoiceTurnTimingConfig = {
  speechEndGraceMs: 250,
  finalResultWaitMs: 1_000,
  restartBackoffMs: 500,
  maxRecoverableRestarts: 1,
};

const EMPTY_TRANSCRIPT: TranscriptAccumulatorSnapshot = {
  finalText: "",
  interimText: "",
  displayText: "",
  finalSegments: [],
};

interface ActiveRuntime {
  requestedAt: number;
  providerStartedAt?: number;
  audioStartedAt?: number;
  sessionId?: string;
  turnId?: string;
  context?: FrozenVoiceTurnContext;
  focusSnapshot?: VoiceFocusSnapshot;
  speechStartedAt?: number;
  firstInterimAt?: number;
  firstFinalAt?: number;
  speechEndedAt?: number;
  providerEndedAt?: number;
  stopRequestedAt?: number;
  accumulator?: TranscriptAccumulator;
  transcript: TranscriptAccumulatorSnapshot;
  interimUpdateCount: number;
  error?: SpeechProviderError;
}

type CompleteRuntime = ActiveRuntime & Required<Pick<ActiveRuntime,
  "sessionId" | "turnId" | "context" | "focusSnapshot" | "speechStartedAt"
>>;

export class VoiceTurnController {
  private readonly provider: SpeechRecognitionProvider;
  private readonly contextSource: VoiceTurnContextSource;
  private readonly clock: Pick<InteractionClock, "now">;
  private readonly createTurnId: () => string;
  private readonly config: SpeechRecognitionConfig;
  private readonly timing: VoiceTurnTimingConfig;
  private readonly scheduler: VoiceTurnScheduler;
  private readonly diagnostics: VoiceTurnDiagnostics | undefined;
  private readonly listeners = new Set<VoiceTurnStateListener>();
  private readonly unsubscribeProvider: () => void;
  private readonly retiredSessionIds = new Set<string>();
  private readonly retiredSessionOrder: string[] = [];
  private state: VoiceTurnControllerState = { status: "idle" };
  private runtime: ActiveRuntime | undefined;
  private graceTimer: unknown;
  private finalWaitTimer: unknown;
  private disposed = false;

  public constructor(options: VoiceTurnControllerOptions) {
    this.provider = options.provider;
    this.contextSource = options.contextSource;
    this.clock = options.clock;
    this.createTurnId = options.createTurnId;
    this.config = cloneSpeechRecognitionConfig(options.config ?? DEFAULT_COMMAND_RECOGNITION_CONFIG);
    this.timing = { ...DEFAULT_VOICE_TURN_TIMING_CONFIG, ...options.timing };
    this.scheduler = options.scheduler ?? createDefaultScheduler();
    this.diagnostics = options.diagnostics;
    this.unsubscribeProvider = this.provider.subscribe((event) => this.handleProviderEvent(event));
  }

  public getState(): VoiceTurnControllerState {
    return cloneControllerState(this.state);
  }

  public getCompletedTurn(): VoiceTurnRecord | undefined {
    return this.state.status === "completed" ? cloneVoiceTurnRecord(this.state.result) : undefined;
  }

  public getFrozenContext(): FrozenVoiceTurnContext | undefined {
    if (this.state.status === "capturing" || this.state.status === "finalizing") {
      return cloneFrozenContext(this.state.turn.frozenContext);
    }
    if (this.state.status === "completed") {
      return cloneFrozenContext(this.state.result.frozenContext);
    }
    if (this.state.status === "discarded" && this.state.record) {
      return cloneFrozenContext(this.state.record.frozenContext);
    }
    if ((this.state.status === "cancelled" || this.state.status === "failed") && this.state.frozenContext) {
      return cloneFrozenContext(this.state.frozenContext);
    }
    return undefined;
  }

  public getTranscriptSnapshot(): TranscriptAccumulatorSnapshot {
    if (this.runtime) return cloneTranscript(this.runtime.transcript);
    if (this.state.status === "completed") return transcriptFromRecord(this.state.result);
    if (this.state.status === "discarded" && this.state.record) {
      return transcriptFromRecord(this.state.record);
    }
    if (this.state.status === "cancelled" || this.state.status === "failed") {
      return cloneTranscript(this.state.transcript);
    }
    return cloneTranscript(EMPTY_TRANSCRIPT);
  }

  public getTranscriptSegmentsSnapshot(): readonly TranscriptAccumulatorSegmentSnapshot[] {
    if (this.runtime?.accumulator) {
      return this.runtime.accumulator.getSegmentsSnapshot();
    }
    const record = this.state.status === "completed"
      ? this.state.result
      : this.state.status === "discarded"
        ? this.state.record
        : undefined;
    return record?.finalSegments.map((segment) => ({
      ...segment,
      isFinal: true,
    })) ?? [];
  }

  public async start(): Promise<void> {
    if (this.disposed || !canStartFrom(this.state.status)) return;
    this.clearTimers();
    const requestedAt = this.readTime();
    this.runtime = {
      requestedAt,
      transcript: cloneTranscript(EMPTY_TRANSCRIPT),
      interimUpdateCount: 0,
    };
    this.emitControlDiagnostic({ type: "turn-requested", at: requestedAt });
    this.transitionTo({
      status: "starting",
      providerId: this.provider.id,
      requestedAt,
      config: cloneSpeechRecognitionConfig(this.config),
    });

    try {
      const availability = await this.provider.getAvailability(this.config);
      if (!this.isCurrentRuntime(requestedAt)) return;
      if (!availability.supported) {
        this.runtime = undefined;
        this.transitionTo({
          status: "unsupported",
          error: { code: "unsupported", recoverable: false },
        });
        return;
      }
      await this.provider.start(this.config);
    } catch (error) {
      if (this.isCurrentRuntime(requestedAt)) this.fail(createStartFailure(error));
    }
  }

  public stop(): void {
    if (this.disposed || !isActiveStatus(this.state.status) || !this.runtime) return;
    if (this.runtime.stopRequestedAt === undefined) {
      this.runtime.stopRequestedAt = this.readTime();
      this.emitControlDiagnostic({
        type: "stop-requested",
        at: this.runtime.stopRequestedAt,
      });
    }
    if (this.canBuildRecord()) {
      this.transitionTo({ status: "finalizing", turn: this.buildActiveSnapshot("finalizing") });
    }
    this.provider.stop();
  }

  public cancel(reason: VoiceTurnCancelReason = "user"): void {
    if (this.disposed || !isActiveStatus(this.state.status) || !this.runtime) return;
    const runtime = this.runtime;
    const cancelledAt = this.readTime();
    this.emitControlDiagnostic({ type: "cancel-requested", at: cancelledAt });
    this.retireActiveSession();
    this.clearTimers();
    const next: Extract<VoiceTurnControllerState, { status: "cancelled" }> = {
      status: "cancelled",
      reason,
      requestedAt: runtime.requestedAt,
      cancelledAt,
      transcript: cloneTranscript(runtime.transcript),
    };
    if (runtime.turnId !== undefined) next.turnId = runtime.turnId;
    if (runtime.sessionId !== undefined) next.providerSessionId = runtime.sessionId;
    if (runtime.context !== undefined) next.frozenContext = cloneFrozenContext(runtime.context);
    this.runtime = undefined;
    this.transitionTo(next);
    this.provider.abort();
  }

  public subscribe(listener: VoiceTurnStateListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    if (this.disposed) return;
    if (isActiveStatus(this.state.status)) this.cancel("dispose");
    this.disposed = true;
    this.clearTimers();
    this.unsubscribeProvider();
    this.provider.dispose();
    this.listeners.clear();
    this.runtime = undefined;
  }

  private handleProviderEvent(event: SpeechProviderEvent): void {
    if (this.disposed || !this.runtime || !isActiveStatus(this.state.status)) return;
    if (!this.acceptSession(event.sessionId)) return;
    this.emitProviderDiagnostic(event);

    switch (event.type) {
      case "provider-start":
        this.runtime.providerStartedAt ??= event.at;
        this.refreshStartingState();
        break;
      case "audio-start":
        this.runtime.audioStartedAt ??= event.at;
        this.refreshStartingState();
        break;
      case "speech-start":
        this.ensureTurnStarted(event.at);
        break;
      case "transcript":
        if (this.ensureTurnStarted(event.at)) this.handleTranscript(event);
        break;
      case "speech-end":
        if (!this.runtime.turnId) return;
        this.runtime.speechEndedAt ??= event.at;
        this.transitionTo({ status: "finalizing", turn: this.buildActiveSnapshot("finalizing") });
        this.scheduleFinalization();
        break;
      case "audio-end":
        break;
      case "provider-end":
        this.runtime.providerEndedAt ??= event.at;
        this.handleProviderEnd();
        break;
      case "error":
        this.handleProviderError(event.error, event.at);
        break;
    }
  }

  private acceptSession(sessionId: string): boolean {
    if (!this.runtime || this.retiredSessionIds.has(sessionId)) return false;
    if (this.runtime.sessionId === undefined) {
      this.runtime.sessionId = sessionId;
      this.runtime.accumulator = new TranscriptAccumulator(sessionId);
      this.refreshStartingState();
      return true;
    }
    return this.runtime.sessionId === sessionId;
  }

  private ensureTurnStarted(at: number): boolean {
    if (!this.runtime) return false;
    if (this.runtime.turnId) return true;
    if (!this.runtime.sessionId) return false;
    if (this.runtime.stopRequestedAt !== undefined) return false;

    try {
      const capture = this.contextSource.capture(at);
      this.runtime.turnId = this.createTurnId();
      this.runtime.speechStartedAt = at;
      this.runtime.context = cloneFrozenContext(capture.frozenContext);
      this.runtime.focusSnapshot = cloneFocusSnapshot(capture.focusSnapshot);
      this.transitionTo({ status: "capturing", turn: this.buildActiveSnapshot("capturing") });
      return true;
    } catch (error) {
      this.fail({
        code: "context-capture-failed",
        message: readErrorMessage(error),
        recoverable: true,
      }, at);
      return false;
    }
  }

  private handleTranscript(event: Extract<SpeechProviderEvent, { type: "transcript" }>): void {
    if (!this.runtime?.accumulator) return;
    const previous = this.runtime.transcript;
    const next = this.runtime.accumulator.update(event);
    this.runtime.transcript = next;
    if (!event.isFinal && next.interimText !== previous.interimText) {
      this.runtime.interimUpdateCount += 1;
      this.runtime.firstInterimAt ??= event.at;
    }
    if (event.isFinal && next.finalText !== previous.finalText) {
      this.runtime.firstFinalAt ??= event.at;
    }
    const status = this.state.status === "finalizing" ? "finalizing" : "capturing";
    this.transitionTo({ status, turn: this.buildActiveSnapshot(status) });
  }

  private handleProviderEnd(): void {
    if (!this.runtime) return;
    if (!this.canBuildRecord()) {
      this.discard("provider-ended-before-speech");
      return;
    }
    if (this.runtime.transcript.finalText.trim()) {
      this.complete();
      return;
    }
    this.discard(this.runtime.error?.code === "no-speech" ? "no-speech" : "empty-transcript");
  }

  private handleProviderError(error: SpeechProviderError, at: number): void {
    if (!this.runtime) return;
    this.runtime.error = { ...error };
    if (this.runtime.transcript.finalText.trim() && this.runtime.context) {
      this.complete(at);
      return;
    }
    this.fail({
      code: error.code,
      ...(error.message ? { message: error.message } : {}),
      recoverable: error.recoverable,
      providerError: { ...error },
    }, at);
  }

  private scheduleFinalization(): void {
    this.clearTimers();
    this.graceTimer = this.scheduler.setTimeout(() => {
      this.graceTimer = undefined;
      if (!this.runtime || this.state.status !== "finalizing") return;
      if (this.runtime.transcript.finalText.trim()) {
        this.complete();
        return;
      }
      const remaining = Math.max(0, this.timing.finalResultWaitMs - this.timing.speechEndGraceMs);
      this.finalWaitTimer = this.scheduler.setTimeout(() => {
        this.finalWaitTimer = undefined;
        if (this.runtime && this.state.status === "finalizing") this.discard("empty-transcript");
      }, remaining);
    }, Math.max(0, this.timing.speechEndGraceMs));
  }

  private complete(at = this.readTime()): void {
    if (!this.canBuildRecord() || !this.runtime || isTerminalVoiceTurnStatus(this.state.status)) return;
    this.clearTimers();
    const record = this.buildRecord("completed", at);
    this.retireActiveSession();
    this.runtime = undefined;
    this.transitionTo({ status: "completed", result: record });
  }

  private discard(reason: "empty-transcript" | "no-speech" | "provider-ended-before-speech"): void {
    if (!this.runtime) return;
    this.clearTimers();
    const record = this.canBuildRecord() ? this.buildRecord("discarded", this.readTime()) : undefined;
    this.retireActiveSession();
    this.runtime = undefined;
    this.transitionTo(record
      ? { status: "discarded", reason, record }
      : { status: "discarded", reason });
  }

  private fail(error: VoiceTurnControllerError, at = this.readTime()): void {
    const runtime = this.runtime;
    this.clearTimers();
    if (runtime?.sessionId) this.retireSession(runtime.sessionId);
    const next: Extract<VoiceTurnControllerState, { status: "failed" }> = {
      status: "failed",
      error: cloneControllerError(error),
      failedAt: at,
      transcript: cloneTranscript(runtime?.transcript ?? EMPTY_TRANSCRIPT),
    };
    if (runtime?.requestedAt !== undefined) next.requestedAt = runtime.requestedAt;
    if (runtime?.turnId !== undefined) next.turnId = runtime.turnId;
    if (runtime?.sessionId !== undefined) next.providerSessionId = runtime.sessionId;
    if (runtime?.context !== undefined) next.frozenContext = cloneFrozenContext(runtime.context);
    this.runtime = undefined;
    this.transitionTo(next);
  }

  private refreshStartingState(): void {
    if (!this.runtime || this.state.status !== "starting") return;
    const state: Extract<VoiceTurnControllerState, { status: "starting" }> = {
      status: "starting",
      providerId: this.provider.id,
      requestedAt: this.runtime.requestedAt,
      config: cloneSpeechRecognitionConfig(this.config),
    };
    if (this.runtime.sessionId !== undefined) state.providerSessionId = this.runtime.sessionId;
    if (this.runtime.providerStartedAt !== undefined) state.recognitionStartedAt = this.runtime.providerStartedAt;
    if (this.runtime.audioStartedAt !== undefined) state.audioStartedAt = this.runtime.audioStartedAt;
    this.transitionTo(state);
  }

  private buildActiveSnapshot(state: "capturing" | "finalizing"): ActiveVoiceTurnSnapshot {
    const runtime = this.requireCompleteRuntime();
    const snapshot: ActiveVoiceTurnSnapshot = {
      id: runtime.turnId,
      state,
      providerId: this.provider.id,
      providerSessionId: runtime.sessionId,
      language: this.config.lang,
      requestedAt: runtime.requestedAt,
      startedAt: runtime.speechStartedAt,
      transcript: cloneTranscript(runtime.transcript),
      frozenContext: cloneFrozenContext(runtime.context),
      focusSnapshot: cloneFocusSnapshot(runtime.focusSnapshot),
      scene: createSceneReference(runtime.context),
      metrics: this.buildMetrics(runtime),
    };
    assignOptionalTimes(snapshot, runtime);
    return snapshot;
  }

  private buildRecord(
    state: "completed" | "discarded" | "failed",
    completedAt: number,
  ): VoiceTurnRecord {
    const runtime = this.requireCompleteRuntime();
    const currentScene = safeReadCurrentScene(this.contextSource);
    const record: VoiceTurnRecord = {
      id: runtime.turnId,
      providerId: this.provider.id,
      providerSessionId: runtime.sessionId,
      language: this.config.lang,
      requestedAt: runtime.requestedAt,
      startedAt: runtime.speechStartedAt,
      completedAt,
      state,
      rawTranscript: runtime.transcript.finalText,
      finalSegments: runtime.transcript.finalSegments.map((segment) => ({ ...segment })),
      frozenContext: cloneFrozenContext(runtime.context),
      focusSnapshot: cloneFocusSnapshot(runtime.focusSnapshot),
      scene: createSceneReference(runtime.context, currentScene),
      metrics: this.buildMetrics(runtime, completedAt),
    };
    assignOptionalTimes(record, runtime);
    if (runtime.providerEndedAt !== undefined) record.providerEndedAt = runtime.providerEndedAt;
    if (runtime.error !== undefined) record.error = { ...runtime.error };
    return record;
  }

  private buildMetrics(runtime: ActiveRuntime, completedAt?: number): VoiceTurnMetrics {
    const metrics: VoiceTurnMetrics = {
      interimUpdateCount: runtime.interimUpdateCount,
      finalSegmentCount: runtime.transcript.finalSegments.length,
      providerRestartCount: 0,
    };
    assignDuration(metrics, "requestToRecognitionStartMs", runtime.requestedAt, runtime.providerStartedAt);
    assignDuration(metrics, "speechStartToFirstInterimMs", runtime.speechStartedAt, runtime.firstInterimAt);
    assignDuration(metrics, "speechStartToFirstFinalMs", runtime.speechStartedAt, runtime.firstFinalAt);
    assignDuration(metrics, "speechEndToFirstFinalMs", runtime.speechEndedAt, runtime.firstFinalAt);
    assignDuration(metrics, "speechEndToCompletedMs", runtime.speechEndedAt, completedAt);
    assignDuration(metrics, "totalTurnMs", runtime.requestedAt, completedAt);
    return metrics;
  }

  private transitionTo(next: VoiceTurnControllerState): void {
    if (!isAllowedControllerTransition(this.state.status, next.status)) return;
    const previous = cloneControllerState(this.state);
    this.state = cloneControllerState(next);
    this.emitStateDiagnostic(previous, this.state);
    for (const listener of [...this.listeners]) {
      try {
        listener(this.getState());
      } catch {
        // One observer must not interrupt the Voice Turn lifecycle.
      }
    }
  }

  private emitControlDiagnostic(event: VoiceTurnControlDiagnosticEvent): void {
    try {
      this.diagnostics?.onControlEvent?.({ ...event });
    } catch {
      // Debug diagnostics must never interrupt a Voice Turn.
    }
  }

  private emitProviderDiagnostic(event: SpeechProviderEvent): void {
    try {
      this.diagnostics?.onProviderEvent?.(cloneProviderEvent(event));
    } catch {
      // Debug diagnostics must never interrupt a Voice Turn.
    }
  }

  private emitStateDiagnostic(
    previous: VoiceTurnControllerState,
    next: VoiceTurnControllerState,
  ): void {
    try {
      this.diagnostics?.onStateChange?.(
        cloneControllerState(previous),
        cloneControllerState(next),
      );
    } catch {
      // Debug diagnostics must never interrupt a Voice Turn.
    }
  }

  private canBuildRecord(): boolean {
    return Boolean(
      this.runtime?.turnId
      && this.runtime.sessionId
      && this.runtime.context
      && this.runtime.focusSnapshot
      && this.runtime.speechStartedAt !== undefined,
    );
  }

  private requireCompleteRuntime(): CompleteRuntime {
    if (!this.canBuildRecord()) throw new Error("Voice Turn runtime is incomplete.");
    return this.runtime as CompleteRuntime;
  }

  private retireActiveSession(): void {
    if (this.runtime?.sessionId) this.retireSession(this.runtime.sessionId);
  }

  private retireSession(sessionId: string): void {
    if (this.retiredSessionIds.has(sessionId)) return;
    this.retiredSessionIds.add(sessionId);
    this.retiredSessionOrder.push(sessionId);
    const maximumRetiredSessions = 32;
    while (this.retiredSessionOrder.length > maximumRetiredSessions) {
      const expired = this.retiredSessionOrder.shift();
      if (expired !== undefined) this.retiredSessionIds.delete(expired);
    }
  }

  private clearTimers(): void {
    if (this.graceTimer !== undefined) this.scheduler.clearTimeout(this.graceTimer);
    if (this.finalWaitTimer !== undefined) this.scheduler.clearTimeout(this.finalWaitTimer);
    this.graceTimer = undefined;
    this.finalWaitTimer = undefined;
  }

  private isCurrentRuntime(requestedAt: number): boolean {
    return !this.disposed && this.runtime?.requestedAt === requestedAt;
  }

  private readTime(): number {
    return Number(this.clock.now());
  }
}

function canStartFrom(status: VoiceTurnControllerState["status"]): boolean {
  return status === "idle" || isTerminalVoiceTurnStatus(status);
}

function isActiveStatus(status: VoiceTurnControllerState["status"]): boolean {
  return status === "starting" || status === "capturing" || status === "finalizing";
}

function isAllowedControllerTransition(
  current: VoiceTurnControllerState["status"],
  next: VoiceTurnControllerState["status"],
): boolean {
  if (current === next) return true;
  const action = next === "starting" ? { type: "START_REQUESTED" } as const
    : next === "capturing" ? { type: "SPEECH_STARTED" } as const
      : next === "finalizing" ? { type: "SPEECH_ENDED" } as const
        : next === "completed" ? { type: "COMPLETED" } as const
          : next === "discarded" ? { type: "DISCARDED" } as const
            : next === "cancelled" ? { type: "CANCELLED" } as const
              : next === "failed" ? { type: "FAILED" } as const
                : next === "unsupported" ? { type: "UNSUPPORTED" } as const
                  : undefined;
  return action ? reduceVoiceTurnLifecycle(current, action) === next : false;
}

function createSceneReference(
  context: FrozenVoiceTurnContext,
  current?: VoiceCurrentSceneReference,
) {
  return {
    sceneRevisionAtSpeechStart: context.sceneRevision,
    pageIdAtSpeechStart: context.pageId,
    ...(current ? { currentSceneRevisionAtCompletion: current.sceneRevision } : {}),
    sceneChangedDuringTurn: current ? current.sceneRevision !== context.sceneRevision : false,
    pageChangedDuringTurn: current ? current.pageId !== context.pageId : false,
  };
}

function safeReadCurrentScene(source: VoiceTurnContextSource): VoiceCurrentSceneReference | undefined {
  try {
    return source.getCurrentSceneReference();
  } catch {
    return undefined;
  }
}

function createStartFailure(error: unknown): VoiceTurnControllerError {
  const detail = readProviderErrorDetail(error);
  return detail
    ? {
        code: detail.code,
        ...(detail.message ? { message: detail.message } : {}),
        recoverable: detail.recoverable,
        providerError: detail,
      }
    : {
        code: "provider-start-failed",
        ...(readErrorMessage(error) ? { message: readErrorMessage(error) } : {}),
        recoverable: true,
      };
}

function readProviderErrorDetail(error: unknown): SpeechProviderError | undefined {
  if (typeof error !== "object" || error === null || !("detail" in error)) return undefined;
  const detail = error.detail;
  if (
    typeof detail !== "object"
    || detail === null
    || !("code" in detail)
    || !("recoverable" in detail)
    || !("retryPolicy" in detail)
  ) return undefined;
  return detail as SpeechProviderError;
}

function readErrorMessage(error: unknown): string | undefined {
  return typeof error === "object"
    && error !== null
    && "message" in error
    && typeof error.message === "string"
    ? error.message
    : undefined;
}

function assignOptionalTimes(
  target: ActiveVoiceTurnSnapshot | VoiceTurnRecord,
  runtime: ActiveRuntime,
): void {
  if (runtime.providerStartedAt !== undefined) target.recognitionStartedAt = runtime.providerStartedAt;
  if (runtime.audioStartedAt !== undefined) target.audioStartedAt = runtime.audioStartedAt;
  if (runtime.firstInterimAt !== undefined) target.firstInterimAt = runtime.firstInterimAt;
  if (runtime.firstFinalAt !== undefined) target.firstFinalAt = runtime.firstFinalAt;
  if (runtime.speechEndedAt !== undefined) target.speechEndedAt = runtime.speechEndedAt;
  if (runtime.stopRequestedAt !== undefined) target.stopRequestedAt = runtime.stopRequestedAt;
}

type DurationMetricKey =
  | "requestToRecognitionStartMs"
  | "speechStartToFirstInterimMs"
  | "speechStartToFirstFinalMs"
  | "speechEndToFirstFinalMs"
  | "speechEndToCompletedMs"
  | "totalTurnMs";

function assignDuration(
  metrics: VoiceTurnMetrics,
  key: DurationMetricKey,
  start: number | undefined,
  end: number | undefined,
): void {
  if (start === undefined || end === undefined || end < start) return;
  metrics[key] = end - start;
}

function cloneControllerState(state: VoiceTurnControllerState): VoiceTurnControllerState {
  switch (state.status) {
    case "idle": return { status: "idle" };
    case "starting": return { ...state, config: cloneSpeechRecognitionConfig(state.config) };
    case "capturing": return { status: "capturing", turn: cloneActiveTurn(state.turn) };
    case "finalizing": return { status: "finalizing", turn: cloneActiveTurn(state.turn) };
    case "completed": return { status: "completed", result: cloneVoiceTurnRecord(state.result) };
    case "discarded": return state.record
      ? { status: "discarded", reason: state.reason, record: cloneVoiceTurnRecord(state.record) }
      : { status: "discarded", reason: state.reason };
    case "cancelled": return {
      ...state,
      transcript: cloneTranscript(state.transcript),
      ...(state.frozenContext ? { frozenContext: cloneFrozenContext(state.frozenContext) } : {}),
    };
    case "failed": return {
      ...state,
      error: cloneControllerError(state.error),
      transcript: cloneTranscript(state.transcript),
      ...(state.frozenContext ? { frozenContext: cloneFrozenContext(state.frozenContext) } : {}),
    };
    case "unsupported": return { status: "unsupported", error: cloneControllerError(state.error) };
  }
}

function cloneActiveTurn(turn: ActiveVoiceTurnSnapshot): ActiveVoiceTurnSnapshot {
  return {
    ...turn,
    transcript: cloneTranscript(turn.transcript),
    frozenContext: cloneFrozenContext(turn.frozenContext),
    focusSnapshot: cloneFocusSnapshot(turn.focusSnapshot),
    scene: { ...turn.scene },
    metrics: { ...turn.metrics },
  };
}

function cloneVoiceTurnRecord(record: VoiceTurnRecord): VoiceTurnRecord {
  return {
    ...record,
    finalSegments: record.finalSegments.map((segment) => ({ ...segment })),
    frozenContext: cloneFrozenContext(record.frozenContext),
    focusSnapshot: cloneFocusSnapshot(record.focusSnapshot),
    scene: { ...record.scene },
    metrics: { ...record.metrics },
    ...(record.error ? { error: { ...record.error } } : {}),
  };
}

function cloneTranscript(value: TranscriptAccumulatorSnapshot): TranscriptAccumulatorSnapshot {
  return { ...value, finalSegments: value.finalSegments.map((segment) => ({ ...segment })) };
}

function transcriptFromRecord(record: VoiceTurnRecord): TranscriptAccumulatorSnapshot {
  return {
    finalText: record.rawTranscript,
    interimText: "",
    displayText: record.rawTranscript,
    finalSegments: record.finalSegments.map((segment) => ({ ...segment })),
  };
}

function cloneFocusSnapshot(value: VoiceFocusSnapshot): VoiceFocusSnapshot {
  return { ...value, ...(value.bounds ? { bounds: { ...value.bounds } } : {}) };
}

function cloneFrozenContext(value: FrozenVoiceTurnContext): FrozenVoiceTurnContext {
  return { ...value, ...(value.focusBounds ? { focusBounds: { ...value.focusBounds } } : {}) };
}

function cloneControllerError(value: VoiceTurnControllerError): VoiceTurnControllerError {
  return { ...value, ...(value.providerError ? { providerError: { ...value.providerError } } : {}) };
}

function createDefaultScheduler(): VoiceTurnScheduler {
  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function cloneProviderEvent(event: SpeechProviderEvent): SpeechProviderEvent {
  return event.type === "error"
    ? { ...event, error: { ...event.error } }
    : { ...event };
}
