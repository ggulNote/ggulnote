import type { SessionTimeMs } from "@ggulnote/shared-types";
import type { WorkerLandmark } from "../mediapipe/face-landmark-adapter";

export type GazeWorkerRequestBase = {
  readonly requestId: number;
};

export type GazeWorkerInitializeRequest = GazeWorkerRequestBase & {
  readonly type: "initialize";
  readonly modelUrl: string;
  readonly wasmRoot: string;
};

export type GazeWorkerProcessFrameRequest = GazeWorkerRequestBase & {
  readonly type: "process-frame";
  readonly frameId: number;
  readonly sourceCapturedAt: SessionTimeMs;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly imageBitmap: ImageBitmap;
};

export type GazeWorkerDisposeRequest = GazeWorkerRequestBase & {
  readonly type: "dispose";
};

export type GazeWorkerRequest =
  | GazeWorkerInitializeRequest
  | GazeWorkerProcessFrameRequest
  | GazeWorkerDisposeRequest;

export type GazeWorkerReadyResponse = {
  readonly requestId: number;
  readonly type: "ready";
};

export type GazeWorkerNoFaceResponse = {
  readonly requestId: number;
  readonly type: "no-face";
  readonly frameId: number;
  readonly sourceCapturedAt: SessionTimeMs;
};

export type GazeWorkerLandmarkResultResponse = {
  readonly requestId: number;
  readonly type: "landmark-result";
  readonly frameId: number;
  readonly sourceCapturedAt: SessionTimeMs;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly landmarks: readonly WorkerLandmark[];
  readonly trackingConfidence: number | null;
  readonly inferenceDurationMs: number;
};

export type GazeWorkerErrorResponse = {
  readonly requestId: number;
  readonly type: "error";
  readonly message: string;
};

export type GazeWorkerDisposedResponse = {
  readonly requestId: number;
  readonly type: "disposed";
};

export type GazeWorkerResponse =
  | GazeWorkerReadyResponse
  | GazeWorkerNoFaceResponse
  | GazeWorkerLandmarkResultResponse
  | GazeWorkerErrorResponse
  | GazeWorkerDisposedResponse;

const INITIAL_MEDIA_PIPE_TIMESTAMP_MS = 0;

export function nextMediaPipeTimestamp(
  previous: number,
  sourceCapturedAt: number,
): number {
  const fromSource = Math.floor(sourceCapturedAt);
  const clampedFromSource = Number.isFinite(fromSource) && fromSource > INITIAL_MEDIA_PIPE_TIMESTAMP_MS
    ? fromSource
    : INITIAL_MEDIA_PIPE_TIMESTAMP_MS;

  return Math.max(previous + 1, clampedFromSource);
}
