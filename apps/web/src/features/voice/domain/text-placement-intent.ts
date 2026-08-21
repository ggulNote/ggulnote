import type { SpatialPlacementQuery } from "./spatial-placement-query";

export type TextPlacementMode =
  | "EXPLICIT_REGION"
  | "CONTEXTUAL_RELATIVE"
  | "AUTO_FREE_SPACE"
  | "AUTO_FLOW";

export type TextPlacementProvenance =
  | "PLANNER_EXPLICIT"
  | "TRANSCRIPT_RECOVERED"
  | "CONTEXT_INFERRED"
  | "SYSTEM_DEFAULT";

export type TextPlacementChoicePolicy =
  | "SEMANTIC_CONSTRAINT_REQUIRED"
  | "USER_DELEGATED_LAYOUT"
  | "WRITING_FLOW"
  | "EXPLICIT_REGION";

export type TextPlacementAutoFlowSource =
  | "FOCUS"
  | "LAST_TEXT"
  | "VIEWPORT"
  | "PAGE_ORIGIN";

export type TextPlacementRecoveryReason =
  | "MISSING_PLACEMENT_QUERY"
  | "PLACEMENT_CONFLICT_RECOVERED"
  | "GENERIC_PLANNER_PLACEMENT_DEFAULTED";

export interface NormalizedTextPlacement {
  readonly mode: TextPlacementMode;
  readonly provenance: TextPlacementProvenance;
  readonly choicePolicy: TextPlacementChoicePolicy;
  readonly effectiveQuery: SpatialPlacementQuery;
  readonly plannerPlacementPresent: boolean;
  readonly evidenceKind:
    | "NONE"
    | "EXPLICIT_REGION"
    | "CONTEXTUAL_RELATIVE"
    | "AUTO_FREE_SPACE";
  readonly evidenceTokens: readonly string[];
  readonly conflictRecovered: boolean;
  readonly recoveryApplied: boolean;
  readonly recoveryReason?: TextPlacementRecoveryReason;
  readonly autoFlowSource?: TextPlacementAutoFlowSource;
}
