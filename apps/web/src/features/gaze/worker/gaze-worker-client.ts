import {
  type GazeWorkerDisposedResponse,
  type GazeWorkerErrorResponse,
  type GazeWorkerInitializeRequest,
  type GazeWorkerLandmarkResultResponse,
  type GazeWorkerNoFaceResponse,
  type GazeWorkerProcessFrameRequest,
  type GazeWorkerReadyResponse,
  type GazeWorkerRequest,
  type GazeWorkerResponse,
} from "./gaze-worker-protocol";
import type { CapturedVideoFrame } from "../capture/frame-scheduler";

type ProcessFrameCallbacks = {
  onLandmarkResult: (response: GazeWorkerLandmarkResultResponse) => void;
  onNoFace: (response: GazeWorkerNoFaceResponse) => void;
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
  private disposedEmitted = false;

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
      const request = this.pending.get(response.requestId);
      if (!request) {
        return;
      }

      this.pending.delete(response.requestId);
      request.resolve(response);
    };

    this.worker.onerror = (event) => {
      const error = new Error(event.message || "gaze landmark worker failed");
      for (const request of this.pending.values()) {
        request.reject(error);
      }
      this.pending.clear();
      this.disposed = true;
      this.emitDisposed(null);
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

  public processFrame(frame: CapturedVideoFrame): void {
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
    void this.postFrame(frame).finally(() => {
      this.busy = false;

      const nextFrame = this.pendingFrame;
      if (nextFrame) {
        this.pendingFrame = null;
        this.processFrame(nextFrame);
      }
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

    this.worker.postMessage({ requestId: this.requestIdSequence, type: "dispose" });
    this.requestIdSequence += 1;

    this.worker.terminate();

    for (const requestEntry of this.pending.values()) {
      requestEntry.reject(new Error("gaze worker is disposed"));
    }
    this.pending.clear();
    this.emitDisposed(null);
  }

  public get isBusy(): boolean {
    return this.busy;
  }

  private async postFrame(frame: CapturedVideoFrame): Promise<void> {
    const request = this.createRequest<Omit<GazeWorkerProcessFrameRequest, "requestId">>({
      type: "process-frame",
      frameId: frame.frameId,
      sourceCapturedAt: frame.sourceCapturedAt,
      frameWidth: frame.frameWidth,
      frameHeight: frame.frameHeight,
      imageBitmap: frame.imageBitmap,
    });

    const response = await this.request<typeof request, GazeWorkerLandmarkResultResponse | GazeWorkerNoFaceResponse | GazeWorkerErrorResponse>(
      request,
      [frame.imageBitmap],
    );

    if (response.type === "landmark-result") {
      this.callbacks.onLandmarkResult(response);
      return;
    }

    if (response.type === "no-face") {
      this.callbacks.onNoFace(response);
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

  private createRequest<TRequest extends Omit<GazeWorkerRequest, "requestId">>(
    request: TRequest,
  ): TRequest & { requestId: number } {
    const requestId = this.requestIdSequence;
    this.requestIdSequence += 1;
    return { ...request, requestId };
  }

  private emitDisposed(response: GazeWorkerDisposedResponse | null): void {
    if (this.disposedEmitted) {
      return;
    }
    this.disposedEmitted = true;
    this.callbacks.onDisposed(response);
  }
}
