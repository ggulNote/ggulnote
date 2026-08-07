import type { Rect, SceneMode, Size } from "@ggulnote/editor-core";
import type {
  CompletedVoiceTurn,
  VoiceFocusSource,
  VoiceTurnControllerError,
  VoiceTurnMetrics,
} from "../domain";

export const MAX_DEBUG_EVENTS = 200;
export const MAX_DEBUG_TURNS = 20;

export type VoiceDebugEventType =
  | "TURN_REQUESTED"
  | "PROVIDER_START"
  | "AUDIO_START"
  | "SPEECH_START"
  | "CONTEXT_FROZEN"
  | "TRANSCRIPT_INTERIM"
  | "TRANSCRIPT_FINAL"
  | "SPEECH_END"
  | "AUDIO_END"
  | "STOP_REQUESTED"
  | "PROVIDER_END"
  | "PROVIDER_ABORT"
  | "PROVIDER_ERROR"
  | "CANCEL_REQUESTED"
  | "TURN_CANCELLED"
  | "TURN_COMPLETED"
  | "TURN_DISCARDED"
  | "TURN_FAILED";

export interface VoiceDebugEvent {
  readonly id: string;
  readonly sequence: number;
  readonly timestamp: number;
  readonly type: VoiceDebugEventType;
  readonly turnId?: string;
  readonly sessionId?: string;
  readonly summary?: string;
}

export interface VoiceDebugProviderSnapshot {
  readonly providerId: string;
  readonly availabilityChecked: boolean;
  readonly supported: boolean;
  readonly constructorName?: "SpeechRecognition" | "webkitSpeechRecognition";
  readonly api: {
    readonly speechRecognition: boolean;
    readonly webkitSpeechRecognition: boolean;
  };
  readonly localSupported: boolean;
  readonly localAvailabilityStatus: string;
  readonly contextualBiasingSupported: boolean;
  readonly language: string;
  readonly interimResults: boolean;
  readonly continuous: boolean;
  readonly maxAlternatives: number;
  readonly sessionId?: string;
  readonly isRunning: boolean;
  readonly intentionalStop?: boolean;
  readonly intentionalAbort?: boolean;
  readonly startCount: number;
  readonly endCount: number;
}

export interface VoiceDebugTranscriptSegment {
  readonly resultIndex: number;
  readonly segmentId: string;
  readonly sessionId: string;
  readonly isFinal: boolean;
  readonly length: number;
  readonly text: string;
}

export interface VoiceDebugTurnSnapshot {
  readonly turnId?: string;
  readonly sessionId?: string;
  readonly status: string;
  readonly resultKind: VoiceDebugResultKind;
  readonly requestedAt?: number;
  readonly recognitionStartedAt?: number;
  readonly audioStartedAt?: number;
  readonly speechStartedAt?: number;
  readonly speechEndedAt?: number;
  readonly providerEndedAt?: number;
  readonly completedAt?: number;
  readonly stopRequestedAt?: number;
  readonly cancelRequestedAt?: number;
  readonly firstInterimAt?: number;
  readonly firstFinalAt?: number;
}

export interface VoiceDebugContextSnapshot {
  readonly pageId: string;
  readonly sceneMode: SceneMode;
  readonly sceneRevision: number;
  readonly focusSource: VoiceFocusSource;
  readonly focusObjectId?: string;
  readonly focusBounds?: Rect;
  readonly focusStale: boolean;
  readonly capturedAt: number;
}

export interface VoiceDebugContextDiff {
  readonly pageChanged: boolean;
  readonly sceneChanged: boolean;
  readonly focusChanged: boolean;
  readonly frozenFocusStale: boolean;
}

export type VoiceDebugResultKind =
  | "Idle"
  | "In Progress"
  | "Completed"
  | "Discarded"
  | "Failed"
  | "Cancelled"
  | "Unsupported";

export interface VoiceDebugMetrics {
  readonly recognitionStartup: number | null;
  readonly audioReady: number | null;
  readonly speechFirstInterim: number | null;
  readonly speechFirstFinal: number | null;
  readonly speechEndFirstFinal: number | null;
  readonly speechEndFinal: number | null;
  readonly finalAfterSpeechEnd: number | null;
  readonly providerEnd: number | null;
  readonly totalTurn: number | null;
}

export interface VoiceDebugRecentTurnRecord {
  readonly turnId: string;
  readonly resultKind: Exclude<VoiceDebugResultKind, "Idle" | "In Progress">;
  readonly status: Exclude<VoiceDebugResultKind, "Idle" | "In Progress">;
  readonly transcript: string;
  readonly requestedAt: number;
  readonly completedAt?: number;
  readonly frozenContext?: VoiceDebugContextSnapshot;
  readonly metrics?: VoiceTurnMetrics;
  readonly metricsForDisplay?: VoiceDebugMetrics;
  readonly error?: VoiceTurnControllerError;
}

export interface VoiceDebugLensPosition {
  readonly anchorType: "frozen-focus" | "fallback";
  readonly preferredPlacement: string;
  readonly anchorScreenRect?: Rect;
  readonly lensSize: Size;
  readonly safeRect: Rect;
  readonly finalScreenPosition: Rect;
  readonly clampOccurred: boolean;
  readonly fallbackReason?:
    | "NO_FROZEN_FOCUS"
    | "FROZEN_PAGE_NOT_VISIBLE"
    | "FOCUS_OFFSCREEN"
    | "INVALID_BOUNDS";
}

export interface VoiceDebugTranscriptSnapshot {
  readonly rawInterim: string;
  readonly rawFinal: string;
  readonly segments: readonly VoiceDebugTranscriptSegment[];
}

export interface VoiceDebugErrorSnapshot {
  readonly normalizedCode: string;
  readonly providerCode?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly timestamp?: number;
  readonly recoverable: boolean;
  readonly intentionalAbort: boolean;
  readonly message?: string;
}

export interface VoiceDebugSnapshot {
  readonly provider: VoiceDebugProviderSnapshot;
  readonly turn: VoiceDebugTurnSnapshot;
  readonly transcript: VoiceDebugTranscriptSnapshot;
  readonly frozenContext?: VoiceDebugContextSnapshot;
  readonly currentContext?: VoiceDebugContextSnapshot;
  readonly contextDiff: VoiceDebugContextDiff;
  readonly lensPosition?: VoiceDebugLensPosition;
  readonly metrics: VoiceDebugMetrics;
  readonly events: readonly VoiceDebugEvent[];
  readonly recentTurns: readonly VoiceDebugRecentTurnRecord[];
  readonly error?: VoiceDebugErrorSnapshot;
  readonly completed?: Readonly<CompletedVoiceTurn>;
}
