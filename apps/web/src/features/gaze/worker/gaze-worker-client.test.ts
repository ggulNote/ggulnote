import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTimeMs } from "@ggulnote/shared-types";
import { GazeWorkerClient } from "./gaze-worker-client";
import type { GazeWorkerRequest } from "./gaze-worker-protocol";

type WorkerMessage = GazeWorkerRequest | { requestId: number; type: "disposed" };

type ResponseByType = {
  type: string;
  [key: string]: unknown;
};

class FakeWorker {
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public postedMessages: WorkerMessage[] = [];
  public terminate = vi.fn();

  public postMessage(message: WorkerMessage): void {
    this.postedMessages.push(message);

    if (message.type === "initialize") {
      const response = { requestId: message.requestId, type: "ready" };
      setTimeout(() => {
        this.emitMessage(response);
      }, 0);
      return;
    }

    if (message.type === "dispose") {
      const response = { requestId: message.requestId, type: "disposed" };
      setTimeout(() => {
        this.emitMessage(response);
      }, 0);
    }
  }

  public emitMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }

  public getDisposeRequestId(): number | null {
    for (let i = this.postedMessages.length - 1; i >= 0; i -= 1) {
      const message = this.postedMessages[i];
      if (message.type === "dispose") {
        return message.requestId;
      }
    }

    return null;
  }
}

function bitmapWithSize(width: number, height: number): ImageBitmap {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

function createSessionFrame(id: number, sourceAt: number) {
  return {
    frameId: id,
    sourceCapturedAt: sourceAt as SessionTimeMs,
    imageBitmap: bitmapWithSize(1, 1),
    frameWidth: 640,
    frameHeight: 480,
  };
}

describe("GazeWorkerClient", () => {
  let fakeWorker: FakeWorker;

  beforeEach(() => {
    fakeWorker = new FakeWorker();
  });

  it("keeps monotonic processing by processing only the newest queued frame", async () => {
    const callbacks = {
      onRawGazeResult: vi.fn(),
      onNoFace: vi.fn(),
      onEyeGeometryRequired: vi.fn(),
      onEyeGeometryInitialized: vi.fn(),
      onEyeGeometryReset: vi.fn(),
      onRawGazeError: vi.fn(),
      onError: vi.fn(),
      onDisposed: vi.fn(),
    };

    const client = new GazeWorkerClient({
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      callbacks,
      workerFactory: () => fakeWorker as unknown as Worker,
    });

    await client.initialize();

    const frame1 = createSessionFrame(1, 1000);
    const frame2 = createSessionFrame(2, 1010);
    const frame3 = createSessionFrame(3, 1020);

    client.processFrame(frame1, 1000 as SessionTimeMs);
    client.processFrame(frame2, 1010 as SessionTimeMs);
    client.processFrame(frame3, 1020 as SessionTimeMs);

    expect(client.getDroppedFrameCount()).toBe(2);

    const firstProcess = fakeWorker.postedMessages.find((item) => item.type === "process-frame");
    expect(firstProcess).toBeDefined();
    expect((firstProcess as { frameId: number }).frameId).toBe(1);
    expect(fakeWorker.postedMessages.filter((item) => item.type === "process-frame").length).toBe(1);

    fakeWorker.emitMessage({
      requestId: (firstProcess as { requestId: number }).requestId,
      type: "raw-gaze-result",
      frame: {
        frameId: 1,
        sourceCapturedAt: 1000 as SessionTimeMs,
        frameWidth: 640,
        frameHeight: 480,
        landmarks: [],
        trackingConfidence: null,
      },
      result: {
        kind: "tracking",
        frameId: 1,
        sourceCapturedAt: 1000 as SessionTimeMs,
        observation: {
          frameId: 1,
          sourceCapturedAt: 1000 as SessionTimeMs,
          processingStartedAt: 1000 as SessionTimeMs,
          processingCompletedAt: 1000 as SessionTimeMs,
          leftDirection: { x: 0, y: 0, z: 1 },
          rightDirection: { x: 0, y: 0, z: 1 },
          rawCombinedDirection: { x: 0, y: 0, z: 1 },
          smoothedCombinedDirection: { x: 0, y: 0, z: 1 },
          head: {
            center: { x: 0, y: 0, z: 0 },
            rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            faceScale: 1,
          },
          smoothing: {
            sampleCount: 1,
            windowStartedAt: 1000 as SessionTimeMs,
            windowEndedAt: 1000 as SessionTimeMs,
          },
          quality: {
            faceDetected: true,
            leftEyeReady: true,
            rightEyeReady: true,
            trackingConfidence: null,
          },
        },
        eyeSpheres: {
          leftEyeSphereCenter: { x: 0, y: 0, z: 0 },
          rightEyeSphereCenter: { x: 0, y: 0, z: 0 },
        },
        timingMs: {
          gazeComputationDurationMs: 0,
          totalWorkerDurationMs: 0,
        },
      },
      inferenceDurationMs: 1,
      gazeComputationDurationMs: 0,
      totalWorkerDurationMs: 1,
    } as ResponseByType);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const processMessages = fakeWorker.postedMessages.filter((item) => item.type === "process-frame");
    expect(processMessages.length).toBe(2);
    expect(processMessages[1]).toMatchObject({ type: "process-frame", frameId: 3 });
    expect(callbacks.onRawGazeResult).toHaveBeenCalledTimes(1);
  });

  it("is safe when disposed repeatedly", () => {
    const onDisposed = vi.fn();
    const client = new GazeWorkerClient({
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      callbacks: {
        onRawGazeResult: vi.fn(),
        onNoFace: vi.fn(),
        onEyeGeometryRequired: vi.fn(),
        onEyeGeometryInitialized: vi.fn(),
        onEyeGeometryReset: vi.fn(),
        onRawGazeError: vi.fn(),
        onError: vi.fn(),
        onDisposed,
      },
      workerFactory: () => fakeWorker as unknown as Worker,
    });

    expect(() => {
      client.dispose();
      client.dispose();
    }).not.toThrow();

    expect(onDisposed).toHaveBeenCalledTimes(1);
  });

  it("closes queued bitmaps when disposal happens", async () => {
    const initialFrame = createSessionFrame(1, 1000);
    const queuedFrame = createSessionFrame(2, 1010);
    const callbacks = {
      onRawGazeResult: vi.fn(),
      onNoFace: vi.fn(),
      onEyeGeometryRequired: vi.fn(),
      onEyeGeometryInitialized: vi.fn(),
      onEyeGeometryReset: vi.fn(),
      onRawGazeError: vi.fn(),
      onError: vi.fn(),
      onDisposed: vi.fn(),
    };

    const client = new GazeWorkerClient({
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      callbacks,
      workerFactory: () => fakeWorker as unknown as Worker,
    });

    await client.initialize();
    client.processFrame(initialFrame, 1000 as SessionTimeMs);
    client.processFrame(queuedFrame, 1010 as SessionTimeMs);

    client.dispose();

    expect(
      (queuedFrame.imageBitmap.close as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(1);
    expect(initialFrame.imageBitmap.close).toBeDefined();
    expect(fakeWorker.postedMessages.some((message) => message.type === "dispose")).toBe(true);
    expect(
      callbacks.onDisposed.mock.calls.length,
    ).toBe(1);
  });
});
