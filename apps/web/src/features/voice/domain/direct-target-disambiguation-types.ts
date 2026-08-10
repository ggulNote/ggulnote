import type {
  DirectCommandTurnId,
  DirectCommandPlannerFrozenContext,
} from "./direct-command-types";
import type {
  DirectSemanticUnit,
  TargetQuery,
} from "./target-query";
import type {
  PageTargetCandidateType,
  PageTargetSource,
} from "./target-grounding-types";

export const DIRECT_TARGET_CANDIDATE_LABELS = ["C1", "C2", "C3", "C4"] as const;

export type DirectTargetCandidateLabel =
  (typeof DIRECT_TARGET_CANDIDATE_LABELS)[number];

export interface DirectTargetDisambiguationCandidate {
  label: DirectTargetCandidateLabel;
  source: PageTargetSource;
  type: PageTargetCandidateType;
  text?: string;
  semanticUnit?: DirectSemanticUnit;
}

export interface DirectTargetDisambiguationInput {
  turnId: DirectCommandTurnId;
  rawFinalTranscript: string;
  normalizedIntent: string;
  targetQuery: TargetQuery;
  frozenContext: Pick<
    DirectCommandPlannerFrozenContext,
    "pageId" | "sceneMode" | "sceneRevision" | "focusSource"
  >;
  candidates: readonly DirectTargetDisambiguationCandidate[];
}

export type DirectTargetDisambiguationResult =
  | {
      status: "SELECTED";
      candidateLabel: DirectTargetCandidateLabel;
    }
  | {
      status: "NONE";
    };
