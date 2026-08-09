import type {
  EditorHistoryAction,
  EditorOperation,
  PageId,
  Rect,
  SceneObjectKind,
  SceneSnapshot,
} from "@ggulnote/editor-core";
import type { PageSemanticModel } from "@ggulnote/document-core";
import type { DirectCommandPlannerInput } from "./direct-command-types";
import type {
  DirectSemanticUnit,
  DirectTargetObjectType,
  TargetQuery,
} from "./target-query";
import type {
  CompletedVoiceTurn,
  FrozenVoiceTurnContext,
} from "./voice-turn-types";

export type PageTargetSource = "pdf" | "ggulnote";
export type PageTargetCandidateType = SceneObjectKind | "sentence";

export interface DirectRecentOperation {
  operationId: EditorOperation["operationId"];
  pageId: EditorOperation["pageId"];
  operationType: EditorOperation["type"];
  annotationId: EditorOperation["annotationId"];
  createdAt: EditorOperation["createdAt"];
  historyAction?: EditorHistoryAction;
  targetSceneObjectId?: string;
}

export interface PageTargetCandidate {
  candidateId: string;
  source: PageTargetSource;
  type: PageTargetCandidateType;
  pageId: PageId;
  sceneObjectId?: string;
  semanticObjectId?: string;
  objectRevision?: number;
  text?: string;
  bounds?: Rect;
  editable: boolean;
  annotatable: boolean;
  semanticUnit?: DirectSemanticUnit;
  readingOrder?: number;
  createdAt?: number;
  operationId?: EditorOperation["operationId"];
}

export interface PageTargetCatalog {
  pageId: PageId;
  sceneRevision: SceneSnapshot["sceneRevision"];
  candidates: readonly PageTargetCandidate[];
}

export interface FrozenPageGroundingSnapshot {
  scene: SceneSnapshot;
  semanticModel?: PageSemanticModel;
}

export interface FrozenSceneSnapshotReference {
  pageId: PageId;
  sceneRevision: SceneSnapshot["sceneRevision"];
}

export interface DirectCommandContext {
  turn: CompletedVoiceTurn;
  frozenContext: FrozenVoiceTurnContext;
  pageTargetCatalog: PageTargetCatalog;
  recentOperations: readonly DirectRecentOperation[];
  plannerContext: DirectCommandPlannerInput;
}

export type DirectCommandContextBuildResult =
  | { status: "READY"; context: DirectCommandContext }
  | { status: "ERROR"; errorCode: "EMPTY_TRANSCRIPT" | "STALE_SCENE" };

export interface CandidateEvidence {
  typeMatch: number | null;
  lexicalMatch: number | null;
  fuzzyMatch: number | null;
  semanticMatch: number | null;
  mathMatch: number | null;
  temporalMatch: number | null;
  structuralMatch: number | null;
  focusMatch: number | null;
}

export interface RankedTargetCandidate {
  candidate: PageTargetCandidate;
  score: number;
  evidence: CandidateEvidence;
}

interface ResolvedTargetBase {
  candidateId: string;
  pageId: PageId;
  sceneRevision: SceneSnapshot["sceneRevision"];
  source: PageTargetSource;
  type: PageTargetCandidateType;
  editable: boolean;
  annotatable: boolean;
}

export interface ResolvedTextSpan extends ResolvedTargetBase {
  kind: "text_span";
  objectId?: string;
  text: string;
  bounds?: readonly Rect[];
}

export interface ResolvedObject extends ResolvedTargetBase {
  kind: "object";
  objectId: string;
  bounds?: Rect;
}

export type ResolvedTarget = ResolvedTextSpan | ResolvedObject;

export type TargetResolutionReasonCode =
  | "FOCUS_NOT_AVAILABLE"
  | "LAST_TARGET_NOT_AVAILABLE"
  | "NO_MATCH"
  | "LOW_CONFIDENCE"
  | "AMBIGUOUS_MATCH"
  | "SUBRANGE_UNSUPPORTED"
  | "TARGET_KIND_UNSUPPORTED";

export type TargetResolutionResult =
  | {
      status: "RESOLVED";
      target: ResolvedTarget;
      confidence: number;
      evidence: CandidateEvidence;
    }
  | {
      status: "AMBIGUOUS";
      candidates: readonly RankedTargetCandidate[];
      reasonCode: "AMBIGUOUS_MATCH";
    }
  | {
      status: "NOT_FOUND";
      reasonCode: Exclude<TargetResolutionReasonCode, "AMBIGUOUS_MATCH">;
    };

export interface TargetResolutionPolicy {
  minResolvedScore: number;
  minResolvedMargin: number;
  maxAmbiguousCandidates: number;
}

export const DEFAULT_TARGET_RESOLUTION_POLICY = {
  minResolvedScore: 0.5,
  minResolvedMargin: 0.12,
  maxAmbiguousCandidates: 4,
} satisfies TargetResolutionPolicy;

export interface TargetResolutionInput {
  query: TargetQuery;
  catalog: PageTargetCatalog;
  frozenContext: FrozenVoiceTurnContext;
  recentOperations: readonly DirectRecentOperation[];
}

export function isDirectTargetObjectType(
  value: PageTargetCandidateType,
): value is DirectTargetObjectType {
  return value !== "sentence";
}
