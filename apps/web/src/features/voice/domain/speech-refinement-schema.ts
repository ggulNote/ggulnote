import { DIRECT_COMMAND_NAMES, type DirectCommandName } from "./direct-command-types";
import {
  SPEECH_REFINEMENT_CORRECTION_KINDS,
  type SpeechRefinementCorrectionKind,
  type SpeechRefinementInput,
  type SpeechRefinementProviderResult,
} from "./speech-refinement-types";

type UnknownRecord = Record<string, unknown>;

export class SpeechRefinementValidationError extends Error {
  public constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "SpeechRefinementValidationError";
  }
}

export function parseSpeechRefinementInput(value: unknown): SpeechRefinementInput {
  const input = readRecord(value, "input");
  assertOnlyKeys(input, ["rawTranscript", "language", "allowedCommands"], "input");
  return {
    rawTranscript: readNonEmptyString(input.rawTranscript, "input.rawTranscript"),
    language: readNonEmptyString(input.language, "input.language"),
    allowedCommands: readArray(input.allowedCommands, "input.allowedCommands")
      .map((item, index) => readCommand(item, `input.allowedCommands[${index}]`)),
  };
}

export function parseSpeechRefinementProviderResult(
  value: unknown,
): SpeechRefinementProviderResult {
  const result = readRecord(value, "result");
  const status = readString(result.status, "result.status");
  if (status === "UNCHANGED") {
    assertOnlyKeys(result, ["status"], "result");
    return { status };
  }
  if (status !== "REFINED") return fail("result.status", `unsupported status: ${status}`);
  assertOnlyKeys(result, ["status", "refinedTranscript", "corrections"], "result");
  return {
    status,
    refinedTranscript: readNonEmptyString(result.refinedTranscript, "result.refinedTranscript"),
    corrections: readArray(result.corrections, "result.corrections")
      .map((item, index) => readCorrection(item, `result.corrections[${index}]`)),
  };
}

export const parseSpeechRefinementResult =
  parseSpeechRefinementProviderResult;

function readCorrection(value: unknown, path: string): { kind: SpeechRefinementCorrectionKind } {
  const correction = readRecord(value, path);
  assertOnlyKeys(correction, ["kind"], path);
  const kind = readString(correction.kind, `${path}.kind`);
  if ((SPEECH_REFINEMENT_CORRECTION_KINDS as readonly string[]).includes(kind)) {
    return { kind: kind as SpeechRefinementCorrectionKind };
  }
  return fail(`${path}.kind`, `unsupported correction kind: ${kind}`);
}

function readCommand(value: unknown, path: string): DirectCommandName {
  const command = readString(value, path);
  if ((DIRECT_COMMAND_NAMES as readonly string[]).includes(command)) {
    return command as DirectCommandName;
  }
  return fail(path, `unsupported direct command: ${command}`);
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

function readString(value: unknown, path: string): string {
  if (typeof value !== "string") return fail(path, "expected a string");
  return value;
}

function readNonEmptyString(value: unknown, path: string): string {
  const text = readString(value, path);
  if (text.trim().length === 0) return fail(path, "expected a non-empty string");
  return text;
}

function assertOnlyKeys(value: UnknownRecord, allowedKeys: readonly string[], path: string): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) fail(`${path}.${unknown}`, "unexpected field");
}

function fail(path: string, message: string): never {
  throw new SpeechRefinementValidationError(path, message);
}
