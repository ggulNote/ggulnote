import type { Rect } from "@ggulnote/editor-core";
import type { SpeechProviderError } from "./voice-errors";

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
  speechStartToFirstInterimMs?: number;
  speechStartToFirstFinalMs?: number;
  speechEndToCompletedMs?: number;
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

export interface VoiceTurnSceneReference {
  sceneRevisionAtSpeechStart: number;
  pageIdAtSpeechStart: string;
  currentSceneRevisionAtCompletion?: number;
  sceneChangedDuringTurn: boolean;
  pageChangedDuringTurn: boolean;
}

export interface VoiceTurnRecord {
  id: string;
  providerSessionId: string;
  startedAt: number;
  speechEndedAt?: number;
  completedAt?: number;
  state: Exclude<VoiceTurnState, "idle" | "capturing" | "finalizing">;
  rawTranscript: string;
  finalSegments: VoiceTranscriptSegment[];
  focusSnapshot: VoiceFocusSnapshot;
  scene: VoiceTurnSceneReference;
  error?: SpeechProviderError;
  metrics: VoiceTurnMetrics;
}

export interface ActiveVoiceTurnSnapshot {
  id: string;
  state: "capturing" | "finalizing";
  providerSessionId: string;
  startedAt: number;
  speechEndedAt?: number;
  transcript: TranscriptAccumulatorSnapshot;
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
