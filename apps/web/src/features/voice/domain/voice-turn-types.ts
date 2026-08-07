import type { Rect, SceneMode } from "@ggulnote/editor-core";
import type { SpeechProviderError } from "./voice-errors";
import type { SpeechRecognitionConfig } from "./speech-types";

export type VoiceTurnState =
  | "idle"
  | "capturing"
  | "finalizing"
  | "completed"
  | "discarded"
  | "failed";

export interface VoiceTranscriptSegment {
  id: string;
  index: number;
  text: string;
  confidence?: number;
}

export interface TranscriptAccumulatorSnapshot {
  finalText: string;
  interimText: string;
  displayText: string;
  finalSegments: VoiceTranscriptSegment[];
}

export interface VoiceTurnMetrics {
  requestToRecognitionStartMs?: number;
  speechStartToFirstInterimMs?: number;
  speechStartToFirstFinalMs?: number;
  speechEndToFirstFinalMs?: number;
  speechEndToCompletedMs?: number;
  totalTurnMs?: number;
  interimUpdateCount: number;
  finalSegmentCount: number;
  providerRestartCount: number;
}

export type VoiceFocusSource = "gaze" | "selection" | "recent-focus" | "page" | "none";

export interface VoiceFocusSnapshot {
  source: VoiceFocusSource;
  capturedAt: number;
  pageId: string;
  sceneRevision: number;
  objectId?: string;
  bounds?: Rect;
  gazeSampleId?: string;
  confidence?: number;
  stale: boolean;
}

export interface FrozenVoiceTurnContext {
  pageId: string;
  sceneMode: SceneMode;
  sceneRevision: number;
  focusObjectId?: string;
  focusBounds?: Rect;
  focusSource: VoiceFocusSource;
  focusStale: boolean;
  capturedAt: number;
}

export interface VoiceTurnSceneReference {
  sceneRevisionAtSpeechStart: number;
  pageIdAtSpeechStart: string;
  currentSceneRevisionAtCompletion?: number;
  sceneChangedDuringTurn: boolean;
  pageChangedDuringTurn: boolean;
}

export interface VoiceTurnRecord {
  id: string;
  providerId: string;
  providerSessionId: string;
  language: string;
  requestedAt: number;
  recognitionStartedAt?: number;
  audioStartedAt?: number;
  startedAt: number;
  firstInterimAt?: number;
  firstFinalAt?: number;
  speechEndedAt?: number;
  providerEndedAt?: number;
  stopRequestedAt?: number;
  completedAt?: number;
  state: Exclude<VoiceTurnState, "idle" | "capturing" | "finalizing">;
  rawTranscript: string;
  finalSegments: VoiceTranscriptSegment[];
  frozenContext: FrozenVoiceTurnContext;
  focusSnapshot: VoiceFocusSnapshot;
  scene: VoiceTurnSceneReference;
  error?: SpeechProviderError;
  metrics: VoiceTurnMetrics;
}

export type CompletedVoiceTurn = VoiceTurnRecord & { state: "completed" };

export interface ActiveVoiceTurnSnapshot {
  id: string;
  state: "capturing" | "finalizing";
  providerId: string;
  providerSessionId: string;
  language: string;
  requestedAt: number;
  recognitionStartedAt?: number;
  audioStartedAt?: number;
  startedAt: number;
  firstInterimAt?: number;
  firstFinalAt?: number;
  speechEndedAt?: number;
  stopRequestedAt?: number;
  transcript: TranscriptAccumulatorSnapshot;
  frozenContext: FrozenVoiceTurnContext;
  focusSnapshot: VoiceFocusSnapshot;
  scene: VoiceTurnSceneReference;
  metrics: VoiceTurnMetrics;
}

export interface VoiceTurnTimingConfig {
  speechEndGraceMs: number;
  finalResultWaitMs: number;
  restartBackoffMs: number;
  maxRecoverableRestarts: number;
}

export type VoiceTurnControllerStatus =
  | "idle"
  | "starting"
  | "capturing"
  | "finalizing"
  | "completed"
  | "discarded"
  | "cancelled"
  | "failed"
  | "unsupported";

export type VoiceTurnCancelReason = "user" | "dispose";
export type VoiceTurnDiscardReason =
  | "empty-transcript"
  | "no-speech"
  | "provider-ended-before-speech";

export type VoiceTurnControllerErrorCode =
  | SpeechProviderError["code"]
  | "context-capture-failed"
  | "provider-start-failed";

export interface VoiceTurnControllerError {
  code: VoiceTurnControllerErrorCode;
  message?: string;
  recoverable: boolean;
  providerError?: SpeechProviderError;
}

export type VoiceTurnControllerState =
  | { status: "idle" }
  | {
      status: "starting";
      providerId: string;
      requestedAt: number;
      config: SpeechRecognitionConfig;
      providerSessionId?: string;
      recognitionStartedAt?: number;
      audioStartedAt?: number;
    }
  | { status: "capturing"; turn: ActiveVoiceTurnSnapshot }
  | { status: "finalizing"; turn: ActiveVoiceTurnSnapshot }
  | { status: "completed"; result: VoiceTurnRecord }
  | { status: "discarded"; reason: VoiceTurnDiscardReason; record?: VoiceTurnRecord }
  | {
      status: "cancelled";
      reason: VoiceTurnCancelReason;
      requestedAt: number;
      cancelledAt: number;
      turnId?: string;
      providerSessionId?: string;
      transcript: TranscriptAccumulatorSnapshot;
      frozenContext?: FrozenVoiceTurnContext;
    }
  | {
      status: "failed";
      error: VoiceTurnControllerError;
      requestedAt?: number;
      failedAt: number;
      turnId?: string;
      providerSessionId?: string;
      transcript: TranscriptAccumulatorSnapshot;
      frozenContext?: FrozenVoiceTurnContext;
    }
  | { status: "unsupported"; error: VoiceTurnControllerError };
