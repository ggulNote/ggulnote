import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTimeMs } from "@ggulnote/shared-types";
import { GazeWorkerClient } from "./gaze-worker-client";
import type { GazeWorkerRequest } from "./gaze-worker-protocol";

type WorkerMessage = GazeWorkerRequest | { requestId: number; type: "disposed" };

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

function createSessionFrame(id: number) {
  return {
    frameId: id,
    sourceCapturedAt: id as SessionTimeMs,
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
      onLandmarkResult: vi.fn(),
      onNoFace: vi.fn(),
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

    const frame1 = createSessionFrame(1);
    const frame2 = createSessionFrame(2);
    const frame3 = createSessionFrame(3);

    client.processFrame(frame1);
    client.processFrame(frame2);
    client.processFrame(frame3);

    expect(client.getDroppedFrameCount()).toBe(2);

    const firstProcess = fakeWorker.postedMessages.find((item) => item.type === "process-frame");
    expect(firstProcess).toBeDefined();
    expect((firstProcess as { frameId: number }).frameId).toBe(1);
    expect(fakeWorker.postedMessages.filter((item) => item.type === "process-frame").length).toBe(1);

    fakeWorker.emitMessage({
      requestId: (firstProcess as { requestId: number }).requestId,
      type: "landmark-result",
      frameId: 1,
      sourceCapturedAt: 1 as SessionTimeMs,
      frameWidth: 640,
      frameHeight: 480,
      landmarks: [],
      trackingConfidence: null,
      inferenceDurationMs: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const processMessages = fakeWorker.postedMessages.filter((item) => item.type === "process-frame");
    expect(processMessages.length).toBe(2);
    expect(processMessages[1].frameId).toBe(3);
    expect(callbacks.onLandmarkResult).toHaveBeenCalledTimes(1);
  });

  it("is safe when disposed repeatedly", () => {
    const onDisposed = vi.fn();
    const client = new GazeWorkerClient({
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      callbacks: {
        onLandmarkResult: vi.fn(),
        onNoFace: vi.fn(),
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

  it("closes queued bitmaps when disposal happens", () => {
    const frame = createSessionFrame(1);
    const client = new GazeWorkerClient({
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      callbacks: {
        onLandmarkResult: vi.fn(),
        onNoFace: vi.fn(),
        onError: vi.fn(),
        onDisposed: vi.fn(),
      },
      workerFactory: () => fakeWorker as unknown as Worker,
    });

    client.processFrame(frame);
    client.dispose();

    expect((frame.imageBitmap.close as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(fakeWorker.getDisposeRequestId()).toBe(1);
  });
});
