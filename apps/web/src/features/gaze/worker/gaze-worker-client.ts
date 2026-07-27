import {
  type GazeWorkerDisposedResponse,
  type GazeWorkerErrorResponse,
  type GazeWorkerEyeGeometryInitializedResponse,
  type GazeWorkerEyeGeometryResetResponse,
  type GazeWorkerEyeGeometryRequiredResponse,
  type GazeWorkerInitializeRequest,
  type GazeWorkerNoFaceResponse,
  type GazeWorkerProcessFrameRequest,
  type GazeWorkerRawGazeErrorResponse,
  type GazeWorkerRawGazeResultResponse,
  type GazeWorkerReadyResponse,
  type GazeWorkerRequest,
  type GazeWorkerResponse,
  type GazeWorkerResetEyeGeometryRequest,
  type GazeWorkerInitializeEyeGeometryRequest,
} from "./gaze-worker-protocol";
import type { SessionTimeMs } from "@ggulnote/shared-types";
import type { CapturedVideoFrame } from "../capture/frame-scheduler";

type ProcessFrameCallbacks = {
  onRawGazeResult: (response: GazeWorkerRawGazeResultResponse) => void;
  onNoFace: (response: GazeWorkerNoFaceResponse) => void;
  onEyeGeometryRequired: (response: GazeWorkerEyeGeometryRequiredResponse) => void;
  onEyeGeometryInitialized: (response: GazeWorkerEyeGeometryInitializedResponse) => void;
  onEyeGeometryReset: (response: GazeWorkerEyeGeometryResetResponse) => void;
  onRawGazeError: (response: GazeWorkerRawGazeErrorResponse) => void;
  onError: (response: GazeWorkerErrorResponse) => void;
  onDisposed: (response: GazeWorkerDisposedResponse | null) => void;
};

type ResolveRequest = (response: GazeWorkerResponse) => void;
type PendingRequest = { resolve: ResolveRequest; reject: (error: Error) => void };

export interface GazeWorkerClientConfig {
  readonly modelUrl: string;
  readonly wasmRoot: string;
  readonly callbacks: ProcessFrameCallbacks;
  readonly workerFactory?: () => Worker;
}

export class GazeWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private initPromise: Promise<void> | null = null;
  private requestIdSequence = 1;
  private readonly modelUrl: string;
  private readonly wasmRoot: string;
  private readonly callbacks: ProcessFrameCallbacks;
  private disposed = false;
  private busy = false;
  private pendingFrame: CapturedVideoFrame | null = null;
  private droppedFrameCount = 0;
  private isInitialized = false;

  public constructor(config: GazeWorkerClientConfig) {
    this.modelUrl = config.modelUrl;
    this.wasmRoot = config.wasmRoot;
    this.callbacks = config.callbacks;
    this.worker =
      config.workerFactory?.() ??
      new Worker(new URL("./gaze-landmark.worker.ts", import.meta.url), {
        type: "module",
        name: "gaze-landmark",
      });

    this.worker.onmessage = (event: MessageEvent<GazeWorkerResponse>) => {
      const response = event.data;
      const pendingRequest = this.pending.get(response.requestId);
      if (!pendingRequest) {
        if (response.type === "disposed") {
          this.handleDisposedResponse(response);
        }
        return;
      }

      this.pending.delete(response.requestId);
      this.dispatchResponseCallbacks(response);
      pendingRequest.resolve(response);
    };

    this.worker.onerror = (event) => {
      const error = new Error(event.message || "gaze landmark worker failed");
      this.failAllPending(error);
      this.disposed = true;
      this.callbacks.onDisposed(null);
    };
  }

  public async initialize(): Promise<void> {
    if (this.disposed) {
      throw new Error("The gaze worker has already been disposed.");
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    const request = this.createRequest<Omit<GazeWorkerInitializeRequest, "requestId">>({
      type: "initialize",
      modelUrl: this.modelUrl,
      wasmRoot: this.wasmRoot,
    });

    this.initPromise = this.request<typeof request, GazeWorkerReadyResponse>(request).then(() => {
      this.isInitialized = true;
    });

    return this.initPromise;
  }

  public async initializeEyeGeometry(requestAt: SessionTimeMs): Promise<void> {
    if (this.disposed) {
      throw new Error("The gaze worker has already been disposed.");
    }
    if (!this.isInitialized) {
      throw new Error("The gaze worker has not been initialized.");
    }

    const request = this.createRequest<Omit<GazeWorkerInitializeEyeGeometryRequest, "requestId">>({
      type: "initialize-eye-geometry",
      requestAt,
    });

    await this.request(request);
  }

  public async resetEyeGeometry(): Promise<void> {
    if (this.disposed) {
      throw new Error("The gaze worker has already been disposed.");
    }
    if (!this.isInitialized) {
      throw new Error("The gaze worker has not been initialized.");
    }

    const request = this.createRequest<Omit<GazeWorkerResetEyeGeometryRequest, "requestId">>({
      type: "reset-eye-geometry",
    });

    await this.request(request);
  }

  public processFrame(frame: CapturedVideoFrame, processingStartedAt: SessionTimeMs): void {
    if (this.disposed || !this.isInitialized) {
      frame.imageBitmap.close();
      return;
    }

    if (this.busy) {
      this.pendingFrame?.imageBitmap.close();
      this.pendingFrame = frame;
      this.droppedFrameCount += 1;
      return;
    }

    this.busy = true;
    void this.postFrame(frame, processingStartedAt).catch(() => {}).finally(() => {
      this.busy = false;

      const nextFrame = this.pendingFrame;
      if (!nextFrame) {
        return;
      }

      this.pendingFrame = null;
      const startedAt = this.timeNow();
      this.processFrame(nextFrame, startedAt);
    });
  }

  public getDroppedFrameCount(): number {
    return this.droppedFrameCount;
  }

  public resetDroppedFrameCount(): void {
    this.droppedFrameCount = 0;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.busy = false;

    if (this.pendingFrame) {
      this.pendingFrame.imageBitmap.close();
      this.pendingFrame = null;
    }

    if (!this.isInitialized) {
      this.failAllPending(new Error("gaze worker is disposed"));
      this.worker.terminate();
      this.callbacks.onDisposed(null);
      return;
    }

    const request = {
      requestId: this.requestIdSequence,
      type: "dispose" as const,
    };
    this.requestIdSequence += 1;
    this.worker.postMessage(request);
    this.worker.terminate();

    this.failAllPending(new Error("gaze worker is disposed"));
    this.callbacks.onDisposed(null);
  }

  private async postFrame(frame: CapturedVideoFrame, processingStartedAt: SessionTimeMs): Promise<void> {
    const request = this.createRequest<Omit<GazeWorkerProcessFrameRequest, "requestId">>({
      type: "process-frame",
      frameId: frame.frameId,
      sourceCapturedAt: frame.sourceCapturedAt,
      frameWidth: frame.frameWidth,
      frameHeight: frame.frameHeight,
      processingStartedAt,
      imageBitmap: frame.imageBitmap,
    });

    const response = await this.request<typeof request,
      | GazeWorkerRawGazeResultResponse
      | GazeWorkerNoFaceResponse
      | GazeWorkerErrorResponse
      | GazeWorkerEyeGeometryRequiredResponse
      | GazeWorkerRawGazeErrorResponse
      | GazeWorkerDisposedResponse>(request, [frame.imageBitmap]);

    if (response.type === "raw-gaze-result") {
      this.callbacks.onRawGazeResult(response);
      return;
    }

    if (response.type === "no-face") {
      this.callbacks.onNoFace(response);
      return;
    }

    if (response.type === "eye-geometry-required") {
      this.callbacks.onEyeGeometryRequired(response);
      return;
    }

    if (response.type === "raw-gaze-error") {
      this.callbacks.onRawGazeError(response);
      return;
    }

    if (response.type === "disposed") {
      this.callbacks.onDisposed(response);
      return;
    }

    this.callbacks.onError(response);
  }

  private request<TRequest extends GazeWorkerRequest, TResponse extends GazeWorkerResponse>(
    request: TRequest,
    transfer: Transferable[] = [],
  ): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      if (this.disposed) {
        reject(new Error("gaze worker is disposed"));
        return;
      }

      this.pending.set(request.requestId, { resolve: resolve as ResolveRequest, reject });
      this.worker.postMessage(request, transfer);
    });
  }

  private dispatchResponseCallbacks(response: GazeWorkerResponse): void {
    switch (response.type) {
      case "eye-geometry-initialized":
        this.callbacks.onEyeGeometryInitialized(response);
        return;
      case "eye-geometry-reset":
        this.callbacks.onEyeGeometryReset(response);
        return;
      case "disposed":
        this.callbacks.onDisposed(response);
        return;
      default:
        return;
    }
  }

  private handleDisposedResponse(response: GazeWorkerDisposedResponse): void {
    this.disposed = true;
    this.callbacks.onDisposed(response);
  }

  private failAllPending(error: Error): void {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }

  private createRequest<TRequest extends Omit<GazeWorkerRequest, "requestId">>(
    request: TRequest,
  ): TRequest & { requestId: number } {
    const requestId = this.requestIdSequence;
    this.requestIdSequence += 1;
    return { ...request, requestId };
  }

  private timeNow(): SessionTimeMs {
    if (typeof performance === "undefined") {
      return Date.now() as SessionTimeMs;
    }

    return performance.now() as SessionTimeMs;
  }
}
