import type { DirectOperationRecord } from "../../domain";
import { cloneEntityRef, type EntityRef } from "./entity-ref";

export interface OperationLedgerRecord {
  readonly operationId: string;
  readonly sourceTurnId: string;
  readonly toolId: string;
  readonly operation: string;
  readonly inputRefs: readonly EntityRef[];
  readonly outputRefs: readonly EntityRef[];
  readonly createdAt: number;
  readonly undoGroupId: string;
}

export interface OperationLedgerQuery {
  readonly pageId?: string;
  readonly sourceTurnId?: string;
  readonly toolId?: string;
  readonly limit?: number;
}

export interface DirectOperationRecordSource {
  getRecords(): readonly DirectOperationRecord[];
}

export interface DirectCommandOperationLedgerAdapterOptions {
  readonly records: DirectOperationRecordSource;
  readonly resolveOutputObject: (
    record: DirectOperationRecord,
  ) => { readonly objectId: string; readonly pageId: string } | undefined;
}

export class DirectCommandOperationLedgerAdapter {
  public constructor(
    private readonly options: DirectCommandOperationLedgerAdapterOptions,
  ) {}

  public list(query: OperationLedgerQuery = {}): readonly OperationLedgerRecord[] {
    const records = this.options.records.getRecords()
      .filter((record) => {
        const output = this.options.resolveOutputObject(record);
        return (query.sourceTurnId === undefined || record.turnId === query.sourceTurnId)
          && (
            query.pageId === undefined
            || (record.target.kind === "grounded"
              && record.target.pageId === query.pageId)
            || output?.pageId === query.pageId
          )
          && (
            query.toolId === undefined
            || toolId(record) === query.toolId
          );
      })
      .sort((left, right) => right.committedAt - left.committedAt)
      .slice(0, normalizeLimit(query.limit))
      .map((record) => this.toLedgerRecord(record));
    return Object.freeze(records);
  }

  public getRecentOutputs(query: OperationLedgerQuery = {}): readonly EntityRef[] {
    const seen = new Set<string>();
    const output: EntityRef[] = [];
    for (const record of this.list(query)) {
      for (const reference of record.outputRefs) {
        const key = entityRefKey(reference);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(cloneEntityRef(reference));
      }
    }
    return Object.freeze(output);
  }

  private toLedgerRecord(record: DirectOperationRecord): OperationLedgerRecord {
    const inputRefs = inputReferences(record);
    const outputObject = this.options.resolveOutputObject(record);
    const operationId = record.editorOperationId ?? record.planId;
    return Object.freeze({
      operationId,
      sourceTurnId: record.turnId,
      toolId: toolId(record),
      operation: record.command.operation,
      inputRefs: Object.freeze(inputRefs),
      outputRefs: Object.freeze(outputObject === undefined
        ? []
        : [{ kind: "OBJECT" as const, objectId: outputObject.objectId }]),
      createdAt: record.committedAt,
      // Editor Core currently records one command per undo unit.
      undoGroupId: operationId,
    });
  }
}

function inputReferences(record: DirectOperationRecord): readonly EntityRef[] {
  if (record.target.kind === "grounded") {
    return record.target.objectId === undefined
      ? []
      : [{ kind: "OBJECT", objectId: record.target.objectId }];
  }
  return [];
}

function toolId(record: DirectOperationRecord): string {
  return `${record.command.capability}.${record.command.operation}`;
}

function entityRefKey(reference: EntityRef): string {
  switch (reference.kind) {
    case "OBJECT":
      return `object:${reference.objectId}`;
    case "TEXT_RANGE":
      return `range:${reference.rangeId}`;
    case "OBJECT_PART":
      return `part:${reference.objectId}:${reference.partId}`;
    case "PAGE":
      return `page:${reference.pageId}`;
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError("Operation ledger limit must be a non-negative integer.");
  }
  return limit;
}
