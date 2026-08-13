import type { SceneObjectKind } from "@ggulnote/editor-core";
import { DIRECT_TARGET_OBJECT_TYPES } from "../../domain";
import {
  NOTE_DECISION_MAX_BATCH_STEPS,
  NOTE_PAGE_REGIONS,
  NOTE_SELECTOR_MAX_DEPTH,
  NOTE_SPATIAL_RELATIONS,
  type CompactToolSchema,
  type Destination,
  type EntitySelector,
  type EntitySelectorContext,
  type JsonValue,
  type NoteAlignment,
  type NoteDecision,
  type NoteDecisionInput,
  type NotePageRegion,
  type NoteSpatialRelation,
  type NoteToolCall,
  type NoteToolId,
  type SpatialConstraint,
  type SpatialReference,
} from "./note-agent-types";

type UnknownRecord = Record<string, unknown>;

const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  "objectid", "sceneobjectid", "candidateid", "rangeid", "partid",
  "annotationid", "tokenid", "x", "y", "left", "top", "right",
  "bottom", "width", "height", "bounds", "rect", "rects", "offset",
  "textoffset", "coordinate", "coordinates", "point",
]);
const MAX_TOOL_INPUT_JSON_DEPTH = 20;

export class NoteAgentValidationError extends Error {
  public constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "NoteAgentValidationError";
  }
}

export function parseEntitySelector(value: unknown, path = "selector"): EntitySelector {
  assertNoAuthorityFields(value, path);
  return readEntitySelector(value, path, 0);
}

export function parseDestination(value: unknown, path = "destination"): Destination {
  assertNoAuthorityFields(value, path);
  const destination = readRecord(value, path);
  const kind = readString(destination.kind, `${path}.kind`);
  if (kind === "PAGE_REGION") {
    assertOnlyKeys(destination, ["kind", "region", "alignment", "avoidOverlap"], path);
    return {
      kind,
      region: readPageRegion(destination.region, `${path}.region`),
      ...optionalAlignment(destination.alignment, `${path}.alignment`),
      ...optionalBoolean(destination.avoidOverlap, `${path}.avoidOverlap`),
    };
  }
  if (kind === "RELATIVE") {
    assertOnlyKeys(destination, [
      "kind", "relation", "anchor", "alignment", "distance", "avoidOverlap",
    ], path);
    const anchor = readRecord(destination.anchor, `${path}.anchor`);
    const anchorValue = Object.keys(anchor).length === 1 && anchor.context !== undefined
      ? { context: readContext(anchor.context, `${path}.anchor.context`) }
      : readEntitySelector(anchor, `${path}.anchor`, 0);
    return {
      kind,
      relation: readSpatialRelation(destination.relation, `${path}.relation`),
      anchor: anchorValue,
      ...optionalAlignment(destination.alignment, `${path}.alignment`),
      ...(destination.distance === undefined
        ? {}
        : { distance: readUnion(destination.distance, `${path}.distance`, ["NEAR", "NORMAL"] as const) }),
      ...optionalBoolean(destination.avoidOverlap, `${path}.avoidOverlap`),
    };
  }
  return fail(`${path}.kind`, `unsupported destination kind: ${kind}`);
}

export function parseNoteDecision(value: unknown): NoteDecision {
  assertNoAuthorityFields(value, "decision");
  const decision = readRecord(value, "decision");
  const status = readString(decision.status, "decision.status");
  switch (status) {
    case "CALL":
      assertOnlyKeys(decision, ["status", "call"], "decision");
      return { status, call: readToolCall(decision.call, "decision.call") };
    case "BATCH": {
      assertOnlyKeys(decision, ["status", "atomic", "steps"], "decision");
      if (decision.atomic !== true) fail("decision.atomic", "BATCH must be atomic true");
      const steps = readArray(decision.steps, "decision.steps");
      if (steps.length < 1 || steps.length > NOTE_DECISION_MAX_BATCH_STEPS) {
        fail("decision.steps", `expected between 1 and ${NOTE_DECISION_MAX_BATCH_STEPS} steps`);
      }
      const parsed = steps.map((step, index) =>
        readToolCall(step, `decision.steps[${index}]`));
      if (new Set(parsed.map((step) => step.stepId)).size !== parsed.length) {
        fail("decision.steps", "stepId values must be unique");
      }
      return { status, atomic: true, steps: parsed };
    }
    case "NEEDS_INPUT":
      assertOnlyKeys(decision, ["status", "missing"], "decision");
      return { status, missing: readNonEmptyStringArray(decision.missing, "decision.missing") };
    case "UNSUPPORTED":
      assertOnlyKeys(decision, ["status", "reasonCode"], "decision");
      return {
        status,
        reasonCode: readNonEmptyString(decision.reasonCode, "decision.reasonCode"),
      };
    case "NO_OP":
      assertOnlyKeys(decision, ["status"], "decision");
      return { status };
    default:
      return fail("decision.status", `unsupported decision status: ${status}`);
  }
}

export function parseNoteDecisionInput(value: unknown): NoteDecisionInput {
  const input = readRecord(value, "input");
  assertOnlyKeys(input, ["turn", "frozenContext", "availableTools"], "input");
  const turn = readRecord(input.turn, "input.turn");
  assertOnlyKeys(turn, ["turnId", "language", "rawFinalTranscript"], "input.turn");
  const frozen = readRecord(input.frozenContext, "input.frozenContext");
  assertOnlyKeys(frozen, [
    "documentId", "pageId", "sceneRevision", "sceneMode", "selection", "focus",
    "lastOperation",
  ], "input.frozenContext");
  const availableTools = readArray(input.availableTools, "input.availableTools")
    .map((tool, index) => readCompactToolSchema(tool, `input.availableTools[${index}]`));
  if (new Set(availableTools.map((tool) => tool.id)).size !== availableTools.length) {
    fail("input.availableTools", "tool ids must be unique");
  }
  return {
    turn: {
      turnId: readNonEmptyString(turn.turnId, "input.turn.turnId"),
      language: readNonEmptyString(turn.language, "input.turn.language"),
      rawFinalTranscript: readString(turn.rawFinalTranscript, "input.turn.rawFinalTranscript"),
    },
    frozenContext: {
      documentId: readNonEmptyString(frozen.documentId, "input.frozenContext.documentId"),
      pageId: readNonEmptyString(frozen.pageId, "input.frozenContext.pageId"),
      sceneRevision: readRevision(frozen.sceneRevision, "input.frozenContext.sceneRevision"),
      sceneMode: readUnion(frozen.sceneMode, "input.frozenContext.sceneMode", ["pdf", "blank"] as const),
      ...(frozen.selection === undefined
        ? {}
        : { selection: readContextSummary(frozen.selection, "input.frozenContext.selection") }),
      ...(frozen.focus === undefined
        ? {}
        : { focus: readContextSummary(frozen.focus, "input.frozenContext.focus") }),
      ...(frozen.lastOperation === undefined
        ? {}
        : { lastOperation: readLastOperation(frozen.lastOperation) }),
    },
    availableTools,
  };
}

function readEntitySelector(value: unknown, path: string, depth: number): EntitySelector {
  if (depth > NOTE_SELECTOR_MAX_DEPTH) {
    return fail(path, `selector nesting exceeds depth ${NOTE_SELECTOR_MAX_DEPTH}`);
  }
  const selector = readRecord(value, path);
  assertOnlyKeys(selector, [
    "scope", "kinds", "source", "content", "attributes", "temporal",
    "ordinal", "context", "spatial",
  ], path);
  const content = selector.content === undefined
    ? undefined
    : readContent(selector.content, `${path}.content`);
  const spatial = selector.spatial === undefined
    ? undefined
    : readArray(selector.spatial, `${path}.spatial`).map((constraint, index) =>
        readSpatialConstraint(constraint, `${path}.spatial[${index}]`, depth));
  if (spatial !== undefined && spatial.length > 4) {
    fail(`${path}.spatial`, "expected at most 4 constraints");
  }
  return {
    ...(selector.scope === undefined
      ? {}
      : { scope: readUnion(selector.scope, `${path}.scope`, ["CURRENT_VIEW", "CURRENT_PAGE", "DOCUMENT"] as const) }),
    ...(selector.kinds === undefined ? {} : { kinds: readKinds(selector.kinds, `${path}.kinds`) }),
    ...(selector.source === undefined
      ? {}
      : { source: readUnion(selector.source, `${path}.source`, ["PDF_BASE", "USER_CREATED", "ANY"] as const) }),
    ...(content === undefined ? {} : { content }),
    ...(selector.attributes === undefined
      ? {}
      : { attributes: readAttributes(selector.attributes, `${path}.attributes`) }),
    ...(selector.temporal === undefined
      ? {}
      : { temporal: readUnion(selector.temporal, `${path}.temporal`, ["RECENT", "FIRST_CREATED", "LAST_CREATED"] as const) }),
    ...(selector.ordinal === undefined ? {} : { ordinal: readOrdinal(selector.ordinal, `${path}.ordinal`) }),
    ...(selector.context === undefined ? {} : { context: readContext(selector.context, `${path}.context`) }),
    ...(spatial === undefined ? {} : { spatial }),
  };
}

function readContent(value: unknown, path: string) {
  const content = readRecord(value, path);
  assertOnlyKeys(content, ["text", "math", "semantic"], path);
  if (Object.keys(content).length === 0) fail(path, "content must not be empty");
  return {
    ...(content.text === undefined ? {} : { text: readNonEmptyString(content.text, `${path}.text`) }),
    ...(content.math === undefined ? {} : { math: readNonEmptyString(content.math, `${path}.math`) }),
    ...(content.semantic === undefined ? {} : { semantic: readNonEmptyString(content.semantic, `${path}.semantic`) }),
  };
}

function readSpatialConstraint(
  value: unknown,
  path: string,
  selectorDepth: number,
): SpatialConstraint {
  const constraint = readRecord(value, path);
  assertOnlyKeys(constraint, ["relation", "reference"], path);
  return {
    relation: readSpatialRelation(constraint.relation, `${path}.relation`),
    reference: readSpatialReference(constraint.reference, `${path}.reference`, selectorDepth),
  };
}

function readSpatialReference(
  value: unknown,
  path: string,
  selectorDepth: number,
): SpatialReference {
  const reference = readRecord(value, path);
  const kind = readString(reference.kind, `${path}.kind`);
  if (kind === "ENTITY") {
    assertOnlyKeys(reference, ["kind", "selector"], path);
    return {
      kind,
      selector: readEntitySelector(reference.selector, `${path}.selector`, selectorDepth + 1),
    };
  }
  if (kind === "PAGE_REGION") {
    assertOnlyKeys(reference, ["kind", "region"], path);
    return { kind, region: readPageRegion(reference.region, `${path}.region`) };
  }
  if (kind === "FOCUS" || kind === "SELECTION") {
    assertOnlyKeys(reference, ["kind"], path);
    return { kind };
  }
  return fail(`${path}.kind`, `unsupported spatial reference: ${kind}`);
}

function readToolCall(value: unknown, path: string): NoteToolCall {
  const call = readRecord(value, path);
  assertOnlyKeys(call, ["stepId", "toolId", "input"], path);
  return {
    stepId: readNonEmptyString(call.stepId, `${path}.stepId`),
    toolId: readToolId(call.toolId, `${path}.toolId`),
    input: cloneJsonValue(call.input, `${path}.input`, 0),
  };
}

function readCompactToolSchema(value: unknown, path: string): CompactToolSchema {
  const tool = readRecord(value, path);
  assertOnlyKeys(tool, ["id", "kind", "description", "input"], path);
  const fields = readRecord(tool.input, `${path}.input`);
  return {
    id: readToolId(tool.id, `${path}.id`),
    kind: readUnion(tool.kind, `${path}.kind`, ["QUERY", "COMPUTE", "MUTATION"] as const),
    description: readNonEmptyString(tool.description, `${path}.description`),
    input: Object.fromEntries(Object.entries(fields).map(([key, entry]) => [
      key,
      readNonEmptyString(entry, `${path}.input.${key}`),
    ])),
  };
}

function readContextSummary(value: unknown, path: string) {
  const summary = readRecord(value, path);
  assertOnlyKeys(summary, ["kind", "textPreview", "semanticPreview"], path);
  return {
    ...(summary.kind === undefined ? {} : { kind: readNonEmptyString(summary.kind, `${path}.kind`) }),
    ...(summary.textPreview === undefined ? {} : { textPreview: readString(summary.textPreview, `${path}.textPreview`) }),
    ...(summary.semanticPreview === undefined ? {} : { semanticPreview: readString(summary.semanticPreview, `${path}.semanticPreview`) }),
  };
}

function readLastOperation(value: unknown) {
  const path = "input.frozenContext.lastOperation";
  const operation = readRecord(value, path);
  assertOnlyKeys(operation, ["toolId", "outputKind", "summary"], path);
  return {
    toolId: readToolId(operation.toolId, `${path}.toolId`),
    ...(operation.outputKind === undefined ? {} : { outputKind: readNonEmptyString(operation.outputKind, `${path}.outputKind`) }),
    ...(operation.summary === undefined ? {} : { summary: readString(operation.summary, `${path}.summary`) }),
  };
}

function readKinds(value: unknown, path: string): readonly SceneObjectKind[] {
  const kinds = readNonEmptyStringArray(value, path);
  return kinds.map((kind, index) => {
    if ((DIRECT_TARGET_OBJECT_TYPES as readonly string[]).includes(kind)) {
      return kind as SceneObjectKind;
    }
    return fail(`${path}[${index}]`, `unsupported object kind: ${kind}`);
  });
}

function readAttributes(value: unknown, path: string): Readonly<Record<string, JsonValue>> {
  const attributes = readRecord(value, path);
  return Object.freeze(Object.fromEntries(Object.entries(attributes).map(([key, entry]) => [
    key,
    cloneJsonValue(entry, `${path}.${key}`, 0),
  ])));
}

function cloneJsonValue(value: unknown, path: string, depth: number): JsonValue {
  // A valid depth-2 EntitySelector contains structural records and arrays well
  // beyond six JSON levels. Selector recursion is guarded separately above.
  if (depth > MAX_TOOL_INPUT_JSON_DEPTH) {
    return fail(path, "JSON value nesting is too deep");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fail(path, "expected a finite number");
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneJsonValue(entry, `${path}[${index}]`, depth + 1));
  }
  const record = readRecord(value, path);
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [
    key,
    cloneJsonValue(entry, `${path}.${key}`, depth + 1),
  ]));
}

function assertNoAuthorityFields(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoAuthorityFields(entry, `${path}[${index}]`));
    return;
  }
  const record = readRecord(value, path);
  for (const [key, entry] of Object.entries(record)) {
    if (FORBIDDEN_AUTHORITY_FIELDS.has(key.replace(/[_-]/gu, "").toLocaleLowerCase())) {
      fail(`${path}.${key}`, "runtime authority field is forbidden");
    }
    assertNoAuthorityFields(entry, `${path}.${key}`);
  }
}

function readPageRegion(value: unknown, path: string): NotePageRegion {
  return readUnion(value, path, NOTE_PAGE_REGIONS);
}

function readSpatialRelation(value: unknown, path: string): NoteSpatialRelation {
  return readUnion(value, path, NOTE_SPATIAL_RELATIONS);
}

function optionalAlignment(value: unknown, path: string): { alignment?: NoteAlignment } {
  return value === undefined
    ? {}
    : { alignment: readUnion(value, path, ["START", "CENTER", "END", "AUTO"] as const) };
}

function optionalBoolean(value: unknown, path: string): { avoidOverlap?: boolean } {
  return value === undefined ? {} : { avoidOverlap: readBoolean(value, path) };
}

function readContext(value: unknown, path: string): EntitySelectorContext {
  return readUnion(value, path, ["FOCUS", "SELECTION"] as const);
}

function readOrdinal(value: unknown, path: string): number | "FIRST" | "LAST" {
  if (value === "FIRST" || value === "LAST") return value;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  return fail(path, "expected a positive integer, FIRST, or LAST");
}

function readToolId(value: unknown, path: string): NoteToolId {
  const id = readNonEmptyString(value, path);
  if (!/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/u.test(id)) {
    return fail(path, "expected a namespaced tool id");
  }
  return id as NoteToolId;
}

function readRevision(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return fail(path, "expected a non-negative integer");
  }
  return value;
}

function readNonEmptyStringArray(value: unknown, path: string): readonly string[] {
  const values = readArray(value, path);
  if (values.length === 0) return fail(path, "expected a non-empty array");
  return values.map((entry, index) => readNonEmptyString(entry, `${path}[${index}]`));
}

function readRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "expected an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(path, "expected a plain object");
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

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path, "expected a boolean");
  return value;
}

function readUnion<const TValues extends readonly string[]>(
  value: unknown,
  path: string,
  values: TValues,
): TValues[number] {
  const candidate = readString(value, path);
  return (values as readonly string[]).includes(candidate)
    ? candidate as TValues[number]
    : fail(path, `unsupported value: ${candidate}`);
}

function assertOnlyKeys(value: UnknownRecord, allowedKeys: readonly string[], path: string): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) fail(`${path}.${unknown}`, "unexpected field");
}

function fail(path: string, message: string): never {
  throw new NoteAgentValidationError(path, message);
}
