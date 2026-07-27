import type { SessionTimeMs } from "@ggulnote/shared-types";
import type {
  EyeGeometryProfile,
  FaceLandmarkFrame,
  RawGazeEngineErrorCode,
  RawGazeEngineResult,
  RawGazeEngineTrackingResult,
} from "@ggulnote/gaze-core";

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
  readonly processingStartedAt: SessionTimeMs;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly imageBitmap: ImageBitmap;
};

export type GazeWorkerInitializeEyeGeometryRequest = GazeWorkerRequestBase & {
  readonly type: "initialize-eye-geometry";
  readonly requestAt: SessionTimeMs;
};

export type GazeWorkerResetEyeGeometryRequest = GazeWorkerRequestBase & {
  readonly type: "reset-eye-geometry";
};

export type GazeWorkerDisposeRequest = GazeWorkerRequestBase & {
  readonly type: "dispose";
};

export type GazeWorkerRequest =
  | GazeWorkerInitializeRequest
  | GazeWorkerProcessFrameRequest
  | GazeWorkerInitializeEyeGeometryRequest
  | GazeWorkerResetEyeGeometryRequest
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
  readonly inferenceDurationMs: number;
};

export type GazeWorkerRawGazeResultResponse = {
  readonly requestId: number;
  readonly type: "raw-gaze-result";
  readonly frame: FaceLandmarkFrame;
  readonly result: RawGazeEngineTrackingResult;
  readonly inferenceDurationMs: number;
  readonly gazeComputationDurationMs: number;
  readonly totalWorkerDurationMs: number;
};

export type GazeWorkerEyeGeometryRequiredResponse = {
  readonly requestId: number;
  readonly type: "eye-geometry-required";
  readonly frame: FaceLandmarkFrame | null;
  readonly sourceCapturedAt: SessionTimeMs;
  readonly message: string;
};

export type GazeWorkerEyeGeometryInitializedResponse = {
  readonly requestId: number;
  readonly type: "eye-geometry-initialized";
  readonly profile: EyeGeometryProfile;
  readonly frameId: number;
  readonly sourceCapturedAt: SessionTimeMs;
};

export type GazeWorkerEyeGeometryResetResponse = {
  readonly requestId: number;
  readonly type: "eye-geometry-reset";
};

export type GazeWorkerRawGazeErrorResponse = {
  readonly requestId: number;
  readonly type: "raw-gaze-error";
  readonly frameId: number;
  readonly sourceCapturedAt: SessionTimeMs;
  readonly code: RawGazeEngineErrorCode;
  readonly message: string;
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
  | GazeWorkerRawGazeResultResponse
  | GazeWorkerEyeGeometryRequiredResponse
  | GazeWorkerEyeGeometryInitializedResponse
  | GazeWorkerEyeGeometryResetResponse
  | GazeWorkerRawGazeErrorResponse
  | GazeWorkerErrorResponse
  | GazeWorkerDisposedResponse;

const INITIAL_MEDIA_PIPE_TIMESTAMP_MS = 0;

export function nextMediaPipeTimestamp(
  previous: number,
  sourceCapturedAt: number,
): number {
  const fromSource = Math.floor(sourceCapturedAt);
  const boundedSource =
    Number.isFinite(fromSource)
      ? Math.max(fromSource, INITIAL_MEDIA_PIPE_TIMESTAMP_MS)
      : INITIAL_MEDIA_PIPE_TIMESTAMP_MS;
  return Math.max(previous + 1, boundedSource);
}

export function isTrackingRawResult(result: RawGazeEngineResult): result is RawGazeEngineTrackingResult {
  return result.kind === "tracking";
}
