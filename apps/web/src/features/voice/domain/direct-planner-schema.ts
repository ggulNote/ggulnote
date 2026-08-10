import type {
  AnnotationHighlightDirectCommand,
  AnnotationUnderlineDirectCommand,
  DirectEditorCommand,
  DirectPlannerResult,
  ExecutableCommandRelation,
  HistoryUndoDirectCommand,
  NavigationDirectCommand,
  TextReplaceContentDirectCommand,
} from "./direct-command-types";
import {
  DIRECT_SEMANTIC_UNITS,
  DIRECT_TARGET_OBJECT_TYPES,
  type DirectSemanticUnit,
  type DirectTargetObjectType,
  type TargetQuery,
} from "./target-query";

type UnknownRecord = Record<string, unknown>;

export class DirectPlannerResultValidationError extends Error {
  public readonly code = "PLANNER_INVALID_OUTPUT" as const;

  public constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "DirectPlannerResultValidationError";
  }
}

export type SafeDirectPlannerResultParse =
  | { success: true; data: DirectPlannerResult }
  | { success: false; error: DirectPlannerResultValidationError };

export function parseDirectPlannerResult(value: unknown): DirectPlannerResult {
  const result = readRecord(value, "result");
  const status = readString(result.status, "result.status");

  switch (status) {
    case "EXECUTABLE":
      assertOnlyKeys(result, [
        "status",
        "planId",
        "turnId",
        "sceneRevision",
        "normalizedIntent",
        "relation",
        "command",
      ], "result");
      return {
        status,
        planId: readNonEmptyString(result.planId, "result.planId"),
        turnId: readNonEmptyString(result.turnId, "result.turnId"),
        sceneRevision: readSceneRevision(result.sceneRevision, "result.sceneRevision"),
        normalizedIntent: readNonEmptyString(
          result.normalizedIntent,
          "result.normalizedIntent",
        ),
        relation: readExecutableRelation(result.relation, "result.relation"),
        command: parseDirectEditorCommand(result.command, "result.command"),
      };
    case "DEFER_SPATIAL":
    case "NEEDS_CLARIFICATION":
    case "UNSUPPORTED":
      assertOnlyKeys(result, ["status", "turnId", "reasonCode"], "result");
      return {
        status,
        turnId: readNonEmptyString(result.turnId, "result.turnId"),
        reasonCode: readNonEmptyString(result.reasonCode, "result.reasonCode"),
      };
    case "CANCELLED":
      assertOnlyKeys(result, ["status", "turnId"], "result");
      return {
        status,
        turnId: readNonEmptyString(result.turnId, "result.turnId"),
      };
    default:
      return fail("result.status", `unsupported planner status: ${status}`);
  }
}

export function safeParseDirectPlannerResult(value: unknown): SafeDirectPlannerResultParse {
  try {
    return { success: true, data: parseDirectPlannerResult(value) };
  } catch (error) {
    if (error instanceof DirectPlannerResultValidationError) {
      return { success: false, error };
    }
    throw error;
  }
}

export function parseDirectEditorCommand(
  value: unknown,
  path = "command",
): DirectEditorCommand {
  const command = readRecord(value, path);
  assertOnlyKeys(command, ["capability", "operation", "target", "payload"], path);
  const capability = readString(command.capability, `${path}.capability`);
  const operation = readString(command.operation, `${path}.operation`);

  switch (capability) {
    case "annotation":
      if (operation === "underline") {
        return parseUnderlineCommand(command, path);
      }
      if (operation === "highlight") {
        return parseHighlightCommand(command, path);
      }
      return fail(`${path}.operation`, `unsupported annotation operation: ${operation}`);
    case "navigation":
      if (operation === "next_page" || operation === "previous_page") {
        return parseNavigationCommand(command, operation, path);
      }
      return fail(`${path}.operation`, `unsupported navigation operation: ${operation}`);
    case "history":
      if (operation === "undo") {
        return parseUndoCommand(command, path);
      }
      return fail(`${path}.operation`, `unsupported history operation: ${operation}`);
    case "text":
      if (operation === "replace_content") {
        return parseTextReplaceCommand(command, path);
      }
      return fail(`${path}.operation`, `unsupported text operation: ${operation}`);
    default:
      return fail(`${path}.capability`, `unsupported capability: ${capability}`);
  }
}

export function parseTargetQuery(
  value: unknown,
  path = "target",
): TargetQuery {
  return readTargetQuery(value, path, 0);
}

function parseUnderlineCommand(
  command: UnknownRecord,
  path: string,
): AnnotationUnderlineDirectCommand {
  const payload = readRecord(command.payload, `${path}.payload`);
  assertOnlyKeys(payload, [], `${path}.payload`);
  return {
    capability: "annotation",
    operation: "underline",
    target: parseTargetQuery(command.target, `${path}.target`),
    payload: {},
  };
}

function parseHighlightCommand(
  command: UnknownRecord,
  path: string,
): AnnotationHighlightDirectCommand {
  const payload = readRecord(command.payload, `${path}.payload`);
  assertOnlyKeys(payload, ["color"], `${path}.payload`);
  const color = payload.color;

  return {
    capability: "annotation",
    operation: "highlight",
    target: parseTargetQuery(command.target, `${path}.target`),
    payload: color === undefined
      ? {}
      : { color: readNonEmptyString(color, `${path}.payload.color`) },
  };
}

function parseNavigationCommand(
  command: UnknownRecord,
  operation: NavigationDirectCommand["operation"],
  path: string,
): NavigationDirectCommand {
  const payload = readRecord(command.payload, `${path}.payload`);
  assertOnlyKeys(payload, [], `${path}.payload`);
  return {
    capability: "navigation",
    operation,
    target: readSingleTarget(command.target, "CURRENT_PAGE", `${path}.target`),
    payload: {},
  };
}

function parseUndoCommand(
  command: UnknownRecord,
  path: string,
): HistoryUndoDirectCommand {
  const payload = readRecord(command.payload, `${path}.payload`);
  assertOnlyKeys(payload, [], `${path}.payload`);
  return {
    capability: "history",
    operation: "undo",
    target: readSingleTarget(command.target, "LAST_OPERATION", `${path}.target`),
    payload: {},
  };
}

function parseTextReplaceCommand(
  command: UnknownRecord,
  path: string,
): TextReplaceContentDirectCommand {
  const payload = readRecord(command.payload, `${path}.payload`);
  assertOnlyKeys(payload, ["text"], `${path}.payload`);
  return {
    capability: "text",
    operation: "replace_content",
    target: parseTargetQuery(command.target, `${path}.target`),
    payload: {
      text: readString(payload.text, `${path}.payload.text`),
    },
  };
}

function readTargetQuery(
  value: unknown,
  path: string,
  depth: number,
): TargetQuery {
  if (depth > 4) {
    return fail(path, "target query nesting is too deep");
  }
  const target = readRecord(value, path);
  const kind = readString(target.kind, `${path}.kind`);

  switch (kind) {
    case "text_span": {
      assertOnlyKeys(target, ["kind", "quote", "startAnchor", "endAnchor"], path);
      const quote = readOptionalNonEmptyString(target.quote, `${path}.quote`);
      const startAnchor = readOptionalNonEmptyString(
        target.startAnchor,
        `${path}.startAnchor`,
      );
      const endAnchor = readOptionalNonEmptyString(
        target.endAnchor,
        `${path}.endAnchor`,
      );
      if (quote === undefined && (startAnchor === undefined || endAnchor === undefined)) {
        return fail(path, "text_span requires quote or both startAnchor and endAnchor");
      }
      return {
        kind,
        ...(quote === undefined ? {} : { quote }),
        ...(startAnchor === undefined ? {} : { startAnchor }),
        ...(endAnchor === undefined ? {} : { endAnchor }),
      };
    }
    case "semantic_unit": {
      assertOnlyKeys(target, ["kind", "unit", "query", "relation"], path);
      const unit = readSemanticUnit(target.unit, `${path}.unit`);
      const query = readOptionalNonEmptyString(target.query, `${path}.query`);
      const relation = target.relation === undefined
        ? undefined
        : readFocusedRelation(target.relation, `${path}.relation`);
      if (query === undefined && relation === undefined) {
        return fail(path, "semantic_unit requires query or focused relation");
      }
      return {
        kind,
        unit,
        ...(query === undefined ? {} : { query }),
        ...(relation === undefined ? {} : { relation }),
      };
    }
    case "object": {
      assertOnlyKeys(target, ["kind", "objectType", "query", "relation"], path);
      const objectType = readObjectType(target.objectType, `${path}.objectType`);
      const query = readOptionalNonEmptyString(target.query, `${path}.query`);
      const relation = target.relation === undefined
        ? undefined
        : readObjectRelation(target.relation, `${path}.relation`);
      return {
        kind,
        objectType,
        ...(query === undefined ? {} : { query }),
        ...(relation === undefined ? {} : { relation }),
      };
    }
    case "relative": {
      assertOnlyKeys(target, ["kind", "relation", "objectType"], path);
      const relation = readRelativeRelation(target.relation, `${path}.relation`);
      const objectType = target.objectType === undefined
        ? undefined
        : readObjectType(target.objectType, `${path}.objectType`);
      return {
        kind,
        relation,
        ...(objectType === undefined ? {} : { objectType }),
      };
    }
    case "subrange":
      assertOnlyKeys(target, ["kind", "parent", "query"], path);
      return {
        kind,
        parent: readTargetQuery(target.parent, `${path}.parent`, depth + 1),
        query: readNonEmptyString(target.query, `${path}.query`),
      };
    default:
      return fail(`${path}.kind`, `unsupported target query kind: ${kind}`);
  }
}

function readSemanticUnit(value: unknown, path: string): DirectSemanticUnit {
  const unit = readString(value, path);
  if ((DIRECT_SEMANTIC_UNITS as readonly string[]).includes(unit)) {
    return unit as DirectSemanticUnit;
  }
  return fail(path, `unsupported semantic unit: ${unit}`);
}

function readObjectType(value: unknown, path: string): DirectTargetObjectType {
  const objectType = readString(value, path);
  if ((DIRECT_TARGET_OBJECT_TYPES as readonly string[]).includes(objectType)) {
    return objectType as DirectTargetObjectType;
  }
  return fail(path, `unsupported target object type: ${objectType}`);
}

function readFocusedRelation(value: unknown, path: string): "focused" {
  const relation = readString(value, path);
  if (relation === "focused") return relation;
  return fail(path, `unsupported semantic relation: ${relation}`);
}

function readObjectRelation(
  value: unknown,
  path: string,
): "focused" | "recent" | "last_target" {
  const relation = readString(value, path);
  if (relation === "focused" || relation === "recent" || relation === "last_target") {
    return relation;
  }
  return fail(path, `unsupported object relation: ${relation}`);
}

function readRelativeRelation(
  value: unknown,
  path: string,
): "focused" | "last_target" | "recent" {
  const relation = readString(value, path);
  if (relation === "focused" || relation === "last_target" || relation === "recent") {
    return relation;
  }
  return fail(path, `unsupported relative relation: ${relation}`);
}

function readSingleTarget<TKind extends "CURRENT_PAGE" | "LAST_OPERATION">(
  value: unknown,
  expectedKind: TKind,
  path: string,
): { kind: TKind } {
  const target = readRecord(value, path);
  assertOnlyKeys(target, ["kind"], path);
  const kind = readString(target.kind, `${path}.kind`);
  if (kind !== expectedKind) {
    return fail(`${path}.kind`, `expected ${expectedKind}, received ${kind}`);
  }
  return { kind: expectedKind };
}

function readExecutableRelation(value: unknown, path: string): ExecutableCommandRelation {
  const relation = readString(value, path);
  if (relation === "NEW" || relation === "REVISE_LAST" || relation === "CONTINUE") {
    return relation;
  }
  if (relation === "CANCEL") {
    return fail(path, "CANCEL must use the CANCELLED planner result");
  }
  return fail(path, `unsupported command relation: ${relation}`);
}

function readSceneRevision(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return fail(path, "expected a non-negative integer");
  }
  return value;
}

function readRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "expected an object");
  }
  return value as UnknownRecord;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    return fail(path, "expected a string");
  }
  return value;
}

function readNonEmptyString(value: unknown, path: string): string {
  const result = readString(value, path);
  if (result.trim().length === 0) {
    return fail(path, "expected a non-empty string");
  }
  return result;
}

function readOptionalNonEmptyString(
  value: unknown,
  path: string,
): string | undefined {
  return value === undefined ? undefined : readNonEmptyString(value, path);
}

function assertOnlyKeys(
  value: UnknownRecord,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey !== undefined) {
    fail(`${path}.${unknownKey}`, "unexpected field");
  }
}

function fail(path: string, message: string): never {
  throw new DirectPlannerResultValidationError(path, message);
}
