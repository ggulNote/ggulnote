import type { GazeWorkerRawGazeErrorResponse, GazeWorkerRawGazeResultResponse } from "@/features/gaze/worker/gaze-worker-protocol";
import {
  FaceTrackingSession,
  type FaceTrackingSessionCallbacks,
  type FaceTrackingSessionOptions,
  type FaceTrackingSessionStats,
} from "@/features/gaze/runtime/face-tracking-session";
import {
  InteractionClock,
  InteractionTimeline,
  toSessionTimeMs,
} from "@ggulnote/interaction-core";
import type { RawGazeObservation, Vector3 } from "@ggulnote/gaze-core";
import type { TimedGazeSample } from "@ggulnote/interaction-core";
import type { SessionTimeMs } from "@ggulnote/shared-types";
import {
  type BrowserInteractionSessionCallbacks,
  type BrowserInteractionSessionOptions,
  type BrowserInteractionSessionSnapshot,
  type BrowserInteractionSessionStatus,
} from "../types/interaction-session-state";

const DEFAULT_GAZE_TIMELINE_RETENTION_MS = 30_000;
const DIRECTION_LENGTH_MIN = 0.5;
const DIRECTION_LENGTH_MAX = 2.0;

interface TrackingSessionLike {
  start(): Promise<void>;
  stop(): void;
  dispose(): void;
  initializeEyeGeometry(): Promise<void>;
  resetEyeGeometry(): Promise<void>;
}

interface InteractionSessionOptions extends BrowserInteractionSessionOptions {
  readonly sessionFactory?: (
    video: HTMLVideoElement,
    options: FaceTrackingSessionOptions,
    callbacks: FaceTrackingSessionCallbacks,
  ) => TrackingSessionLike;
}

export const GAZE_TIMELINE_RETENTION_MS = DEFAULT_GAZE_TIMELINE_RETENTION_MS;

export class BrowserInteractionSession {
  private readonly timelineRetentionMs: number;
  private readonly sessionFactory: (
    video: HTMLVideoElement,
    options: FaceTrackingSessionOptions,
    callbacks: FaceTrackingSessionCallbacks,
  ) => TrackingSessionLike;

  private readonly callbacks: BrowserInteractionSessionCallbacks;
  private readonly options: InteractionSessionOptions;

  private status: BrowserInteractionSessionStatus = "idle";
  private isStarting = false;

  private runToken = 0;
  private activeRunToken = 0;

  private clock: InteractionClock | null = null;
  private timeline: InteractionTimeline | null = null;
  private trackingSession: TrackingSessionLike | null = null;

  private lastStoredFrameId: number | null = null;
  private lastStoredSourceCapturedAt: SessionTimeMs | null = null;
  private lastStoredProcessingCompletedAt: SessionTimeMs | null = null;
  private lastEndToEndLatencyMs: number | null = null;
  private duplicateFrameCount = 0;
  private oldestSampleAt: SessionTimeMs | null = null;
  private newestSampleAt: SessionTimeMs | null = null;

  private currentStats: FaceTrackingSessionStats | null = null;

  public constructor(callbacks: BrowserInteractionSessionCallbacks, options: InteractionSessionOptions) {
    this.callbacks = callbacks;
    this.options = options;

    this.sessionFactory = options.sessionFactory ?? this.createTrackingSession.bind(this);

    const requestedRetentionMs = options.timelineRetentionMs;
    this.timelineRetentionMs =
      typeof requestedRetentionMs === "number" && Number.isFinite(requestedRetentionMs) && requestedRetentionMs > 0
        ? requestedRetentionMs
        : DEFAULT_GAZE_TIMELINE_RETENTION_MS;
  }

  public async start(): Promise<void> {
    if (this.status === "disposed") {
      throw new Error("This BrowserInteractionSession has been disposed.");
    }

    if (this.status === "running" || this.isStarting) {
      return;
    }

    this.isStarting = true;
    const runToken = ++this.runToken;
    this.activeRunToken = runToken;

    if (this.status === "stopped") {
      this.clearInternal();
    }

    this.clock = new InteractionClock(this.options.timeProvider ?? BrowserInteractionSession.defaultTimeProvider);
    this.timeline = new InteractionTimeline(this.clock, {
      gazeRetentionDurationMs: this.timelineRetentionMs,
    });

    this.trackingSession?.dispose();
    this.trackingSession = this.createSession(this.createSessionCallbacks());

    try {
      await this.trackingSession.start();
      this.status = this.isCurrentRun(runToken) ? "running" : "stopped";
    } catch (error) {
      this.status = "stopped";
      throw error;
    } finally {
      this.isStarting = false;
      this.publishTimelineSnapshot();
    }

    if (!this.isCurrentRun(runToken)) {
      this.trackingSession?.stop();
      return;
    }
  }

  public stop(): void {
    if (this.status !== "running") {
      return;
    }

    this.status = "stopped";
    this.activeRunToken += 1;

    this.trackingSession?.stop();
    this.publishTimelineSnapshot();
  }

  public clear(): void {
    this.clearInternal();
  }

  public dispose(): void {
    if (this.status === "disposed") {
      return;
    }

    this.status = "disposed";
    this.activeRunToken += 1;
    this.trackingSession?.dispose();
    this.trackingSession = null;
    this.timeline?.clear();
    this.timeline = null;
    this.clock = null;
    this.clearCachedState();
    this.publishTimelineSnapshot();
  }

  public getState(): BrowserInteractionSessionSnapshot {
    return {
      status: this.status,
      sessionTime: this.getCurrentSessionTime(),
      timelineRetentionMs: this.timelineRetentionMs,
      timelineSize: this.timeline?.gazeSize ?? 0,
      oldestSampleSourceCapturedAt: this.oldestSampleAt,
      newestSampleSourceCapturedAt: this.newestSampleAt,
      lastStoredFrameId: this.lastStoredFrameId,
      lastStoredSourceCapturedAt: this.lastStoredSourceCapturedAt,
      lastStoredProcessingCompletedAt: this.lastStoredProcessingCompletedAt,
      lastEndToEndLatencyMs: this.lastEndToEndLatencyMs,
      recentOneSecondSampleCount: this.queryRecentGaze(1_000).length,
      duplicateFrameCount: this.duplicateFrameCount,
    };
  }

  public getCurrentSessionTime(): SessionTimeMs {
    return this.clock?.now() ?? toSessionTimeMs(0);
  }

  public getClock(): InteractionClock {
    return this.getActiveClock();
  }
  public queryGaze(range: { readonly startAt: SessionTimeMs; readonly endAt: SessionTimeMs }): readonly TimedGazeSample[];
  public queryGaze(startAt: SessionTimeMs, endAt: SessionTimeMs): readonly TimedGazeSample[];
  public queryGaze(
    arg1: SessionTimeMs | { readonly startAt: SessionTimeMs; readonly endAt: SessionTimeMs },
    arg2?: SessionTimeMs,
  ): readonly TimedGazeSample[] {
    if (!this.timeline) {
      return [];
    }

    const range = typeof arg1 === "number"
      ? { startAt: arg1, endAt: arg2 ?? arg1 }
      : arg1;

    return this.timeline.queryGaze(range.startAt, range.endAt);
  }

  public queryRecentGaze(durationMs: number): readonly TimedGazeSample[] {
    if (!this.timeline) {
      return [];
    }

    return this.timeline.queryRecentGaze(durationMs);
  }

  public getStats(): Readonly<FaceTrackingSessionStats> | null {
    return this.currentStats;
  }

  public async initializeEyeGeometry(): Promise<void> {
    if (!this.trackingSession || this.status !== "running") {
      throw new Error("Tracking session is not running.");
    }

    await this.trackingSession.initializeEyeGeometry();
  }

  public async resetEyeGeometry(): Promise<void> {
    if (!this.trackingSession || this.status !== "running") {
      throw new Error("Tracking session is not running.");
    }

    await this.trackingSession.resetEyeGeometry();
  }

  private createSessionCallbacks(): FaceTrackingSessionCallbacks {
    return {
      onStatsChange: (stats) => {
        if (!this.isTrackingSessionActive()) {
          return;
        }

        this.currentStats = stats;
        this.callbacks.onTrackingStatsChange(stats);
      },
      onLandmarkFrame: (frame, irisState) => {
        if (!this.isTrackingSessionActive()) {
          return;
        }

        this.callbacks.onLandmarkFrame(frame, irisState);
      },
      onNoFace: (frameId) => {
        if (!this.isTrackingSessionActive()) {
          return;
        }

        this.callbacks.onNoFace(frameId);
      },
      onError: (error) => {
        if (!this.isTrackingSessionActive()) {
          return;
        }

        this.callbacks.onError(error);
      },
      onRawGazeResult: (response) => {
        this.handleRawGazeResult(response);
      },
      onRawGazeError: (response) => {
        this.handleRawGazeError(response);
      },
    };
  }

  private isTrackingSessionActive(): boolean {
    return this.status === "running" && this.timeline !== null && this.isCurrentRun(this.activeRunToken);
  }

  private isCurrentRun(token: number): boolean {
    return this.status !== "disposed" && token === this.activeRunToken;
  }

  private handleRawGazeResult(response: GazeWorkerRawGazeResultResponse): void {
    if (!this.isTrackingSessionActive()) {
      return;
    }

    const observation: RawGazeObservation = {
      ...response.result.observation,
      processingCompletedAt: this.getCurrentSessionTime(),
    };

    if (this.shouldRejectFrame(response.frame.frameId, observation)) {
      return;
    }

    if (!this.timeline) {
      return;
    }

    let sample: TimedGazeSample;
    try {
      let rawSample: TimedGazeSample = {
        time: toSessionTimeMs(observation.sourceCapturedAt),
        observation,
        calibratedViewportPoint: null,
        gazeRoi95: null,
        pdfHit: null,
        calibration: null,
      };

      const transformed = this.options.timelineSampleTransformer?.(rawSample);
      if (transformed) {
        rawSample = { ...rawSample, ...transformed };
      }

      sample = this.timeline.append(rawSample);
    } catch (error) {
      this.duplicateFrameCount += 1;
      return;
    }

    this.lastStoredFrameId = response.frame.frameId;
    this.lastStoredSourceCapturedAt = sample.time;
    this.lastStoredProcessingCompletedAt = sample.observation.processingCompletedAt;

    const latency = Number(sample.observation.processingCompletedAt) - Number(sample.time);
    if (Number.isFinite(latency)) {
      this.lastEndToEndLatencyMs = Math.max(0, latency);
    }

    const samples = this.timeline.queryGaze(toSessionTimeMs(0), this.timeline.sessionTime);
    if (samples.length > 0) {
      this.oldestSampleAt = samples[0].time;
      this.newestSampleAt = samples[samples.length - 1].time;
    }

    this.callbacks.onRawGazeSample?.(sample);
    this.publishTimelineSnapshot();
  }

  private handleRawGazeError(response: GazeWorkerRawGazeErrorResponse): void {
    if (!this.isTrackingSessionActive()) {
      return;
    }

    this.callbacks.onError({
      code: "raw-gaze-error",
      message: response.message,
    });
  }

  private shouldRejectFrame(frameId: number, observation: RawGazeObservation): boolean {
    if (typeof frameId !== "number" || frameId <= 0) {
      this.duplicateFrameCount += 1;
      return true;
    }

    if (this.lastStoredFrameId !== null && frameId <= this.lastStoredFrameId) {
      this.duplicateFrameCount += 1;
      return true;
    }

    if (!this.isValidDirections(observation)) {
      this.duplicateFrameCount += 1;
      return true;
    }

    return false;
  }

  private isValidDirections(observation: RawGazeObservation): boolean {
    const vectors: Vector3[] = [
      observation.leftDirection,
      observation.rightDirection,
      observation.rawCombinedDirection,
      observation.smoothedCombinedDirection,
    ];

    return vectors.every(isValidDirection);
  }

  private clearInternal(): void {
    this.timeline?.clear();
    this.lastStoredFrameId = null;
    this.lastStoredSourceCapturedAt = null;
    this.lastStoredProcessingCompletedAt = null;
    this.lastEndToEndLatencyMs = null;
    this.duplicateFrameCount = 0;
    this.oldestSampleAt = null;
    this.newestSampleAt = null;
    this.publishTimelineSnapshot();
  }

  private clearCachedState(): void {
    this.currentStats = null;
  }

  private publishTimelineSnapshot(): void {
    this.callbacks.onTimelineChange?.(this.getState());
  }

  private createSession(sessionCallbacks: FaceTrackingSessionCallbacks): TrackingSessionLike {
    return this.sessionFactory(
      this.options.video,
      {
        clock: this.getActiveClock(),
        modelUrl: this.options.modelUrl,
        wasmRoot: this.options.wasmRoot,
      },
      sessionCallbacks,
    );
  }

  private createTrackingSession(
    video: HTMLVideoElement,
    options: FaceTrackingSessionOptions,
    callbacks: FaceTrackingSessionCallbacks,
  ): TrackingSessionLike {
    return new FaceTrackingSession(video, options, callbacks);
  }

  private getActiveClock(): InteractionClock {
    if (!this.clock) {
      throw new Error("Interaction clock is not initialized.");
    }

    return this.clock;
  }

  private static defaultTimeProvider(): number {
    return performance.now();
  }
}

function isValidDirection(value: Vector3): boolean {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
    return false;
  }

  const length = Math.hypot(value.x, value.y, value.z);
  return Number.isFinite(length) && length >= DIRECTION_LENGTH_MIN && length <= DIRECTION_LENGTH_MAX;
}





