import type { FaceLandmarkFrame, RawGazeObservation } from "@ggulnote/gaze-core";
import { toSessionTimeMs, type TimedGazeSample } from "@ggulnote/interaction-core";
import { describe, expect, it, vi } from "vitest";
import type {
  FaceTrackingSessionCallbacks,
  FaceTrackingSessionOptions,
} from "../../gaze/runtime/face-tracking-session";
import type {
  GazeWorkerRawGazeErrorResponse,
  GazeWorkerRawGazeResultResponse,
} from "../../gaze/worker/gaze-worker-protocol";
import type { BrowserInteractionSessionCallbacks } from "../types/interaction-session-state";
import { BrowserInteractionSession } from "./browser-interaction-session";

type FakeTrackingSession = {
  start(): Promise<void>;
  stop(): void;
  dispose(): void;
  initializeEyeGeometry(): Promise<void>;
  resetEyeGeometry(): Promise<void>;
  emitResult(response: GazeWorkerRawGazeResultResponse): void;
  emitError(response: GazeWorkerRawGazeErrorResponse): void;
};

function createFactory() {
  const sessions: FakeTrackingSession[] = [];
  const sessionFactory = (
    _video: HTMLVideoElement,
    _options: FaceTrackingSessionOptions,
    callbacks: FaceTrackingSessionCallbacks,
  ): FakeTrackingSession => {
    const session: FakeTrackingSession = {
      start: async () => undefined,
      stop: () => undefined,
      dispose: () => undefined,
      initializeEyeGeometry: async () => undefined,
      resetEyeGeometry: async () => undefined,
      emitResult: (value) => callbacks.onRawGazeResult?.(value),
      emitError: (value) => callbacks.onRawGazeError?.(value),
    };
    sessions.push(session);
    return session;
  };
  return { sessions, sessionFactory };
}

function observation(frameId: number, time: number): RawGazeObservation {
  return {
    frameId,
    sourceCapturedAt: toSessionTimeMs(time),
    processingStartedAt: toSessionTimeMs(time + 1),
    processingCompletedAt: toSessionTimeMs(time + 2),
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
      windowStartedAt: toSessionTimeMs(time),
      windowEndedAt: toSessionTimeMs(time),
    },
    quality: {
      faceDetected: true,
      leftEyeReady: true,
      rightEyeReady: true,
      trackingConfidence: 1,
    },
  };
}

function response(frameId: number, time: number): GazeWorkerRawGazeResultResponse {
  const frame: FaceLandmarkFrame = {
    frameId,
    sourceCapturedAt: toSessionTimeMs(time),
    frameWidth: 640,
    frameHeight: 480,
    landmarks: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
    ],
    trackingConfidence: 1,
  };
  return {
    requestId: frameId,
    type: "raw-gaze-result",
    frame,
    result: {
      kind: "tracking",
      frameId,
      sourceCapturedAt: toSessionTimeMs(time),
      observation: observation(frameId, time),
      eyeSpheres: {
        leftEyeSphereCenter: { x: 0, y: 0, z: 0 },
        rightEyeSphereCenter: { x: 0, y: 0, z: 0 },
      },
      timingMs: { gazeComputationDurationMs: 1, totalWorkerDurationMs: 2 },
    },
    inferenceDurationMs: 1,
    gazeComputationDurationMs: 1,
    totalWorkerDurationMs: 2,
  };
}

function rawError(frameId: number): GazeWorkerRawGazeErrorResponse {
  return {
    requestId: frameId,
    type: "raw-gaze-error",
    frameId,
    sourceCapturedAt: toSessionTimeMs(5),
    code: "math-invalid",
    message: "invalid",
  };
}

function callbacks(onRawGazeSample = vi.fn()): BrowserInteractionSessionCallbacks {
  return {
    onTrackingStatsChange: vi.fn(),
    onLandmarkFrame: vi.fn(),
    onNoFace: vi.fn(),
    onError: vi.fn(),
    onRawGazeSample,
  };
}

describe("BrowserInteractionSession timeline transformer", () => {
  it("runs enrichment after guards and preserves InteractionClock timing", async () => {
    let now = 0;
    const factory = createFactory();
    const onRawGazeSample = vi.fn();
    const transformer = vi.fn((_sample: TimedGazeSample) => ({
      calibration: { profileId: "a", version: "v1", quality: "valid" as const },
      calibratedViewportPoint: { x: 10, y: 20 },
    }));
    const session = new BrowserInteractionSession(callbacks(onRawGazeSample), {
      video: document.createElement("video"),
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      timeProvider: () => now,
      sessionFactory: factory.sessionFactory,
      timelineSampleTransformer: transformer,
    });
    await session.start();
    now = 20;
    factory.sessions[0].emitResult(response(1, 10));

    expect(transformer).toHaveBeenCalledTimes(1);
    expect(onRawGazeSample).toHaveBeenCalledTimes(1);
    const stored = session.queryGaze(toSessionTimeMs(0), toSessionTimeMs(20));
    expect(stored).toHaveLength(1);
    expect(stored[0].time).toBe(10);
    expect(stored[0].observation.processingCompletedAt).toBe(20);
    expect(stored[0].calibration?.profileId).toBe("a");
    session.dispose();
  });

  it("does not transform worker errors, duplicate frames, or late samples", async () => {
    const factory = createFactory();
    const transformer = vi.fn(() => ({}));
    const session = new BrowserInteractionSession(callbacks(), {
      video: document.createElement("video"),
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      timeProvider: () => 50,
      sessionFactory: factory.sessionFactory,
      timelineSampleTransformer: transformer,
    });
    await session.start();
    const tracking = factory.sessions[0];
    tracking.emitError(rawError(1));
    tracking.emitResult(response(2, 20));
    tracking.emitResult(response(2, 20));
    tracking.emitResult(response(3, 10));

    expect(transformer).toHaveBeenCalledTimes(1);
    expect(session.queryGaze(toSessionTimeMs(0), toSessionTimeMs(50))).toHaveLength(1);
    expect(session.getState().duplicateFrameCount).toBe(2);
    session.dispose();
  });

  it("keeps raw timeline behavior without a transformer and after transformer failure", async () => {
    const withoutFactory = createFactory();
    const without = new BrowserInteractionSession(callbacks(), {
      video: document.createElement("video"),
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      timeProvider: () => 30,
      sessionFactory: withoutFactory.sessionFactory,
    });
    await without.start();
    withoutFactory.sessions[0].emitResult(response(1, 10));
    expect(without.queryGaze(toSessionTimeMs(0), toSessionTimeMs(30))[0].calibrationData)
      .toBeNull();
    without.dispose();

    const failedFactory = createFactory();
    const failed = new BrowserInteractionSession(callbacks(), {
      video: document.createElement("video"),
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      timeProvider: () => 30,
      sessionFactory: failedFactory.sessionFactory,
      timelineSampleTransformer: () => {
        throw new Error("transform failed");
      },
    });
    await failed.start();
    failedFactory.sessions[0].emitResult(response(1, 10));
    const stored = failed.queryGaze(toSessionTimeMs(0), toSessionTimeMs(30));
    expect(stored).toHaveLength(1);
    expect(stored[0].calibrationData).toBeNull();
    failed.dispose();
  });
});
