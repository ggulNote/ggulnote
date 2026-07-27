import type { TimedGazeSample } from "@ggulnote/interaction-core";
import type { FaceLandmarkFrame } from "@ggulnote/gaze-core";
import type { SessionTimeMs } from "@ggulnote/shared-types";
import type { SessionError, FaceTrackingSessionStats } from "../../gaze/runtime/face-tracking-session";

export type BrowserInteractionSessionStatus =
  | "idle"
  | "running"
  | "stopped"
  | "disposed";

export type BrowserInteractionSessionError = SessionError;

export type BrowserInteractionSessionSnapshot = {
  readonly status: BrowserInteractionSessionStatus;
  readonly sessionTime: SessionTimeMs;
  readonly timelineRetentionMs: number;
  readonly timelineSize: number;
  readonly oldestSampleSourceCapturedAt: SessionTimeMs | null;
  readonly newestSampleSourceCapturedAt: SessionTimeMs | null;
  readonly lastStoredFrameId: number | null;
  readonly lastStoredSourceCapturedAt: SessionTimeMs | null;
  readonly lastStoredProcessingCompletedAt: SessionTimeMs | null;
  readonly lastEndToEndLatencyMs: number | null;
  readonly recentOneSecondSampleCount: number;
  readonly duplicateFrameCount: number;
};

export type BrowserInteractionSessionTimelineQuery = {
  readonly startAt: SessionTimeMs;
  readonly endAt: SessionTimeMs;
};

export interface BrowserInteractionSessionCallbacks {
  onTrackingStatsChange: (stats: Readonly<FaceTrackingSessionStats>) => void;
  onLandmarkFrame: (frame: FaceLandmarkFrame, irisState: { hasBothIris: boolean }) => void;
  onNoFace: (frameId: number) => void;
  onError: (error: BrowserInteractionSessionError) => void;
  onTimelineChange?: (snapshot: BrowserInteractionSessionSnapshot) => void;
  onRawGazeSample?: (sample: TimedGazeSample) => void;
}

export interface BrowserInteractionSessionOptions {
  readonly video: HTMLVideoElement;
  readonly modelUrl: string;
  readonly wasmRoot: string;
  readonly timelineRetentionMs?: number;
  readonly timeProvider?: () => number;
}
