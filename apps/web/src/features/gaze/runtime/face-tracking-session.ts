import type { FaceLandmarkFrame } from "@ggulnote/gaze-core";
import { InteractionClock } from "@ggulnote/interaction-core";
import { adaptFaceLandmarkResult } from "../mediapipe/face-landmark-adapter";
import { WebcamCapture, WebcamCaptureError } from "../capture/webcam-capture";
import { FrameScheduler, type CapturedVideoFrame } from "../capture/frame-scheduler";
import { GazeWorkerClient, type GazeWorkerClientConfig } from "../worker/gaze-worker-client";
import {
  type GazeWorkerDisposedResponse,
  type GazeWorkerErrorResponse,
  type GazeWorkerEyeGeometryInitializedResponse,
  type GazeWorkerEyeGeometryRequiredResponse,
  type GazeWorkerEyeGeometryResetResponse,
  type GazeWorkerNoFaceResponse,
  type GazeWorkerRawGazeErrorResponse,
  type GazeWorkerRawGazeResultResponse,
} from "../worker/gaze-worker-protocol";

type Vector3 = Readonly<{
  readonly x: number;
  readonly y: number;
  readonly z: number;
}>;

type SessionStatus =
  | "idle"
  | "requesting-camera"
  | "loading-model"
  | "running"
  | "stopped"
  | "error";

type RawGazeStatusCode =
  | "no-face"
  | "eye-geometry-required"
  | "unsupported-landmark-layout"
  | "invalid-head-frame"
  | "invalid-eye-direction"
  | "math-invalid"
  | "missing-eye-geometry"
  | "tracking-lost"
  | "tracking";

export type SessionErrorCode =
  | "camera-unsupported"
  | "permission-denied"
  | "device-not-found"
  | "camera-in-use"
  | "model-load-failed"
  | "worker-init-failed"
  | "unsupported-landmark-layout"
  | "worker-failed"
  | "raw-gaze-error";

export type SessionError = {
  readonly code: SessionErrorCode;
  readonly message: string;
};

export type FaceTrackingSessionStats = {
  readonly status: SessionStatus;
  readonly frameId: number;
  readonly faceDetected: boolean;
  readonly landmarkCount: number;
  readonly sourceCapturedAt: number | null;
  readonly processingStartedAt: number | null;
  readonly processingCompletedAt: number | null;
  readonly processingLatencyMs: number | null;
  readonly inferenceDurationMs: number | null;
  readonly gazeComputationDurationMs: number | null;
  readonly totalWorkerDurationMs: number | null;
  readonly droppedFrameCount: number;
  readonly fps: number;
  readonly lastError: SessionError | null;
  readonly frameWidth: number | null;
  readonly frameHeight: number | null;
  readonly trackingConfidence: number | null;
  readonly rawGazeStatus: RawGazeStatusCode | null;
  readonly rawGazeMessage: string | null;

  readonly leftDirection: Vector3 | null;
  readonly rightDirection: Vector3 | null;
  readonly rawCombinedDirection: Vector3 | null;
  readonly smoothedCombinedDirection: Vector3 | null;
  readonly eyeSphereLeft: Vector3 | null;
  readonly eyeSphereRight: Vector3 | null;
  readonly sampleCount: number | null;

  readonly eyeGeometryInitialized: boolean;
  readonly eyeGeometryInitializedAt: number | null;
  readonly eyeGeometryInitializedFromFrameId: number | null;
};

export interface FaceTrackingSessionOptions {
  readonly clock: InteractionClock;
  readonly modelUrl: string;
  readonly wasmRoot: string;
  readonly workerConfig?: Omit<GazeWorkerClientConfig, "callbacks" | "modelUrl" | "wasmRoot">;
}

export interface FaceTrackingSessionCallbacks {
  onStatsChange: (stats: Readonly<FaceTrackingSessionStats>) => void;
  onLandmarkFrame: (frame: FaceLandmarkFrame, irisState: { hasBothIris: boolean }) => void;
  onNoFace: (frameId: number) => void;
  onError: (error: SessionError) => void;
}

const MAX_FPS_WINDOW_MS = 1_000;

export class FaceTrackingSession {
  private readonly callbacks: FaceTrackingSessionCallbacks;
  private readonly clock: InteractionClock;
  private readonly modelUrl: string;
  private readonly wasmRoot: string;
  private readonly video: HTMLVideoElement;
  private readonly workerConfig?: Omit<GazeWorkerClientConfig, "callbacks" | "modelUrl" | "wasmRoot">;

  private status: SessionStatus = "idle";
  private webcam: WebcamCapture | null = null;
  private scheduler: FrameScheduler | null = null;
  private workerClient: GazeWorkerClient | null = null;

  private currentStats: FaceTrackingSessionStats = {
    status: "idle",
    frameId: 0,
    faceDetected: false,
    landmarkCount: 0,
    sourceCapturedAt: null,
    processingStartedAt: null,
    processingCompletedAt: null,
    processingLatencyMs: null,
    inferenceDurationMs: null,
    gazeComputationDurationMs: null,
    totalWorkerDurationMs: null,
    droppedFrameCount: 0,
    fps: 0,
    lastError: null,
    frameWidth: null,
    frameHeight: null,
    trackingConfidence: null,
    rawGazeStatus: null,
    rawGazeMessage: null,
    leftDirection: null,
    rightDirection: null,
    rawCombinedDirection: null,
    smoothedCombinedDirection: null,
    eyeSphereLeft: null,
    eyeSphereRight: null,
    sampleCount: null,
    eyeGeometryInitialized: false,
    eyeGeometryInitializedAt: null,
    eyeGeometryInitializedFromFrameId: null,
  };

  private completionTimes: number[] = [];

  public constructor(
    video: HTMLVideoElement,
    options: FaceTrackingSessionOptions,
    callbacks: FaceTrackingSessionCallbacks,
  ) {
    this.video = video;
    this.clock = options.clock;
    this.modelUrl = options.modelUrl;
    this.wasmRoot = options.wasmRoot;
    this.workerConfig = options.workerConfig;
    this.callbacks = callbacks;
    this.webcam = new WebcamCapture();
  }

  public get statusValue(): SessionStatus {
    return this.status;
  }

  public get stats(): Readonly<FaceTrackingSessionStats> {
    return this.currentStats;
  }

  public async start(): Promise<void> {
    if (
      this.status === "running" ||
      this.status === "requesting-camera" ||
      this.status === "loading-model"
    ) {
      return;
    }

    this.resetWorkerStats();
    this.completionTimes = [];
    this.updateStats({
      status: "requesting-camera",
      lastError: null,
      processingStartedAt: null,
      processingCompletedAt: null,
      processingLatencyMs: null,
      inferenceDurationMs: null,
      totalWorkerDurationMs: null,
      sourceCapturedAt: null,
      frameWidth: null,
      frameHeight: null,
      trackingConfidence: null,
      faceDetected: false,
      landmarkCount: 0,
      droppedFrameCount: 0,
      gazeComputationDurationMs: null,
      rawGazeStatus: null,
      rawGazeMessage: null,
      leftDirection: null,
      rightDirection: null,
      rawCombinedDirection: null,
      smoothedCombinedDirection: null,
      eyeSphereLeft: null,
      eyeSphereRight: null,
      sampleCount: null,
      eyeGeometryInitialized: false,
      eyeGeometryInitializedAt: null,
      eyeGeometryInitializedFromFrameId: null,
    });

    try {
      if (!this.webcam) {
        this.webcam = new WebcamCapture();
      }

      const stream = await this.webcam.open();
      this.video.srcObject = stream;

      if (this.video.paused) {
        await this.video.play();
      }

      this.updateStats({
        status: "loading-model",
        frameWidth: this.video.videoWidth,
        frameHeight: this.video.videoHeight,
      });

      this.workerClient = new GazeWorkerClient({
        modelUrl: this.modelUrl,
        wasmRoot: this.wasmRoot,
        ...this.workerConfig,
        callbacks: {
          onDisposed: this.handleWorkerDisposed,
          onError: this.handleWorkerError,
          onRawGazeResult: this.handleRawGazeResult,
          onNoFace: this.handleNoFace,
          onEyeGeometryRequired: this.handleEyeGeometryRequired,
          onEyeGeometryInitialized: this.handleEyeGeometryInitialized,
          onEyeGeometryReset: this.handleEyeGeometryReset,
          onRawGazeError: this.handleRawGazeError,
        },
      });

      await this.workerClient.initialize();

      this.scheduler = new FrameScheduler(this.video, this.clock, this.handleFrame);
      this.scheduler.start();
      this.updateStats({ status: "running" });
    } catch (error: unknown) {
      this.applyStartError(error);
      throw error;
    }
  }

  public stop(): void {
    if (this.status === "stopped") {
      return;
    }

    this.scheduler?.stop();
    this.scheduler = null;

    this.workerClient?.dispose();
    this.workerClient = null;

    if (this.video.srcObject instanceof MediaStream) {
      for (const track of this.video.srcObject.getTracks()) {
        track.stop();
      }
      this.video.srcObject = null;
    }
    this.webcam?.close();

    this.completionTimes = [];
    this.updateStats({
      status: "stopped",
      faceDetected: false,
      eyeGeometryInitialized: false,
      eyeGeometryInitializedAt: null,
      eyeGeometryInitializedFromFrameId: null,
    });
  }

  public async initializeEyeGeometry(): Promise<void> {
    if (!this.workerClient) {
      throw new Error("Tracking session is not running.");
    }

    await this.workerClient.initializeEyeGeometry(this.clock.now());
  }

  public async resetEyeGeometry(): Promise<void> {
    if (!this.workerClient) {
      return;
    }

    await this.workerClient.resetEyeGeometry();
  }

  public dispose(): void {
    this.stop();
    this.webcam = null;
  }

  private handleFrame = (frame: CapturedVideoFrame): void => {
    const processingStartedAt = this.clock.now();
    this.updateStats({
      status: "running",
      sourceCapturedAt: frame.sourceCapturedAt,
      processingStartedAt,
      frameId: frame.frameId,
      frameWidth: frame.frameWidth,
      frameHeight: frame.frameHeight,
      rawGazeStatus: this.currentStats.rawGazeStatus,
    });

    if (!this.workerClient) {
      frame.imageBitmap.close();
      return;
    }

    this.workerClient.processFrame(frame, processingStartedAt);
  };

  private handleRawGazeResult = (response: GazeWorkerRawGazeResultResponse): void => {
    const processingCompletedAt = this.clock.now();
    const processingLatencyMs = Number(processingCompletedAt - response.frame.sourceCapturedAt);
    const observedFrame = {
      ...response.result.observation,
      processingCompletedAt,
    };

    this.updateCompletionFps(Number(processingCompletedAt));

    const result = response.result;
    this.updateStats({
      status: "running",
      faceDetected: true,
      landmarkCount: response.frame.landmarks.length,
      processingCompletedAt,
      processingLatencyMs,
      inferenceDurationMs: response.inferenceDurationMs,
      gazeComputationDurationMs: response.gazeComputationDurationMs,
      totalWorkerDurationMs: response.totalWorkerDurationMs,
      frameId: response.frame.frameId,
      frameWidth: response.frame.frameWidth,
      frameHeight: response.frame.frameHeight,
      trackingConfidence: observedFrame.quality.trackingConfidence,
      sourceCapturedAt: result.sourceCapturedAt,
      rawGazeStatus: "tracking",
      rawGazeMessage: null,
      leftDirection: observedFrame.leftDirection,
      rightDirection: observedFrame.rightDirection,
      rawCombinedDirection: observedFrame.rawCombinedDirection,
      smoothedCombinedDirection: observedFrame.smoothedCombinedDirection,
      eyeSphereLeft: result.eyeSpheres.leftEyeSphereCenter,
      eyeSphereRight: result.eyeSpheres.rightEyeSphereCenter,
      sampleCount: observedFrame.smoothing.sampleCount,
      lastError: null,
    });

    const adapted = adaptFaceLandmarkResult({
      frameId: response.frame.frameId,
      sourceCapturedAt: response.result.sourceCapturedAt,
      frameWidth: response.frame.frameWidth,
      frameHeight: response.frame.frameHeight,
      rawResult: {
        landmarks: response.frame.landmarks,
        trackingConfidence: response.result.observation.quality.trackingConfidence,
      },
    });

    if (adapted.kind === "ok") {
      this.callbacks.onLandmarkFrame(adapted.frame, {
        hasBothIris:
          adapted.frame.leftIrisCenter !== null && adapted.frame.rightIrisCenter !== null,
      });
    }
  };

  private handleNoFace = (response: GazeWorkerNoFaceResponse): void => {
    this.updateStats({
      status: "running",
      faceDetected: false,
      landmarkCount: 0,
      frameId: response.frameId,
      sourceCapturedAt: response.sourceCapturedAt,
      processingCompletedAt: this.clock.now(),
      processingLatencyMs: null,
      rawGazeStatus: "no-face",
      rawGazeMessage: null,
      inferenceDurationMs: response.inferenceDurationMs,
      gazeComputationDurationMs: null,
      totalWorkerDurationMs: null,
      leftDirection: null,
      rightDirection: null,
      rawCombinedDirection: null,
      smoothedCombinedDirection: null,
      eyeSphereLeft: null,
      eyeSphereRight: null,
      sampleCount: null,
    });

    this.callbacks.onNoFace(response.frameId);
  };

  private handleEyeGeometryRequired = (response: GazeWorkerEyeGeometryRequiredResponse): void => {
    this.updateStats({
      rawGazeStatus: "eye-geometry-required",
      rawGazeMessage: response.message,
      eyeGeometryInitialized: false,
      lastError: {
        code: "unsupported-landmark-layout",
        message: response.message,
      },
      status: response.frame ? "running" : "error",
      frameWidth: response.frame?.frameWidth ?? this.currentStats.frameWidth,
      frameHeight: response.frame?.frameHeight ?? this.currentStats.frameHeight,
      faceDetected: !!response.frame,
      landmarkCount: response.frame?.landmarks.length ?? 0,
      leftDirection: null,
      rightDirection: null,
      rawCombinedDirection: null,
      smoothedCombinedDirection: null,
      eyeSphereLeft: null,
      eyeSphereRight: null,
      sampleCount: null,
    });

    if (response.frame) {
      this.callbacks.onLandmarkFrame(response.frame, {
        hasBothIris:
          response.frame.landmarks.length > 473,
      });
    }
  };

  private handleEyeGeometryInitialized = (response: GazeWorkerEyeGeometryInitializedResponse): void => {
    this.updateStats({
      rawGazeStatus: "tracking",
      rawGazeMessage: null,
      eyeGeometryInitialized: true,
      eyeGeometryInitializedAt: response.sourceCapturedAt,
      eyeGeometryInitializedFromFrameId: response.frameId,
      status: "running",
      lastError: null,
    });
  };

  private handleEyeGeometryReset = (_response: GazeWorkerEyeGeometryResetResponse): void => {
    this.updateStats({
      eyeGeometryInitialized: false,
      eyeGeometryInitializedAt: null,
      eyeGeometryInitializedFromFrameId: null,
      rawGazeStatus: "eye-geometry-required",
      rawGazeMessage: "Eye geometry reset. Re-initialize required.",
      status: "running",
      lastError: null,
    });
  };

  private handleRawGazeError = (response: GazeWorkerRawGazeErrorResponse): void => {
    this.updateStats({
      rawGazeStatus: response.code === "missing-eye-geometry" ? "eye-geometry-required" : "tracking-lost",
      rawGazeMessage: response.message,
      lastError: {
        code: "raw-gaze-error",
        message: response.message,
      },
      status: "error",
      processingCompletedAt: this.clock.now(),
      processingLatencyMs: null,
      leftDirection: null,
      rightDirection: null,
      rawCombinedDirection: null,
      smoothedCombinedDirection: null,
      eyeSphereLeft: null,
      eyeSphereRight: null,
      sampleCount: null,
      frameId: response.frameId,
      sourceCapturedAt: response.sourceCapturedAt,
    });
  };

  private handleWorkerError = (response: GazeWorkerErrorResponse): void => {
    this.updateStats({
      status: "error",
      lastError: {
        code: "worker-failed",
        message: response.message,
      },
      faceDetected: false,
      processingCompletedAt: this.clock.now(),
      rawGazeStatus: "tracking-lost",
    });

    this.callbacks.onError({
      code: "worker-failed",
      message: response.message,
    });
  };

  private handleWorkerDisposed = (_response: GazeWorkerDisposedResponse | null): void => {
    this.updateStats({ status: "stopped" });
  };

  private applyStartError(error: unknown): void {
    if (error instanceof WebcamCaptureError) {
      const code: SessionErrorCode =
        error.kind === "unsupported"
          ? "camera-unsupported"
          : error.kind === "permission-denied"
            ? "permission-denied"
            : error.kind === "device-not-found"
              ? "device-not-found"
              : "camera-in-use";

      this.updateStats({
        status: "error",
        lastError: { code, message: error.message },
      });
      this.callbacks.onError({ code, message: error.message });
      this.stop();
      return;
    }

    const message = error instanceof Error ? error.message : "Failed to start face tracking.";
    const code: SessionErrorCode = message.includes("initialize") ? "worker-init-failed" : "model-load-failed";

    this.updateStats({
      status: "error",
      lastError: { code, message },
    });
    this.callbacks.onError({ code, message });
    this.stop();
  }

  private updateCompletionFps(nowMs: number): void {
    this.completionTimes.push(nowMs);
    const deadline = nowMs - MAX_FPS_WINDOW_MS;
    while (this.completionTimes.length > 0 && this.completionTimes[0] < deadline) {
      this.completionTimes.shift();
    }

    const fps =
      this.completionTimes.length <= 1
        ? 0
        : Math.round((this.completionTimes.length - 1) / (MAX_FPS_WINDOW_MS / 1000) * 10) / 10;
    this.updateStats({ fps });
  }

  private updateStats(partial: Partial<FaceTrackingSessionStats>): void {
    const droppedFrameCount = this.workerClient?.getDroppedFrameCount() ?? this.currentStats.droppedFrameCount;
    this.currentStats = { ...this.currentStats, ...partial, droppedFrameCount };
    this.status = this.currentStats.status;
    this.callbacks.onStatsChange(this.currentStats);
  }

  private resetWorkerStats(): void {
    this.workerClient?.resetDroppedFrameCount();
  }
}
