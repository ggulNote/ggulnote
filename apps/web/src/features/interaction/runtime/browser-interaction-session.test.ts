import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTimeMs } from "@ggulnote/shared-types";
import {
  type GazeWorkerRawGazeErrorResponse,
  type GazeWorkerRawGazeResultResponse,
} from "../../gaze/worker/gaze-worker-protocol";
import { type FaceTrackingSessionCallbacks, type FaceTrackingSessionOptions, type FaceTrackingSessionStats } from "../../gaze/runtime/face-tracking-session";
import type { FaceLandmarkFrame, RawGazeObservation } from "@ggulnote/gaze-core";
import { toSessionTimeMs } from "@ggulnote/interaction-core";
import { BrowserInteractionSession } from "./browser-interaction-session";
import type { BrowserInteractionSessionCallbacks } from "../types/interaction-session-state";

function sessionTime(value: number): SessionTimeMs {
  return toSessionTimeMs(value);
}

const initialStats: FaceTrackingSessionStats = {
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

function createObservation(sourceCapturedAt: number): RawGazeObservation {
  return {
    frameId: 1,
    sourceCapturedAt: sessionTime(sourceCapturedAt),
    processingStartedAt: sessionTime(sourceCapturedAt + 2),
    processingCompletedAt: sessionTime(sourceCapturedAt + 32),
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
      windowStartedAt: sessionTime(sourceCapturedAt),
      windowEndedAt: sessionTime(sourceCapturedAt),
    },
    quality: {
      faceDetected: true,
      leftEyeReady: true,
      rightEyeReady: true,
      trackingConfidence: null,
    },
  };
}

function createTrackingResponse(
  frameId: number,
  sourceCapturedAt: number,
  observation: RawGazeObservation,
): GazeWorkerRawGazeResultResponse {
  const frame: FaceLandmarkFrame = {
    frameId,
    sourceCapturedAt: sessionTime(sourceCapturedAt),
    frameWidth: 640,
    frameHeight: 480,
    landmarks: [
      { x: 0.1, y: 0.1, z: 0.1 },
      { x: 0.4, y: 0.4, z: 0.1 },
    ],
    trackingConfidence: null,
  };

  return {
    requestId: 1,
    type: "raw-gaze-result",
    frame,
    result: {
      kind: "tracking",
      frameId,
      sourceCapturedAt: sessionTime(sourceCapturedAt),
      observation,
      eyeSpheres: {
        leftEyeSphereCenter: { x: 0, y: 0, z: 0 },
        rightEyeSphereCenter: { x: 0, y: 0, z: 0 },
      },
      timingMs: {
        gazeComputationDurationMs: 1,
        totalWorkerDurationMs: 2,
      },
    },
    inferenceDurationMs: 4,
    gazeComputationDurationMs: 1,
    totalWorkerDurationMs: 2,
  };
}

type FakeTrackingSession = {
  start: () => Promise<void>;
  stop: () => void;
  dispose: () => void;
  initializeEyeGeometry: () => Promise<void>;
  resetEyeGeometry: () => Promise<void>;
  emitRawGazeResult: (response: GazeWorkerRawGazeResultResponse) => void;
  emitRawGazeError: (response: GazeWorkerRawGazeErrorResponse) => void;
};

function createFakeTrackingSessionFactory() {
  const sessions: FakeTrackingSession[] = [];

  const sessionFactory = vi.fn(
    (
      _: HTMLVideoElement,
      __: FaceTrackingSessionOptions,
      callbacks: FaceTrackingSessionCallbacks,
    ): FakeTrackingSession => {
      const session: FakeTrackingSession = {
        start: vi.fn(async () => {
          callbacks.onStatsChange({
            ...initialStats,
            status: "running",
            frameWidth: 640,
            frameHeight: 480,
            frameId: 0,
          });
        }),
        stop: vi.fn(() => {
          callbacks.onStatsChange({
            ...initialStats,
            status: "stopped",
            frameWidth: 640,
            frameHeight: 480,
          });
        }),
        dispose: vi.fn(() => {
          callbacks.onStatsChange({
            ...initialStats,
            status: "stopped",
            frameWidth: 640,
            frameHeight: 480,
          });
        }),
        initializeEyeGeometry: async () => undefined,
        resetEyeGeometry: async () => undefined,
        emitRawGazeResult: (response) => callbacks.onRawGazeResult?.(response),
        emitRawGazeError: (response) => callbacks.onRawGazeError?.(response),
      };

      sessions.push(session);
      return session;
    },
  );

  return { sessions, sessionFactory };
}

describe("BrowserInteractionSession", () => {
  let providerNow = 0;
  let callbacks: BrowserInteractionSessionCallbacks;
  let onTimelineChange: ReturnType<typeof vi.fn>;
  let onRawGazeSample: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    providerNow = 0;
    onTimelineChange = vi.fn();
    onRawGazeSample = vi.fn();

    callbacks = {
      onTrackingStatsChange: vi.fn((_stats: FaceTrackingSessionStats) => {
        // no-op
      }),
      onLandmarkFrame: vi.fn(),
      onNoFace: vi.fn(),
      onError: vi.fn(),
      onTimelineChange,
      onRawGazeSample,
    };
  });

  it("does not append before running", () => {
    const factory = createFakeTrackingSessionFactory();
    const session = new BrowserInteractionSession(callbacks, {
      video: {} as HTMLVideoElement,
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      timelineRetentionMs: 10_000,
      timeProvider: () => providerNow,
      sessionFactory: factory.sessionFactory,
    });

    const fake = factory.sessions.at(-1);
    expect(fake).toBeUndefined();

    const response = createTrackingResponse(1, 10_000, createObservation(10_000));
    if (fake) {
      fake.emitRawGazeResult(response);
    }

    expect(onRawGazeSample).toHaveBeenCalledTimes(0);
    expect(session.getState().timelineSize).toBe(0);
  });

  it("stores result at sourceCapturedAt", async () => {
    const factory = createFakeTrackingSessionFactory();
    const session = new BrowserInteractionSession(callbacks, {
      video: {} as HTMLVideoElement,
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      timelineRetentionMs: 10_000,
      timeProvider: () => providerNow,
      sessionFactory: factory.sessionFactory,
    });

    await session.start();
    const tracking = factory.sessions.at(-1);
    expect(tracking).toBeDefined();

    providerNow = 10_040;
    tracking!.emitRawGazeResult(
      createTrackingResponse(1, 10_000, {
        ...createObservation(10_000),
        processingCompletedAt: sessionTime(10_032),
      }),
    );

    const samples = session.queryGaze(sessionTime(10_000), sessionTime(10_000));
    expect(samples).toHaveLength(1);
    expect(Number(samples[0].time)).toBe(10_000);
    expect(Number(samples[0].observation.processingCompletedAt)).toBe(10_040);
  });

  it("does not append when stopped", async () => {
    const factory = createFakeTrackingSessionFactory();
    const session = new BrowserInteractionSession(callbacks, {
      video: {} as HTMLVideoElement,
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      timelineRetentionMs: 10_000,
      timeProvider: () => providerNow,
      sessionFactory: factory.sessionFactory,
    });

    await session.start();
    const tracking = factory.sessions.at(-1);

    providerNow = 10_040;
    tracking!.emitRawGazeResult(createTrackingResponse(1, 10_000, createObservation(10_000)));
    expect(session.getState().timelineSize).toBe(1);

    session.stop();
    providerNow = 11_000;
    tracking!.emitRawGazeResult(createTrackingResponse(2, 11_000, createObservation(11_000)));
    expect(session.getState().timelineSize).toBe(1);
  });

  it("clears timeline on restart and rejects duplicated frame id", async () => {
    const factory = createFakeTrackingSessionFactory();
    const session = new BrowserInteractionSession(callbacks, {
      video: {} as HTMLVideoElement,
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      timelineRetentionMs: 10_000,
      timeProvider: () => providerNow,
      sessionFactory: factory.sessionFactory,
    });

    await session.start();
    const firstTracking = factory.sessions.at(-1);

    providerNow = 5_040;
    firstTracking!.emitRawGazeResult(createTrackingResponse(1, 5_000, createObservation(5_000)));
    expect(session.getState().timelineSize).toBe(1);

    session.stop();

    await session.start();
    const secondTracking = factory.sessions.at(-1);
    providerNow = 10_040;
    secondTracking!.emitRawGazeResult(createTrackingResponse(1, 10_000, createObservation(10_000)));
    secondTracking!.emitRawGazeResult(createTrackingResponse(1, 10_000, createObservation(10_000)));

    expect(session.getState().timelineSize).toBe(1);
    expect(session.getState().duplicateFrameCount).toBe(1);
  });

  it("filters non-finite vectors and keeps only valid samples", async () => {
    const factory = createFakeTrackingSessionFactory();
    const session = new BrowserInteractionSession(callbacks, {
      video: {} as HTMLVideoElement,
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      timelineRetentionMs: 10_000,
      timeProvider: () => providerNow,
      sessionFactory: factory.sessionFactory,
    });

    await session.start();
    const tracking = factory.sessions.at(-1);

    tracking!.emitRawGazeResult(
      createTrackingResponse(1, 12_000, {
        ...createObservation(12_000),
        leftDirection: { x: Number.NaN, y: 0, z: 1 },
      }),
    );
    expect(session.getState().timelineSize).toBe(0);

    tracking!.emitRawGazeResult(createTrackingResponse(2, 12_010, createObservation(12_010)));
    expect(session.getState().timelineSize).toBe(1);
  });

  it("does not allow append after dispose and stop duplicate callbacks", async () => {
    const factory = createFakeTrackingSessionFactory();
    const session = new BrowserInteractionSession(callbacks, {
      video: {} as HTMLVideoElement,
      modelUrl: "model.task",
      wasmRoot: "wasm/",
      timelineRetentionMs: 10_000,
      timeProvider: () => providerNow,
      sessionFactory: factory.sessionFactory,
    });

    await session.start();
    const tracking = factory.sessions.at(-1);
    session.dispose();

    tracking!.emitRawGazeResult(createTrackingResponse(1, 13_000, createObservation(13_000)));

    expect(session.getState().timelineSize).toBe(0);
    await expect(session.start()).rejects.toThrow("disposed");
  });
});
