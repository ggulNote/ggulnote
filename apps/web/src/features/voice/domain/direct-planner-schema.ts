import type {
  AnnotationHighlightDirectCommand,
  AnnotationUnderlineDirectCommand,
  DirectEditorCommand,
  DirectFocusTargetRef,
  DirectPlannerResult,
  ExecutableCommandRelation,
  HistoryUndoDirectCommand,
  NavigationDirectCommand,
  TextReplaceContentDirectCommand,
} from "./direct-command-types";

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

function parseUnderlineCommand(
  command: UnknownRecord,
  path: string,
): AnnotationUnderlineDirectCommand {
  const payload = readRecord(command.payload, `${path}.payload`);
  assertOnlyKeys(payload, [], `${path}.payload`);
  return {
    capability: "annotation",
    operation: "underline",
    target: readFocusTarget(command.target, `${path}.target`),
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
    target: readFocusTarget(command.target, `${path}.target`),
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
    target: readFocusTarget(command.target, `${path}.target`),
    payload: {
      text: readString(payload.text, `${path}.payload.text`),
    },
  };
}

function readFocusTarget(value: unknown, path: string): DirectFocusTargetRef {
  const target = readRecord(value, path);
  assertOnlyKeys(target, ["kind"], path);
  const kind = readString(target.kind, `${path}.kind`);
  if (kind === "FROZEN_FOCUS" || kind === "LAST_TARGET") {
    return { kind };
  }
  return fail(`${path}.kind`, `unsupported focus target: ${kind}`);
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
