import { parseTargetQuery } from "./direct-planner-schema";
import {
  TARGET_RECOVERY_LIMITS,
  type GroundedTargetRecoveryCandidate,
  type GroundedTargetRecoveryInput,
  type GroundedTargetRecoveryResult,
  type GroundedTextSpanPairCandidate,
  type TargetRecoverySpeechEvidence,
} from "./grounded-target-recovery-types";
import {
  DIRECT_SEMANTIC_UNITS,
  DIRECT_TARGET_OBJECT_TYPES,
} from "./target-query";

type UnknownRecord = Record<string, unknown>;

export class GroundedTargetRecoveryValidationError extends Error {
  public constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "GroundedTargetRecoveryValidationError";
  }
}

export function parseGroundedTargetRecoveryInput(
  value: unknown,
): GroundedTargetRecoveryInput {
  const input = readRecord(value, "input");
  assertOnlyKeys(input, [
    "kind",
    "turnId",
    "rawFinalTranscript",
    "normalizedIntent",
    "targetQuery",
    "frozenContext",
    "speechEvidence",
    "candidates",
    "pairCandidates",
  ], "input");
  const kind = readRecoveryKind(input.kind, "input.kind");
  const targetQuery = parseTargetQuery(input.targetQuery, "input.targetQuery");
  if (targetQuery.kind !== kind) {
    return fail("input.targetQuery.kind", `expected ${kind}`);
  }
  const frozen = readRecord(input.frozenContext, "input.frozenContext");
  assertOnlyKeys(frozen, [
    "pageId",
    "sceneMode",
    "sceneRevision",
    "focusSource",
  ], "input.frozenContext");
  const base = {
    turnId: readNonEmptyString(input.turnId, "input.turnId"),
    rawFinalTranscript: readNonEmptyString(
      input.rawFinalTranscript,
      "input.rawFinalTranscript",
    ),
    normalizedIntent: readNonEmptyString(
      input.normalizedIntent,
      "input.normalizedIntent",
    ),
    frozenContext: {
      pageId: readNonEmptyString(frozen.pageId, "input.frozenContext.pageId"),
      sceneMode: readEnum(frozen.sceneMode, ["pdf", "blank"], "input.frozenContext.sceneMode"),
      sceneRevision: readNonNegativeInteger(
        frozen.sceneRevision,
        "input.frozenContext.sceneRevision",
      ),
      focusSource: readEnum(frozen.focusSource, [
        "gaze",
        "selection",
        "recent-focus",
        "page",
        "none",
      ], "input.frozenContext.focusSource"),
    },
    ...(input.speechEvidence === undefined
      ? {}
      : { speechEvidence: readSpeechEvidence(input.speechEvidence) }),
  };

  if (kind === "text_span" && targetQuery.kind === "text_span") {
    return {
      ...base,
      kind,
      targetQuery,
      pairCandidates: readSpanPairCandidates(input.pairCandidates),
    };
  }
  if (kind === "semantic_unit" && targetQuery.kind === "semantic_unit") {
    return {
      ...base,
      kind,
      targetQuery,
      candidates: readCandidates(
        input.candidates,
        "C",
        TARGET_RECOVERY_LIMITS.semanticCandidates,
      ),
    };
  }
  if (kind === "object" && targetQuery.kind === "object") {
    return {
      ...base,
      kind,
      targetQuery,
      candidates: readCandidates(
        input.candidates,
        "O",
        TARGET_RECOVERY_LIMITS.objectCandidates,
      ),
    };
  }
  return fail("input.kind", "target query does not match recovery kind");
}

export function parseGroundedTargetRecoveryResult(
  value: unknown,
  input: GroundedTargetRecoveryInput,
): GroundedTargetRecoveryResult {
  const result = readRecord(value, "result");
  const status = readString(result.status, "result.status");
  if (status === "NONE") {
    assertOnlyKeys(result, ["status"], "result");
    return { status };
  }
  if (status !== "SELECTED") {
    return fail("result.status", `unsupported recovery status: ${status}`);
  }
  if (input.kind === "text_span") {
    assertOnlyKeys(result, ["status", "pairLabel"], "result");
    const pairLabel = readString(result.pairLabel, "result.pairLabel");
    assertSuppliedLabel(pairLabel, input.pairCandidates, "result.pairLabel");
    return { status, pairLabel };
  }
  assertOnlyKeys(result, ["status", "candidateLabel"], "result");
  const candidateLabel = readString(
    result.candidateLabel,
    "result.candidateLabel",
  );
  assertSuppliedLabel(candidateLabel, input.candidates, "result.candidateLabel");
  return { status, candidateLabel };
}

function readCandidates(
  value: unknown,
  prefix: "C" | "O",
  max: number,
): readonly GroundedTargetRecoveryCandidate[] {
  const candidates = readArray(value, "input.candidates");
  if (candidates.length < 1 || candidates.length > max) {
    return fail("input.candidates", `expected between 1 and ${max} candidates`);
  }
  return candidates.map((value, index) => {
    const path = `input.candidates[${index}]`;
    const candidate = readRecord(value, path);
    assertOnlyKeys(candidate, [
      "label",
      "source",
      "type",
      "text",
      "semanticUnit",
      "context",
    ], path);
    const expectedLabel = `${prefix}${index + 1}`;
    if (candidate.label !== expectedLabel) {
      return fail(`${path}.label`, `expected sequential label ${expectedLabel}`);
    }
    const semanticUnit = candidate.semanticUnit === undefined
      ? undefined
      : readEnum(candidate.semanticUnit, DIRECT_SEMANTIC_UNITS, `${path}.semanticUnit`);
    return {
      label: expectedLabel,
      source: readEnum(candidate.source, ["pdf", "ggulnote"], `${path}.source`),
      type: readCandidateType(candidate.type, `${path}.type`),
      ...(candidate.text === undefined
        ? {}
        : { text: readString(candidate.text, `${path}.text`) }),
      ...(semanticUnit === undefined ? {} : { semanticUnit }),
      ...(candidate.context === undefined
        ? {}
        : { context: readString(candidate.context, `${path}.context`) }),
    };
  });
}

function readSpanPairCandidates(
  value: unknown,
): readonly GroundedTextSpanPairCandidate[] {
  const path = "input.pairCandidates";
  const candidates = readArray(value, path);
  if (
    candidates.length < 1
    || candidates.length > TARGET_RECOVERY_LIMITS.spanPairCandidates
  ) {
    return fail(
      path,
      `expected between 1 and ${TARGET_RECOVERY_LIMITS.spanPairCandidates} candidates`,
    );
  }
  return candidates.map((value, index) => {
    const candidatePath = `${path}[${index}]`;
    const candidate = readRecord(value, candidatePath);
    assertOnlyKeys(candidate, ["label", "startText", "endText", "preview", "relation"], candidatePath);
    const expectedLabel = `P${index + 1}`;
    if (candidate.label !== expectedLabel) {
      return fail(`${candidatePath}.label`, `expected sequential label ${expectedLabel}`);
    }
    const relation = readRecord(candidate.relation, `${candidatePath}.relation`);
    assertOnlyKeys(relation, ["sameSentence", "sameParagraph", "rangeLength"], `${candidatePath}.relation`);
    return {
      label: expectedLabel,
      startText: readNonEmptyString(candidate.startText, `${candidatePath}.startText`),
      endText: readNonEmptyString(candidate.endText, `${candidatePath}.endText`),
      preview: readString(candidate.preview, `${candidatePath}.preview`),
      relation: {
        sameSentence: readBoolean(relation.sameSentence, `${candidatePath}.relation.sameSentence`),
        sameParagraph: readBoolean(relation.sameParagraph, `${candidatePath}.relation.sameParagraph`),
        rangeLength: readEnum(relation.rangeLength, ["short", "medium", "long"], `${candidatePath}.relation.rangeLength`),
      },
    };
  });
}

function readSpeechEvidence(value: unknown): TargetRecoverySpeechEvidence {
  const evidence = readRecord(value, "input.speechEvidence");
  assertOnlyKeys(evidence, [
    "termHypotheses",
    "numberHypotheses",
    "mathHypothesis",
    "contextualTerms",
    "asrAlternatives",
  ], "input.speechEvidence");
  const termHypotheses = readArray(
    evidence.termHypotheses,
    "input.speechEvidence.termHypotheses",
  ).map((value, index) => {
    const path = `input.speechEvidence.termHypotheses[${index}]`;
    const term = readRecord(value, path);
    assertOnlyKeys(term, ["rawSpan", "candidates"], path);
    return {
      rawSpan: readNonEmptyString(term.rawSpan, `${path}.rawSpan`),
      candidates: readStringArray(term.candidates, `${path}.candidates`),
    };
  });
  const numberHypotheses = readArray(
    evidence.numberHypotheses,
    "input.speechEvidence.numberHypotheses",
  ).map((value, index) => {
    const path = `input.speechEvidence.numberHypotheses[${index}]`;
    const number = readRecord(value, path);
    assertOnlyKeys(number, ["raw", "kind", "normalized"], path);
    return {
      raw: readNonEmptyString(number.raw, `${path}.raw`),
      kind: readEnum(number.kind, [
        "integer",
        "decimal",
        "percent",
        "sequence",
        "power",
      ], `${path}.kind`),
      normalized: readNonEmptyString(number.normalized, `${path}.normalized`),
    };
  });
  const mathHypothesis = evidence.mathHypothesis === undefined
    ? undefined
    : readMathEvidence(evidence.mathHypothesis);
  return {
    termHypotheses,
    numberHypotheses,
    ...(mathHypothesis === undefined ? {} : { mathHypothesis }),
    contextualTerms: readStringArray(
      evidence.contextualTerms,
      "input.speechEvidence.contextualTerms",
    ),
    asrAlternatives: readStringArray(
      evidence.asrAlternatives,
      "input.speechEvidence.asrAlternatives",
    ),
  };
}

function readMathEvidence(value: unknown): NonNullable<
  TargetRecoverySpeechEvidence["mathHypothesis"]
> {
  const path = "input.speechEvidence.mathHypothesis";
  const math = readRecord(value, path);
  assertOnlyKeys(math, ["status", "normalizedText"], path);
  return {
    status: readEnum(math.status, [
      "NORMALIZED",
      "AMBIGUOUS",
      "UNSUPPORTED",
    ], `${path}.status`),
    ...(math.normalizedText === undefined
      ? {}
      : { normalizedText: readString(math.normalizedText, `${path}.normalizedText`) }),
  };
}

function assertSuppliedLabel(
  label: string,
  candidates: readonly { label: string }[],
  path: string,
): void {
  if (!candidates.some((candidate) => candidate.label === label)) {
    fail(path, `${label} is outside the bounded candidate set`);
  }
}

function readCandidateType(value: unknown, path: string) {
  const type = readString(value, path);
  if (type === "sentence" || (DIRECT_TARGET_OBJECT_TYPES as readonly string[]).includes(type)) {
    return type as GroundedTargetRecoveryCandidate["type"];
  }
  return fail(path, `unsupported candidate type: ${type}`);
}

function readRecoveryKind(value: unknown, path: string) {
  return readEnum(value, ["semantic_unit", "text_span", "object"], path);
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  const text = readString(value, path);
  if ((allowed as readonly string[]).includes(text)) return text as T[number];
  return fail(path, `unsupported value: ${text}`);
}

function readStringArray(value: unknown, path: string): readonly string[] {
  return readArray(value, path).map((item, index) =>
    readString(item, `${path}[${index}]`));
}

function readNonNegativeInteger(value: unknown, path: string): number {
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

function readArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) return fail(path, "expected an array");
  return value;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string") return fail(path, "expected a string");
  return value;
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path, "expected a boolean");
  return value;
}

function readNonEmptyString(value: unknown, path: string): string {
  const text = readString(value, path);
  if (text.trim().length === 0) return fail(path, "expected a non-empty string");
  return text;
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
  throw new GroundedTargetRecoveryValidationError(path, message);
}
