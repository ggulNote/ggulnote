import type {
  AnnotationId,
  CapabilityId,
  EditorOperation,
  Rect,
} from "@ggulnote/editor-core";
import type { PageTargetCandidateType, PageTargetSource } from "./target-grounding-types";
import type {
  DirectCommandTarget,
  DirectControlTarget,
  TargetQuery,
} from "./target-query";
import type { SpatialPlacementQuery } from "./spatial-placement-query";
import type {
  CompletedVoiceTurn,
  FrozenVoiceTurnContext,
} from "./voice-turn-types";
import type { DirectCommandExecutionTimestamps } from "./direct-command-diagnostics-types";

export type CommandRelation = "NEW" | "REVISE_LAST" | "CONTINUE" | "CANCEL";

export type DirectTargetRef = DirectCommandTarget;
export type DirectFocusTargetRef = TargetQuery;
export type DirectCurrentPageTargetRef = Extract<DirectControlTarget, { kind: "CURRENT_PAGE" }>;
export type DirectLastOperationTargetRef = Extract<DirectControlTarget, { kind: "LAST_OPERATION" }>;

export type EmptyDirectCommandPayload = Record<string, never>;

export type AnnotationUnderlineDirectCommand = {
  capability: "annotation";
  operation: "underline";
  target: DirectFocusTargetRef;
  payload: EmptyDirectCommandPayload;
};

export type AnnotationHighlightDirectCommand = {
  capability: "annotation";
  operation: "highlight";
  target: DirectFocusTargetRef;
  payload: {
    color?: string;
  };
};

export type NavigationDirectCommand = {
  capability: "navigation";
  operation: "next_page" | "previous_page";
  target: DirectCurrentPageTargetRef;
  payload: EmptyDirectCommandPayload;
};

export type HistoryUndoDirectCommand = {
  capability: "history";
  operation: "undo";
  target: DirectLastOperationTargetRef;
  payload: EmptyDirectCommandPayload;
};

export type TextReplaceContentDirectCommand = {
  capability: "text";
  operation: "replace_content";
  target: DirectFocusTargetRef;
  payload: {
    text: string;
  };
};

export type TextCreateDirectCommand = {
  capability: "text";
  operation: "create";
  target: DirectCurrentPageTargetRef;
  payload: {
    text: string;
  };
};

export type DirectEditorCommand =
  | AnnotationUnderlineDirectCommand
  | AnnotationHighlightDirectCommand
  | NavigationDirectCommand
  | HistoryUndoDirectCommand
  | TextReplaceContentDirectCommand
  | TextCreateDirectCommand;

type ExistingDirectCapabilityId = Extract<
  CapabilityId,
  "annotation" | "navigation" | "text"
>;

export type DirectCapabilityId = ExistingDirectCapabilityId | "history";
export type DirectCommandOperation = DirectEditorCommand["operation"];

export const DIRECT_COMMAND_NAMES = [
  "annotation.underline",
  "annotation.highlight",
  "navigation.next_page",
  "navigation.previous_page",
  "history.undo",
  "text.replace_content",
  "text.create",
] as const;

export type DirectCommandName = (typeof DIRECT_COMMAND_NAMES)[number];

export type DirectCommandTurnId = CompletedVoiceTurn["id"];
export type DirectCommandPlanId = string;
export type DirectCommandSceneRevision = FrozenVoiceTurnContext["sceneRevision"];
export type DirectCommandOperationId = EditorOperation["operationId"];

export interface DirectCommandPlannerTurnInput {
  turnId: DirectCommandTurnId;
  language: CompletedVoiceTurn["language"];
  rawFinalTranscript: CompletedVoiceTurn["rawTranscript"];
  refinedTranscript?: string;
}

export interface DirectCommandPlannerFocus {
  kind: PageTargetCandidateType;
  source: PageTargetSource;
  text?: string;
  editable: boolean;
  annotatable: boolean;
  bounds?: Rect;
}

export type DirectCommandPlannerFrozenContext = Pick<
  FrozenVoiceTurnContext,
  | "pageId"
  | "sceneMode"
  | "sceneRevision"
  | "focusSource"
  | "focusStale"
  | "capturedAt"
> & {
  focus: DirectCommandPlannerFocus | null;
};

export interface DirectCommandPlannerLastOperation {
  operationId?: DirectCommandOperationId;
  command: DirectEditorCommand;
  targetSummary?: {
    source: PageTargetSource;
    type: PageTargetCandidateType;
    text?: string;
  };
}

export interface DirectCommandPlannerRecentOperation {
  operationId: DirectCommandOperationId;
  operationType: EditorOperation["type"];
  targetType?: PageTargetCandidateType;
  createdAt: EditorOperation["createdAt"];
}

export interface DirectCommandPlannerInput {
  turn: DirectCommandPlannerTurnInput;
  frozenContext: DirectCommandPlannerFrozenContext;
  lastOperation?: DirectCommandPlannerLastOperation;
  recentOperations?: readonly DirectCommandPlannerRecentOperation[];
  allowedCommands: readonly DirectCommandName[];
}

export type ExecutableCommandRelation = Exclude<CommandRelation, "CANCEL">;

export interface ExecutableDirectPlan {
  status: "EXECUTABLE";
  planId: DirectCommandPlanId;
  turnId: DirectCommandTurnId;
  sceneRevision: DirectCommandSceneRevision;
  normalizedIntent: string;
  relation: ExecutableCommandRelation;
  command: DirectEditorCommand;
  /** Spatial mutation subject. Omitted when placement creates a new draft. */
  targetQuery?: TargetQuery;
  placementQuery?: SpatialPlacementQuery;
}

export interface DeferredSpatialPlan {
  status: "DEFER_SPATIAL";
  turnId: DirectCommandTurnId;
  reasonCode: string;
}

export interface NeedsClarificationPlan {
  status: "NEEDS_CLARIFICATION";
  turnId: DirectCommandTurnId;
  reasonCode: string;
}

export interface UnsupportedDirectPlan {
  status: "UNSUPPORTED";
  turnId: DirectCommandTurnId;
  reasonCode: string;
}

export interface CancelledDirectPlan {
  status: "CANCELLED";
  turnId: DirectCommandTurnId;
}

export type DirectPlannerResult =
  | ExecutableDirectPlan
  | DeferredSpatialPlan
  | NeedsClarificationPlan
  | UnsupportedDirectPlan
  | CancelledDirectPlan;

export type DirectCommandRouteErrorCode =
  | "EMPTY_TRANSCRIPT"
  | "PLANNER_ERROR"
  | "PLANNER_UNAVAILABLE"
  | "PLANNER_TIMEOUT"
  | "PLANNER_INVALID_OUTPUT"
  | "INVALID_PLAN"
  | "TARGET_NOT_FOUND"
  | "TARGET_AMBIGUOUS"
  | "INVALID_TARGET"
  | "TARGET_NOT_EDITABLE"
  | "TARGET_NOT_ANNOTATABLE"
  | "TARGET_KIND_UNSUPPORTED"
  | "STALE_SCENE"
  | "SPATIAL_REQUIRED"
  | "NO_FEASIBLE_PLACEMENT"
  | "MULTIMODAL_UNRESOLVED"
  | "PREVIEW_UNAVAILABLE"
  | "PREVIEW_RENDER_FAILED"
  | "VALIDATION_FAILED"
  | "UNSUPPORTED_CAPABILITY"
  | "INVALID_SPATIAL_SCENE"
  | "UNSUPPORTED_COMMAND"
  | "DUPLICATE_TURN"
  | "COMPILE_FAILED"
  | "COMMIT_FAILED"
  | "REVISE_NOT_AVAILABLE"
  | "UNSUPPORTED_RELATION"
  | "UNDO_NOT_AVAILABLE"
  | "ABORTED";

export type DirectCommandExecutionResult =
  | {
      status: "COMMITTED";
      turnId: DirectCommandTurnId;
      planId: DirectCommandPlanId;
      operationId: DirectCommandOperationId;
      annotationId?: AnnotationId;
      executionTimestamps?: DirectCommandExecutionTimestamps;
    }
  | {
      status: "NAVIGATED";
      turnId: DirectCommandTurnId;
      direction: "next_page" | "previous_page";
      executionTimestamps?: DirectCommandExecutionTimestamps;
    }
  | {
      status: "UNDONE";
      turnId: DirectCommandTurnId;
      operationId?: DirectCommandOperationId;
      executionTimestamps?: DirectCommandExecutionTimestamps;
    }
  | {
      status: "ERROR";
      turnId: DirectCommandTurnId;
      errorCode: DirectCommandRouteErrorCode;
      executionTimestamps?: DirectCommandExecutionTimestamps;
    };

export type DirectCommandRouteResult =
  | DirectCommandExecutionResult
  | {
      status: "REVISED";
      turnId: DirectCommandTurnId;
      planId: DirectCommandPlanId;
      operationId: DirectCommandOperationId;
      annotationId?: AnnotationId;
      executionTimestamps?: DirectCommandExecutionTimestamps;
    }
  | { status: "DEFERRED_SPATIAL"; turnId: DirectCommandTurnId }
  | { status: "NEEDS_CLARIFICATION"; turnId: DirectCommandTurnId }
  | { status: "TARGET_NOT_FOUND"; turnId: DirectCommandTurnId }
  | { status: "TARGET_AMBIGUOUS"; turnId: DirectCommandTurnId }
  | { status: "UNSUPPORTED"; turnId: DirectCommandTurnId }
  | { status: "CANCELLED"; turnId: DirectCommandTurnId };
