import { type NormalizedLandmark, FaceLandmarker } from "@mediapipe/tasks-vision";
import {
  EYE_GEOMETRY_INIT_MAX_STALE_MS,
  JeoRawGazeEngineImpl,
  type FaceLandmarkFrame,
  type RawGazeEngineErrorCode,
  type RawGazeEngineResult,
} from "@ggulnote/gaze-core";
import { adaptFaceLandmarkResult } from "../mediapipe/face-landmark-adapter";
import { createFaceLandmarker } from "../mediapipe/face-landmarker-loader";
import {
  isTrackingRawResult,
  nextMediaPipeTimestamp,
  type GazeWorkerDisposeRequest,
  type GazeWorkerErrorResponse,
  type GazeWorkerEyeGeometryInitializedResponse,
  type GazeWorkerEyeGeometryRequiredResponse,
  type GazeWorkerEyeGeometryResetResponse,
  type GazeWorkerNoFaceResponse,
  type GazeWorkerProcessFrameRequest,
  type GazeWorkerRawGazeErrorResponse,
  type GazeWorkerRawGazeResultResponse,
  type GazeWorkerReadyResponse,
  type GazeWorkerRequest,
  type GazeWorkerRequestBase,
  type GazeWorkerResponse,
  type GazeWorkerInitializeRequest,
  type GazeWorkerInitializeEyeGeometryRequest,
  type GazeWorkerResetEyeGeometryRequest,
} from "./gaze-worker-protocol";
import type { SessionTimeMs } from "@ggulnote/shared-types";

type WorkerLandmark = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly visibility?: number;
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<GazeWorkerRequest>) => void) | null;
  postMessage(message: GazeWorkerResponse, transfer?: Transferable[]): void;
};

const workerScope = globalThis as unknown as WorkerScope;
const INITIAL_RESPONSE_REQUEST_ID = -1;

let faceLandmarker: FaceLandmarker | null = null;
let ready = false;
let disposed = false;
let initializePromise: Promise<FaceLandmarker> | null = null;
let mediaPipeTimestampMs = 0;
let latestFaceFrame: FaceLandmarkFrame | null = null;

const engine = new JeoRawGazeEngineImpl();

function safeNow(): number {
  if (typeof performance === "undefined") {
    return Date.now();
  }

  return performance.now();
}

function asNumber(value: SessionTimeMs): number {
  return Number(value);
}

function isStaleReference(candidateAt: SessionTimeMs, nowAt: SessionTimeMs): boolean {
  const diff = asNumber(nowAt) - asNumber(candidateAt);
  return !Number.isFinite(diff) || diff > EYE_GEOMETRY_INIT_MAX_STALE_MS;
}

function toNumber(value: SessionTimeMs): number {
  return Number(value);
}

async function getFaceLandmarker(modelUrl: string, wasmRoot: string): Promise<FaceLandmarker> {
  initializePromise ??= createFaceLandmarker({ modelUrl, wasmRoot });
  return initializePromise;
}

async function initializeWorker(request: GazeWorkerInitializeRequest): Promise<GazeWorkerReadyResponse> {
  faceLandmarker = await getFaceLandmarker(request.modelUrl, request.wasmRoot);
  ready = true;

  return { requestId: request.requestId, type: "ready" };
}

function mapLandmarks(rawLandmarks: readonly NormalizedLandmark[]): readonly WorkerLandmark[] {
  return rawLandmarks.map((landmark) => ({
    x: landmark.x,
    y: landmark.y,
    z: landmark.z,
    visibility: landmark.visibility,
  }));
}

function buildNoFaceResponse(
  request: GazeWorkerProcessFrameRequest,
  inferenceDurationMs: number,
): GazeWorkerNoFaceResponse {
  return {
    requestId: request.requestId,
    type: "no-face",
    frameId: request.frameId,
    sourceCapturedAt: request.sourceCapturedAt,
    inferenceDurationMs,
  };
}

function buildRawGazeResult(
  request: GazeWorkerProcessFrameRequest,
  frame: FaceLandmarkFrame,
  result: Extract<RawGazeEngineResult, { kind: "tracking" }>,
  inferenceDurationMs: number,
  gazeComputationDurationMs: number,
  totalWorkerDurationMs: number,
): GazeWorkerRawGazeResultResponse {
  return {
    requestId: request.requestId,
    type: "raw-gaze-result",
    frame,
    result,
    inferenceDurationMs,
    gazeComputationDurationMs,
    totalWorkerDurationMs,
  };
}

function buildEyeGeometryRequired(
  request: GazeWorkerProcessFrameRequest | GazeWorkerInitializeEyeGeometryRequest,
  frame: FaceLandmarkFrame | null,
  message: string,
): GazeWorkerEyeGeometryRequiredResponse {
  return {
    requestId: request.requestId,
    type: "eye-geometry-required",
    sourceCapturedAt: request.type === "initialize-eye-geometry" ? request.requestAt : frame?.sourceCapturedAt ?? request.sourceCapturedAt,
    frame: frame,
    message,
  };
}

function buildRawError(
  request: GazeWorkerProcessFrameRequest,
  code: RawGazeEngineErrorCode,
  message: string,
): GazeWorkerRawGazeErrorResponse {
  return {
    requestId: request.requestId,
    type: "raw-gaze-error",
    frameId: request.frameId,
    sourceCapturedAt: request.sourceCapturedAt,
    code,
    message,
  };
}

function processInitializeEyeGeometry(
  request: GazeWorkerInitializeEyeGeometryRequest,
): GazeWorkerEyeGeometryInitializedResponse | GazeWorkerEyeGeometryRequiredResponse {
  if (!latestFaceFrame) {
    return buildEyeGeometryRequired(request, null, "No cached face frame is available for eye geometry initialization.");
  }

  if (isStaleReference(latestFaceFrame.sourceCapturedAt, request.requestAt)) {
    return buildEyeGeometryRequired(
      request,
      latestFaceFrame,
      "Cached face frame is stale for eye-geometry initialization.",
    );
  }

  const profile = engine.initializeEyeGeometry(latestFaceFrame);

  return {
    requestId: request.requestId,
    type: "eye-geometry-initialized",
    profile,
    frameId: latestFaceFrame.frameId,
    sourceCapturedAt: latestFaceFrame.sourceCapturedAt,
  };
}

function processResetEyeGeometry(request: GazeWorkerResetEyeGeometryRequest): GazeWorkerEyeGeometryResetResponse {
  engine.resetEyeGeometry();
  return {
    requestId: request.requestId,
    type: "eye-geometry-reset",
  };
}

async function processFrame(request: GazeWorkerProcessFrameRequest): Promise<GazeWorkerResponse> {
  if (!ready || disposed || !faceLandmarker) {
    throw new Error("The face landmarker is not initialized.");
  }

  const imageBitmap = request.imageBitmap;
  const detectStartedAt = safeNow();

  try {
    mediaPipeTimestampMs = nextMediaPipeTimestamp(mediaPipeTimestampMs, toNumber(request.sourceCapturedAt));

    const detectStart = safeNow();
    const rawResult = await Promise.resolve(faceLandmarker.detectForVideo(imageBitmap, mediaPipeTimestampMs));
    const inferenceDurationMs = Math.max(0, safeNow() - detectStart);

    const firstFace = rawResult.faceLandmarks?.at(0);
    if (!firstFace || firstFace.length === 0) {
      return buildNoFaceResponse(request, inferenceDurationMs);
    }

    const mapped = mapLandmarks(firstFace);
    const adapted = adaptFaceLandmarkResult({
      frameId: request.frameId,
      sourceCapturedAt: request.sourceCapturedAt,
      frameWidth: request.frameWidth,
      frameHeight: request.frameHeight,
      rawResult: {
        landmarks: mapped,
        trackingConfidence: null,
      },
    });

    if (adapted.kind === "no-face") {
      return buildNoFaceResponse(request, inferenceDurationMs);
    }

    if (adapted.kind === "unsupported-landmark-layout") {
      return buildRawError(request, adapted.code, adapted.message);
    }

    const frame = adapted.frame;
    latestFaceFrame = frame;

    const gazeStartedAt = safeNow();
    const gazeResult = engine.processFrame(frame, {
      processingStartedAt: request.processingStartedAt,
      processingCompletedAt: gazeStartedAt as SessionTimeMs,
    });

    const gazeComputationDurationMs = Math.max(
      0,
      safeNow() - gazeStartedAt,
    );
    const totalWorkerDurationMs = Math.max(0, safeNow() - detectStartedAt);

    if (isTrackingRawResult(gazeResult)) {
      return buildRawGazeResult(
        request,
        frame,
        gazeResult,
        inferenceDurationMs,
        gazeComputationDurationMs,
        totalWorkerDurationMs,
      );
    }

    if (gazeResult.kind === "eye-geometry-required") {
      return buildEyeGeometryRequired(request, frame, gazeResult.message);
    }

    return buildRawError(request, gazeResult.code, gazeResult.message);
  } finally {
    imageBitmap.close();
  }
}

function disposeWorker(request: GazeWorkerDisposeRequest): void {
  disposed = true;
  ready = false;

  faceLandmarker?.close();
  faceLandmarker = null;
  initializePromise = null;
  latestFaceFrame = null;
  engine.resetEyeGeometry();

  workerScope.postMessage({ requestId: request.requestId, type: "disposed" });
}

function emitError(requestId: number, error: unknown): void {
  const response: GazeWorkerErrorResponse = {
    requestId,
    type: "error",
    message: error instanceof Error ? error.message : "Face landmark processing failed.",
  };
  workerScope.postMessage(response);
}

workerScope.onmessage = (event) => {
  const request = event.data;

  void (async () => {
    if (disposed) {
      emitError(request.requestId ?? INITIAL_RESPONSE_REQUEST_ID, "gaze worker is already disposed");
      return;
    }

    if (request.type === "initialize") {
      const response = await initializeWorker(request);
      workerScope.postMessage(response);
      return;
    }

    if (request.type === "initialize-eye-geometry") {
      const response = processInitializeEyeGeometry(request);
      workerScope.postMessage(response);
      return;
    }

    if (request.type === "reset-eye-geometry") {
      const response = processResetEyeGeometry(request);
      workerScope.postMessage(response);
      return;
    }

    if (request.type === "dispose") {
      disposeWorker(request);
      return;
    }

    const response = await processFrame(request);
    workerScope.postMessage(response);
  })().catch((error: unknown) => {
    emitError(request.requestId ?? INITIAL_RESPONSE_REQUEST_ID, error);
  });
};
