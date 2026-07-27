import { FaceLandmarkFrame } from "@ggulnote/gaze-core";
import { InteractionClock } from "@ggulnote/interaction-core";
import { adaptFaceLandmarkResult } from "../mediapipe/face-landmark-adapter";
import { WebcamCapture, WebcamCaptureError } from "../capture/webcam-capture";
import { FrameScheduler, type CapturedVideoFrame } from "../capture/frame-scheduler";
import { GazeWorkerClient, type GazeWorkerClientConfig } from "../worker/gaze-worker-client";
import {
  type GazeWorkerDisposedResponse,
  type GazeWorkerErrorResponse,
  type GazeWorkerLandmarkResultResponse,
  type GazeWorkerNoFaceResponse,
} from "../worker/gaze-worker-protocol";

type SessionStatus =
  | "idle"
  | "requesting-camera"
  | "loading-model"
  | "running"
  | "stopped"
  | "error";

export type SessionErrorCode =
  | "camera-unsupported"
  | "permission-denied"
  | "device-not-found"
  | "camera-in-use"
  | "model-load-failed"
  | "worker-init-failed"
  | "unsupported-landmark-layout"
  | "worker-failed";

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
  readonly droppedFrameCount: number;
  readonly fps: number;
  readonly lastError: SessionError | null;
  readonly frameWidth: number | null;
  readonly frameHeight: number | null;
  readonly trackingConfidence: number | null;
};

type FaceTrackingSessionListener = (stats: Readonly<FaceTrackingSessionStats>) => void;

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
    droppedFrameCount: 0,
    fps: 0,
    lastError: null,
    frameWidth: null,
    frameHeight: null,
    trackingConfidence: null,
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
    if (this.status === "running" || this.status === "requesting-camera" || this.status === "loading-model") {
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
      sourceCapturedAt: null,
      frameWidth: null,
      frameHeight: null,
      trackingConfidence: null,
      faceDetected: false,
      landmarkCount: 0,
      droppedFrameCount: 0,
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
          onLandmarkResult: this.handleLandmarkResult,
          onNoFace: this.handleNoFace,
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
      frameId: this.currentStats.frameId,
      faceDetected: false,
    });
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
    });

    if (!this.workerClient) {
      frame.imageBitmap.close();
      return;
    }

    this.workerClient.processFrame(frame);
  };

  private handleLandmarkResult = (response: GazeWorkerLandmarkResultResponse): void => {
    const processingCompletedAt = this.clock.now();
    const processingLatencyMs = Number(processingCompletedAt - response.sourceCapturedAt);

    this.updateCompletionFps(Number(processingCompletedAt));

    const adapted = adaptFaceLandmarkResult({
      frameId: response.frameId,
      sourceCapturedAt: response.sourceCapturedAt,
      frameWidth: response.frameWidth,
      frameHeight: response.frameHeight,
      rawResult: {
        landmarks: response.landmarks,
        trackingConfidence: response.trackingConfidence,
      },
    });

    if (adapted.kind === "ok") {
      this.updateStats({
        status: "running",
        faceDetected: true,
        landmarkCount: adapted.frame.landmarks.length,
        processingCompletedAt,
        processingLatencyMs,
        inferenceDurationMs: response.inferenceDurationMs,
        frameId: adapted.frame.frameId,
        trackingConfidence: adapted.frame.trackingConfidence,
      });

      this.callbacks.onLandmarkFrame(adapted.frame, {
        hasBothIris: adapted.frame.leftIrisCenter !== null && adapted.frame.rightIrisCenter !== null,
      });
      return;
    }

    if (adapted.kind === "no-face") {
      this.updateStats({
        status: "running",
        faceDetected: false,
        landmarkCount: 0,
        processingCompletedAt,
        processingLatencyMs,
        inferenceDurationMs: response.inferenceDurationMs,
        frameId: response.frameId,
      });
      this.callbacks.onNoFace(response.frameId);
      return;
    }

    this.updateStats({
      status: "error",
      lastError: {
        code: "unsupported-landmark-layout",
        message: adapted.message,
      },
      faceDetected: false,
      processingCompletedAt,
      processingLatencyMs,
      inferenceDurationMs: response.inferenceDurationMs,
      frameId: response.frameId,
    });
    this.callbacks.onError({
      code: "unsupported-landmark-layout",
      message: adapted.message,
    });
  };

  private handleNoFace = (response: GazeWorkerNoFaceResponse): void => {
    this.updateStats({
      status: "running",
      faceDetected: false,
      landmarkCount: 0,
      frameId: response.frameId,
      processingCompletedAt: this.clock.now(),
    });
    this.callbacks.onNoFace(response.frameId);
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
    });

    this.callbacks.onError({ code: "worker-failed", message: response.message });
  };

  private handleWorkerDisposed = (response: GazeWorkerDisposedResponse | null): void => {
    if (response) {
      this.updateStats({ status: "stopped" });
    }
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

    const fps = this.completionTimes.length <= 1
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
