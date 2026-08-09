import type { AnnotationId } from "@ggulnote/editor-core";
import type {
  CommandRelation,
  DirectCommandOperationId,
  DirectCommandPlanId,
  DirectCommandTurnId,
  DirectEditorCommand,
} from "./direct-command-types";
import type { DirectControlTarget } from "./target-query";
import type {
  PageTargetCandidateType,
  PageTargetSource,
} from "./target-grounding-types";

export interface DirectReusableTargetRecord {
  kind: "grounded";
  candidateId: string;
  pageId: string;
  sceneRevision: number;
  source: PageTargetSource;
  type: PageTargetCandidateType;
  objectId?: string;
  textSummary?: string;
}

export type DirectOperationTargetRecord =
  | DirectReusableTargetRecord
  | DirectControlTarget;

export interface DirectOperationRecord {
  turnId: DirectCommandTurnId;
  planId: DirectCommandPlanId;
  relation: CommandRelation;
  command: DirectEditorCommand;
  target: DirectOperationTargetRecord;
  resultStatus: "COMMITTED" | "REVISED" | "NAVIGATED" | "UNDONE";
  editorOperationId?: DirectCommandOperationId;
  editorAnnotationId?: AnnotationId;
  committedAt: number;
}

export interface DirectCommandHistorySnapshot {
  lastSuccessfulOperation: DirectOperationRecord | null;
  lastReusableTarget: DirectReusableTargetRecord | null;
}
