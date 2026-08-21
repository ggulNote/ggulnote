import type {
  DirectCommandHistorySnapshot,
  DirectCommandRouteResult,
  DirectEditorCommand,
  DirectOperationRecord,
  DirectReusableTargetRecord,
  ReadyForDirectCommandExecution,
  ResolvedTarget,
  TargetQuery,
} from "../domain";

const DEFAULT_MAX_RECORDS = 32;
const MAX_TARGET_SUMMARY_CHARS = 240;

type SuccessfulDirectCommandRouteResult = Extract<
  DirectCommandRouteResult,
  { status: "COMMITTED" | "REVISED" | "NAVIGATED" | "UNDONE" }
>;

export interface DirectCommandHistoryContextOptions {
  maxRecords?: number;
  now?: () => number;
}

export class DirectCommandHistoryContext {
  private readonly maxRecords: number;
  private readonly now: () => number;
  private records: DirectOperationRecord[] = [];
  private lastReusableTarget: DirectReusableTargetRecord | null = null;

  public constructor(options: DirectCommandHistoryContextOptions = {}) {
    this.maxRecords = positiveInteger(
      options.maxRecords ?? DEFAULT_MAX_RECORDS,
      "maxRecords",
    );
    this.now = options.now ?? Date.now;
  }

  public getLastSuccessfulOperation(): DirectOperationRecord | null {
    const record = this.records.at(-1);
    return record === undefined ? null : cloneOperationRecord(record);
  }

  public getLastReusableTarget(): DirectReusableTargetRecord | null {
    return this.lastReusableTarget === null
      ? null
      : cloneReusableTarget(this.lastReusableTarget);
  }

  public getRecords(): readonly DirectOperationRecord[] {
    return this.records.map(cloneOperationRecord);
  }

  public snapshot(): DirectCommandHistorySnapshot {
    return {
      lastSuccessfulOperation: this.getLastSuccessfulOperation(),
      lastReusableTarget: this.getLastReusableTarget(),
    };
  }

  public recordSuccessfulExecution(
    ready: ReadyForDirectCommandExecution,
    result: SuccessfulDirectCommandRouteResult,
  ): DirectOperationRecord {
    const target = ready.target === undefined
      ? cloneControlTarget(ready.plan.command.target)
      : reusableTargetFromResolved(ready.target);
    const record: DirectOperationRecord = {
      turnId: ready.turnId,
      planId: ready.plan.planId,
      relation: ready.plan.relation,
      command: cloneCommand(ready.plan.command),
      target,
      resultStatus: result.status,
      ...("operationId" in result && result.operationId !== undefined
        ? { editorOperationId: result.operationId }
        : {}),
      ...("annotationId" in result && result.annotationId !== undefined
        ? { editorAnnotationId: result.annotationId }
        : {}),
      committedAt: this.now(),
    };

    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    if (ready.target !== undefined) {
      this.lastReusableTarget = reusableTargetFromResolved(ready.target);
    }
    return cloneOperationRecord(record);
  }

  public clear(): void {
    this.records = [];
    this.lastReusableTarget = null;
  }
}

function reusableTargetFromResolved(
  target: ResolvedTarget,
): DirectReusableTargetRecord {
  return {
    kind: "grounded",
    candidateId: target.candidateId,
    pageId: target.pageId,
    sceneRevision: target.sceneRevision,
    source: target.source,
    type: target.type,
    ...(target.objectId === undefined ? {} : { objectId: target.objectId }),
    ...(target.kind !== "text_span" || target.text.length === 0
      ? {}
      : {
          textSummary: target.text.slice(0, MAX_TARGET_SUMMARY_CHARS),
        }),
  };
}

function cloneOperationRecord(
  record: DirectOperationRecord,
): DirectOperationRecord {
  return {
    turnId: record.turnId,
    planId: record.planId,
    relation: record.relation,
    command: cloneCommand(record.command),
    target: record.target.kind === "grounded"
      ? cloneReusableTarget(record.target)
      : cloneControlTarget(record.target),
    resultStatus: record.resultStatus,
    ...(record.editorOperationId === undefined
      ? {}
      : { editorOperationId: record.editorOperationId }),
    ...(record.editorAnnotationId === undefined
      ? {}
      : { editorAnnotationId: record.editorAnnotationId }),
    committedAt: record.committedAt,
  };
}

function cloneReusableTarget(
  target: DirectReusableTargetRecord,
): DirectReusableTargetRecord {
  return {
    ...target,
    ...(target.objectId === undefined ? {} : { objectId: target.objectId }),
    ...(target.textSummary === undefined
      ? {}
      : { textSummary: target.textSummary }),
  };
}

function cloneControlTarget(
  target: DirectEditorCommand["target"],
): Extract<DirectEditorCommand["target"], { kind: "CURRENT_PAGE" | "LAST_OPERATION" }> {
  if (target.kind === "CURRENT_PAGE" || target.kind === "LAST_OPERATION") {
    return { kind: target.kind };
  }
  throw new Error("A successful control command requires a control target.");
}

function cloneCommand(command: DirectEditorCommand): DirectEditorCommand {
  switch (command.capability) {
    case "annotation":
      return command.operation === "underline"
        ? {
            capability: "annotation",
            operation: "underline",
            target: cloneTargetQuery(command.target),
            payload: {},
          }
        : {
            capability: "annotation",
            operation: "highlight",
            target: cloneTargetQuery(command.target),
            payload: command.payload.color === undefined
              ? {}
              : { color: command.payload.color },
          };
    case "text":
      return command.operation === "create"
        ? {
            capability: "text",
            operation: "create",
            target: { kind: "CURRENT_PAGE" },
            payload: { text: command.payload.text },
          }
        : {
            capability: "text",
            operation: "replace_content",
            target: cloneTargetQuery(command.target),
            payload: { text: command.payload.text },
          };
    case "navigation":
      return {
        capability: "navigation",
        operation: command.operation,
        target: { kind: "CURRENT_PAGE" },
        payload: {},
      };
    case "history":
      return {
        capability: "history",
        operation: "undo",
        target: { kind: "LAST_OPERATION" },
        payload: {},
      };
  }
}

function cloneTargetQuery(query: TargetQuery): TargetQuery {
  switch (query.kind) {
    case "relative":
      return {
        kind: "relative",
        relation: query.relation,
        ...(query.objectType === undefined
          ? {}
          : { objectType: query.objectType }),
      };
    case "text_span":
      return {
        kind: "text_span",
        ...(query.quote === undefined ? {} : { quote: query.quote }),
        ...(query.startAnchor === undefined
          ? {}
          : { startAnchor: query.startAnchor }),
        ...(query.endAnchor === undefined
          ? {}
          : { endAnchor: query.endAnchor }),
      };
    case "semantic_unit":
      return {
        kind: "semantic_unit",
        unit: query.unit,
        ...(query.query === undefined ? {} : { query: query.query }),
        ...(query.relation === undefined
          ? {}
          : { relation: query.relation }),
      };
    case "object":
      return {
        kind: "object",
        objectType: query.objectType,
        ...(query.query === undefined ? {} : { query: query.query }),
        ...(query.relation === undefined
          ? {}
          : { relation: query.relation }),
      };
    case "subrange":
      return {
        kind: "subrange",
        parent: cloneTargetQuery(query.parent),
        query: query.query,
      };
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}
