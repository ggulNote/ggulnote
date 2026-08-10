import type {
  DirectCommandPlannerFrozenContext,
  DirectCommandTurnId,
} from "./direct-command-types";
import type {
  DirectSemanticUnit,
  ObjectTargetQuery,
  SemanticUnitTargetQuery,
  TextSpanTargetQuery,
} from "./target-query";
import type {
  PageTargetCandidateType,
  PageTargetSource,
} from "./target-grounding-types";

export const TARGET_RECOVERY_LIMITS = {
  semanticCandidates: 24,
  objectCandidates: 16,
  anchorCandidatesPerSide: 12,
  candidateTextChars: 800,
  anchorContextChars: 240,
  termHypotheses: 8,
  hypothesisCandidates: 3,
  contextualTerms: 8,
  asrAlternatives: 3,
} as const;

export type GroundedTargetRecoveryKind =
  | "semantic_unit"
  | "text_span"
  | "object";

export interface TargetRecoveryTermEvidence {
  rawSpan: string;
  candidates: readonly string[];
}

export interface TargetRecoveryNumberEvidence {
  raw: string;
  kind: "integer" | "decimal" | "percent" | "sequence" | "power";
  normalized: string;
}

export interface TargetRecoverySpeechEvidence {
  termHypotheses: readonly TargetRecoveryTermEvidence[];
  numberHypotheses: readonly TargetRecoveryNumberEvidence[];
  mathHypothesis?: {
    status: "NORMALIZED" | "AMBIGUOUS" | "UNSUPPORTED";
    normalizedText?: string;
  };
  contextualTerms: readonly string[];
  asrAlternatives: readonly string[];
}

export interface GroundedTargetRecoveryCandidate {
  label: string;
  source: PageTargetSource;
  type: PageTargetCandidateType;
  text?: string;
  semanticUnit?: DirectSemanticUnit;
  context?: string;
}

export interface GroundedTextAnchorCandidate {
  label: string;
  text: string;
  context: string;
}

interface GroundedTargetRecoveryInputBase {
  turnId: DirectCommandTurnId;
  rawFinalTranscript: string;
  normalizedIntent: string;
  frozenContext: Pick<
    DirectCommandPlannerFrozenContext,
    "pageId" | "sceneMode" | "sceneRevision" | "focusSource"
  >;
  speechEvidence?: TargetRecoverySpeechEvidence;
}

export interface SemanticUnitRecoveryInput
extends GroundedTargetRecoveryInputBase {
  kind: "semantic_unit";
  targetQuery: SemanticUnitTargetQuery;
  candidates: readonly GroundedTargetRecoveryCandidate[];
}

export interface ObjectRecoveryInput extends GroundedTargetRecoveryInputBase {
  kind: "object";
  targetQuery: ObjectTargetQuery;
  candidates: readonly GroundedTargetRecoveryCandidate[];
}

export interface TextSpanRecoveryInput extends GroundedTargetRecoveryInputBase {
  kind: "text_span";
  targetQuery: TextSpanTargetQuery;
  startCandidates: readonly GroundedTextAnchorCandidate[];
  endCandidates: readonly GroundedTextAnchorCandidate[];
}

export type GroundedTargetRecoveryInput =
  | SemanticUnitRecoveryInput
  | ObjectRecoveryInput
  | TextSpanRecoveryInput;

export type GroundedTargetRecoveryResult =
  | { status: "NONE" }
  | { status: "SELECTED"; candidateLabel: string }
  | { status: "SELECTED"; startLabel: string; endLabel: string };

export type TargetRecoveryErrorCode =
  | "RECOVERY_UNAVAILABLE"
  | "RECOVERY_TIMEOUT"
  | "RECOVERY_INVALID_OUTPUT"
  | "RECOVERY_ABORTED";
