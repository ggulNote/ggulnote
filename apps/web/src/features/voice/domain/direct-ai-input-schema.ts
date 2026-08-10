import {
  DIRECT_COMMAND_NAMES,
  type DirectCommandName,
  type DirectCommandPlannerFocus,
  type DirectCommandPlannerInput,
  type DirectCommandPlannerRecentOperation,
} from "./direct-command-types";
import { parseDirectEditorCommand, parseTargetQuery } from "./direct-planner-schema";
import {
  DIRECT_TARGET_CANDIDATE_LABELS,
  type DirectTargetDisambiguationCandidate,
  type DirectTargetDisambiguationInput,
} from "./direct-target-disambiguation-types";
import {
  DIRECT_SEMANTIC_UNITS,
  DIRECT_TARGET_OBJECT_TYPES,
  type DirectSemanticUnit,
} from "./target-query";
import type { PageTargetCandidateType } from "./target-grounding-types";

type UnknownRecord = Record<string, unknown>;

export class DirectAiInputValidationError extends Error {
  public constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "DirectAiInputValidationError";
  }
}

export function parseDirectCommandPlannerInput(
  value: unknown,
): DirectCommandPlannerInput {
  const input = readRecord(value, "input");
  assertOnlyKeys(input, [
    "turn",
    "frozenContext",
    "lastOperation",
    "recentOperations",
    "allowedCommands",
  ], "input");

  const turn = readRecord(input.turn, "input.turn");
  assertOnlyKeys(
    turn,
    ["turnId", "language", "rawFinalTranscript", "refinedTranscript"],
    "input.turn",
  );
  const frozen = readRecord(input.frozenContext, "input.frozenContext");
  assertOnlyKeys(frozen, [
    "pageId",
    "sceneMode",
    "sceneRevision",
    "focusSource",
    "focusStale",
    "capturedAt",
    "focus",
  ], "input.frozenContext");

  const result: DirectCommandPlannerInput = {
    turn: {
      turnId: readNonEmptyString(turn.turnId, "input.turn.turnId"),
      language: readNonEmptyString(turn.language, "input.turn.language"),
      rawFinalTranscript: readString(
        turn.rawFinalTranscript,
        "input.turn.rawFinalTranscript",
      ),
      ...(turn.refinedTranscript === undefined
        ? {}
        : {
            refinedTranscript: readNonEmptyString(
              turn.refinedTranscript,
              "input.turn.refinedTranscript",
            ),
          }),
    },
    frozenContext: {
      pageId: readNonEmptyString(frozen.pageId, "input.frozenContext.pageId"),
      sceneMode: readSceneMode(frozen.sceneMode, "input.frozenContext.sceneMode"),
      sceneRevision: readRevision(
        frozen.sceneRevision,
        "input.frozenContext.sceneRevision",
      ),
      focusSource: readFocusSource(
        frozen.focusSource,
        "input.frozenContext.focusSource",
      ),
      focusStale: readBoolean(
        frozen.focusStale,
        "input.frozenContext.focusStale",
      ),
      capturedAt: readFiniteNumber(
        frozen.capturedAt,
        "input.frozenContext.capturedAt",
      ),
      focus: frozen.focus === null
        ? null
        : readPlannerFocus(frozen.focus, "input.frozenContext.focus"),
    },
    allowedCommands: readAllowedCommands(
      input.allowedCommands,
      "input.allowedCommands",
    ),
  };

  if (input.lastOperation !== undefined) {
    const operation = readRecord(input.lastOperation, "input.lastOperation");
    assertOnlyKeys(
      operation,
      ["operationId", "command", "targetSummary"],
      "input.lastOperation",
    );
    const targetSummary = operation.targetSummary === undefined
      ? undefined
      : readPlannerTargetSummary(
          operation.targetSummary,
          "input.lastOperation.targetSummary",
        );
    result.lastOperation = {
      ...(operation.operationId === undefined
        ? {}
        : {
            operationId: readNonEmptyString(
              operation.operationId,
              "input.lastOperation.operationId",
            ),
          }),
      command: parseDirectEditorCommand(
        operation.command,
        "input.lastOperation.command",
      ),
      ...(targetSummary === undefined ? {} : { targetSummary }),
    };
  }
  if (input.recentOperations !== undefined) {
    result.recentOperations = readArray(
      input.recentOperations,
      "input.recentOperations",
    ).map((operation, index) => readRecentOperation(
      operation,
      `input.recentOperations[${index}]`,
    ));
  }
  return result;
}

function readPlannerTargetSummary(value: unknown, path: string) {
  const summary = readRecord(value, path);
  assertOnlyKeys(summary, ["source", "type", "text"], path);
  return {
    source: readSource(summary.source, `${path}.source`),
    type: readCandidateType(summary.type, `${path}.type`),
    ...(summary.text === undefined
      ? {}
      : { text: readString(summary.text, `${path}.text`) }),
  };
}

export function parseDirectTargetDisambiguationInput(
  value: unknown,
): DirectTargetDisambiguationInput {
  const input = readRecord(value, "input");
  assertOnlyKeys(input, [
    "turnId",
    "rawFinalTranscript",
    "normalizedIntent",
    "targetQuery",
    "frozenContext",
    "candidates",
  ], "input");
  const frozen = readRecord(input.frozenContext, "input.frozenContext");
  assertOnlyKeys(frozen, [
    "pageId",
    "sceneMode",
    "sceneRevision",
    "focusSource",
  ], "input.frozenContext");
  const candidates = readArray(input.candidates, "input.candidates");
  if (candidates.length < 1 || candidates.length > 4) {
    return fail("input.candidates", "expected between 1 and 4 candidates");
  }
  return {
    turnId: readNonEmptyString(input.turnId, "input.turnId"),
    rawFinalTranscript: readNonEmptyString(
      input.rawFinalTranscript,
      "input.rawFinalTranscript",
    ),
    normalizedIntent: readNonEmptyString(
      input.normalizedIntent,
      "input.normalizedIntent",
    ),
    targetQuery: parseTargetQuery(input.targetQuery, "input.targetQuery"),
    frozenContext: {
      pageId: readNonEmptyString(frozen.pageId, "input.frozenContext.pageId"),
      sceneMode: readSceneMode(frozen.sceneMode, "input.frozenContext.sceneMode"),
      sceneRevision: readRevision(
        frozen.sceneRevision,
        "input.frozenContext.sceneRevision",
      ),
      focusSource: readFocusSource(
        frozen.focusSource,
        "input.frozenContext.focusSource",
      ),
    },
    candidates: candidates.map((candidate, index) => readDisambiguationCandidate(
      candidate,
      index,
      `input.candidates[${index}]`,
    )),
  };
}

function readPlannerFocus(value: unknown, path: string): DirectCommandPlannerFocus {
  const focus = readRecord(value, path);
  assertOnlyKeys(focus, [
    "kind",
    "source",
    "text",
    "editable",
    "annotatable",
    "bounds",
  ], path);
  const text = focus.text === undefined
    ? undefined
    : readString(focus.text, `${path}.text`);
  const bounds = focus.bounds === undefined
    ? undefined
    : readRect(focus.bounds, `${path}.bounds`);
  return {
    kind: readCandidateType(focus.kind, `${path}.kind`),
    source: readSource(focus.source, `${path}.source`),
    ...(text === undefined ? {} : { text }),
    editable: readBoolean(focus.editable, `${path}.editable`),
    annotatable: readBoolean(focus.annotatable, `${path}.annotatable`),
    ...(bounds === undefined ? {} : { bounds }),
  };
}

function readRecentOperation(
  value: unknown,
  path: string,
): DirectCommandPlannerRecentOperation {
  const operation = readRecord(value, path);
  assertOnlyKeys(operation, [
    "operationId",
    "operationType",
    "targetType",
    "createdAt",
  ], path);
  const targetType = operation.targetType === undefined
    ? undefined
    : readCandidateType(operation.targetType, `${path}.targetType`);
  return {
    operationId: readNonEmptyString(operation.operationId, `${path}.operationId`),
    operationType: readNonEmptyString(
      operation.operationType,
      `${path}.operationType`,
    ) as DirectCommandPlannerRecentOperation["operationType"],
    ...(targetType === undefined ? {} : { targetType }),
    createdAt: readFiniteNumber(operation.createdAt, `${path}.createdAt`),
  };
}

function readDisambiguationCandidate(
  value: unknown,
  index: number,
  path: string,
): DirectTargetDisambiguationCandidate {
  const candidate = readRecord(value, path);
  assertOnlyKeys(candidate, ["label", "source", "type", "text", "semanticUnit"], path);
  const expectedLabel = DIRECT_TARGET_CANDIDATE_LABELS[index];
  if (candidate.label !== expectedLabel) {
    return fail(`${path}.label`, `expected sequential label ${expectedLabel}`);
  }
  const text = candidate.text === undefined
    ? undefined
    : readString(candidate.text, `${path}.text`);
  const semanticUnit = candidate.semanticUnit === undefined
    ? undefined
    : readSemanticUnit(candidate.semanticUnit, `${path}.semanticUnit`);
  return {
    label: expectedLabel,
    source: readSource(candidate.source, `${path}.source`),
    type: readCandidateType(candidate.type, `${path}.type`),
    ...(text === undefined ? {} : { text }),
    ...(semanticUnit === undefined ? {} : { semanticUnit }),
  };
}

function readAllowedCommands(value: unknown, path: string): readonly DirectCommandName[] {
  return readArray(value, path).map((command, index) => {
    const name = readString(command, `${path}[${index}]`);
    if ((DIRECT_COMMAND_NAMES as readonly string[]).includes(name)) {
      return name as DirectCommandName;
    }
    return fail(`${path}[${index}]`, `unsupported direct command: ${name}`);
  });
}

function readCandidateType(value: unknown, path: string): PageTargetCandidateType {
  const type = readString(value, path);
  if (type === "sentence" || (DIRECT_TARGET_OBJECT_TYPES as readonly string[]).includes(type)) {
    return type as PageTargetCandidateType;
  }
  return fail(path, `unsupported candidate type: ${type}`);
}

function readSemanticUnit(value: unknown, path: string): DirectSemanticUnit {
  const unit = readString(value, path);
  if ((DIRECT_SEMANTIC_UNITS as readonly string[]).includes(unit)) {
    return unit as DirectSemanticUnit;
  }
  return fail(path, `unsupported semantic unit: ${unit}`);
}

function readSource(value: unknown, path: string): "pdf" | "ggulnote" {
  const source = readString(value, path);
  if (source === "pdf" || source === "ggulnote") return source;
  return fail(path, `unsupported target source: ${source}`);
}

function readSceneMode(value: unknown, path: string): "pdf" | "blank" {
  const mode = readString(value, path);
  if (mode === "pdf" || mode === "blank") return mode;
  return fail(path, `unsupported scene mode: ${mode}`);
}

function readFocusSource(
  value: unknown,
  path: string,
): "gaze" | "selection" | "recent-focus" | "page" | "none" {
  const source = readString(value, path);
  if (
    source === "gaze"
    || source === "selection"
    || source === "recent-focus"
    || source === "page"
    || source === "none"
  ) return source;
  return fail(path, `unsupported focus source: ${source}`);
}

function readRect(
  value: unknown,
  path: string,
): { x: number; y: number; width: number; height: number } {
  const rect = readRecord(value, path);
  assertOnlyKeys(rect, ["x", "y", "width", "height"], path);
  return {
    x: readFiniteNumber(rect.x, `${path}.x`),
    y: readFiniteNumber(rect.y, `${path}.y`),
    width: readFiniteNumber(rect.width, `${path}.width`),
    height: readFiniteNumber(rect.height, `${path}.height`),
  };
}

function readRevision(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return fail(path, "expected a non-negative integer");
  }
  return value;
}

function readFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(path, "expected a finite number");
  }
  return value;
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path, "expected a boolean");
  return value;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string") return fail(path, "expected a string");
  return value;
}

function readNonEmptyString(value: unknown, path: string): string {
  const text = readString(value, path);
  if (text.trim().length === 0) return fail(path, "expected a non-empty string");
  return text;
}

function readRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "expected an object");
  }
  return value as UnknownRecord;
}

function readArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) return fail(path, "expected an array");
  return value;
}

function assertOnlyKeys(
  value: UnknownRecord,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey !== undefined) fail(`${path}.${unknownKey}`, "unexpected field");
}

function fail(path: string, message: string): never {
  throw new DirectAiInputValidationError(path, message);
}
