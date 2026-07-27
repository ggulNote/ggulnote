import { FaceLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { createFaceLandmarker } from "../mediapipe/face-landmarker-loader";
import {
  nextMediaPipeTimestamp,
  type GazeWorkerDisposeRequest,
  type GazeWorkerErrorResponse,
  type GazeWorkerLandmarkResultResponse,
  type GazeWorkerNoFaceResponse,
  type GazeWorkerRequest,
  type GazeWorkerResponse,
  type GazeWorkerReadyResponse,
} from "./gaze-worker-protocol";

type WorkerLandmark = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly visibility?: number;
};

interface WorkerScope {
  onmessage: ((event: MessageEvent<GazeWorkerRequest>) => void) | null;
  postMessage(message: GazeWorkerResponse, transfer?: Transferable[]): void;
}

const workerScope = globalThis as unknown as WorkerScope;

let faceLandmarker: FaceLandmarker | null = null;
let ready = false;
let disposed = false;
let initializePromise: Promise<FaceLandmarker> | null = null;
let mediaPipeTimestampMs = 0;
const INITIAL_RESPONSE_REQUEST_ID = -1;

async function getFaceLandmarker(modelUrl: string, wasmRoot: string): Promise<FaceLandmarker> {
  initializePromise ??= createFaceLandmarker({ modelUrl, wasmRoot });
  return initializePromise;
}

async function initialize(request: GazeWorkerRequest): Promise<GazeWorkerReadyResponse> {
  if (request.type !== "initialize") {
    throw new Error("Invalid initialize request payload.");
  }

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

async function processFrame(
  request: GazeWorkerRequest,
): Promise<GazeWorkerNoFaceResponse | GazeWorkerLandmarkResultResponse> {
  if (request.type !== "process-frame") {
    throw new Error("Invalid process-frame request payload.");
  }

  if (!ready || disposed || !faceLandmarker) {
    throw new Error("The face landmarker is not initialized.");
  }

  const sourceCapturedAt = Number(request.sourceCapturedAt);
  mediaPipeTimestampMs = nextMediaPipeTimestamp(mediaPipeTimestampMs, sourceCapturedAt);
  const startedAt = typeof performance === "undefined" ? 0 : performance.now();

  const imageBitmap = request.imageBitmap;
  try {
    const rawResult = faceLandmarker.detectForVideo(imageBitmap, mediaPipeTimestampMs);
    const inferenceDurationMs = startedAt === 0
      ? 0
      : (typeof performance === "undefined" ? 0 : performance.now() - startedAt);

    const firstFace = rawResult.faceLandmarks?.at(0);
    if (!firstFace || firstFace.length === 0) {
      return {
        requestId: request.requestId,
        type: "no-face",
        frameId: request.frameId,
        sourceCapturedAt: request.sourceCapturedAt,
      };
    }

    return {
      requestId: request.requestId,
      type: "landmark-result",
      frameId: request.frameId,
      sourceCapturedAt: request.sourceCapturedAt,
      frameWidth: request.frameWidth,
      frameHeight: request.frameHeight,
      landmarks: mapLandmarks(firstFace),
      trackingConfidence: null,
      inferenceDurationMs,
    };
  } finally {
    imageBitmap.close();
  }
}

function dispose(request: GazeWorkerDisposeRequest): void {
  disposed = true;
  ready = false;

  faceLandmarker?.close();
  faceLandmarker = null;
  initializePromise = null;
  workerScope.postMessage({ requestId: request.requestId, type: "disposed" });
}

function emitError(requestId: number, error: unknown): void {
  const message = error instanceof Error ? error.message : "Face landmark processing failed.";
  const response: GazeWorkerErrorResponse = {
    requestId,
    type: "error",
    message,
  };
  workerScope.postMessage(response);
}

workerScope.onmessage = (event) => {
  const request = event.data;

  void (async () => {
    if (disposed) {
      workerScope.postMessage({
        requestId: request.requestId ?? INITIAL_RESPONSE_REQUEST_ID,
        type: "error",
        message: "gaze worker is already disposed",
      });
      return;
    }

    if (request.type === "initialize") {
      const response = await initialize(request);
      workerScope.postMessage(response);
      return;
    }

    if (request.type === "dispose") {
      dispose(request);
      return;
    }

    const response = await processFrame(request);
    workerScope.postMessage(response);
  })().catch((error: unknown) => {
    emitError(request.requestId ?? INITIAL_RESPONSE_REQUEST_ID, error);
  });
};
