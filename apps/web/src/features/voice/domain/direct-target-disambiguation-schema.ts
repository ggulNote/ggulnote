import {
  DIRECT_TARGET_CANDIDATE_LABELS,
  type DirectTargetCandidateLabel,
  type DirectTargetDisambiguationResult,
} from "./direct-target-disambiguation-types";

type UnknownRecord = Record<string, unknown>;

export class DirectTargetDisambiguationValidationError extends Error {
  public readonly code = "PLANNER_INVALID_OUTPUT" as const;

  public constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "DirectTargetDisambiguationValidationError";
  }
}

export function parseDirectTargetDisambiguationResult(
  value: unknown,
  candidateCount: number,
): DirectTargetDisambiguationResult {
  if (!Number.isInteger(candidateCount) || candidateCount < 1 || candidateCount > 4) {
    throw new RangeError("candidateCount must be an integer between 1 and 4.");
  }
  const result = readRecord(value, "result");
  const status = readString(result.status, "result.status");
  if (status === "NONE") {
    assertOnlyKeys(result, ["status"], "result");
    return { status };
  }
  if (status !== "SELECTED") {
    return fail("result.status", `unsupported disambiguation status: ${status}`);
  }
  assertOnlyKeys(result, ["status", "candidateLabel"], "result");
  const label = readCandidateLabel(result.candidateLabel, "result.candidateLabel");
  const selectedIndex = DIRECT_TARGET_CANDIDATE_LABELS.indexOf(label);
  if (selectedIndex >= candidateCount) {
    return fail(
      "result.candidateLabel",
      `${label} is outside the bounded candidate set`,
    );
  }
  return { status, candidateLabel: label };
}

function readCandidateLabel(
  value: unknown,
  path: string,
): DirectTargetCandidateLabel {
  const label = readString(value, path);
  if ((DIRECT_TARGET_CANDIDATE_LABELS as readonly string[]).includes(label)) {
    return label as DirectTargetCandidateLabel;
  }
  return fail(path, `unsupported candidate label: ${label}`);
}

function readRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "expected an object");
  }
  return value as UnknownRecord;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string") return fail(path, "expected a string");
  return value;
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
  throw new DirectTargetDisambiguationValidationError(path, message);
}
