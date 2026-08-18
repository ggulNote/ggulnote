import type { SceneObjectKind } from "@ggulnote/editor-core";
import { DIRECT_TARGET_OBJECT_TYPES } from "../../domain";
import {
  NOTE_DECISION_MAX_BATCH_STEPS,
  NOTE_OBJECT_PART_KINDS,
  NOTE_PAGE_REGIONS,
  NOTE_SELECTOR_MAX_DEPTH,
  NOTE_SPATIAL_RELATIONS,
  type CompactToolSchema,
  type Destination,
  type DecisionDestination,
  type DecisionObjectPartRef,
  type DecisionObjectRef,
  type DecisionStep,
  type EntitySelector,
  type EntitySelectorContext,
  type JsonValue,
  type NoteAlignment,
  type NoteDecision,
  type NoteDecisionInput,
  type NoteCatalogObject,
  type NoteDisambiguationChoice,
  type NoteDisambiguationInput,
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
    case "READY": {
      assertDecisionVariantKeys(decision, ["steps"]);
      const steps = readArray(decision.steps, "decision.steps");
      if (steps.length < 1 || steps.length > NOTE_DECISION_MAX_BATCH_STEPS) {
        fail("decision.steps", `expected between 1 and ${NOTE_DECISION_MAX_BATCH_STEPS} steps`);
      }
      return {
        status,
        sceneRevision: readRevision(decision.sceneRevision, "decision.sceneRevision"),
        steps: steps.map((step, index) => readDecisionStep(step, `decision.steps[${index}]`)),
      };
    }
    case "NEEDS_VISUAL": {
      assertDecisionVariantKeys(decision, ["candidateHandles", "cropRegion"]);
      const candidateHandles = readArray(
        decision.candidateHandles,
        "decision.candidateHandles",
      ).map((handle, index) => readObjectHandle(
        handle,
        `decision.candidateHandles[${index}]`,
      ));
      if (candidateHandles.length < 2 || candidateHandles.length > 6) {
        fail("decision.candidateHandles", "expected between 2 and 6 handles");
      }
      const crop = readRecord(decision.cropRegion, "decision.cropRegion");
      assertOnlyKeys(crop, ["mode", "padding"], "decision.cropRegion");
      return {
        status,
        sceneRevision: readRevision(decision.sceneRevision, "decision.sceneRevision"),
        candidateHandles,
        cropRegion: {
          mode: readUnion(crop.mode, "decision.cropRegion.mode", ["CANDIDATE_UNION"] as const),
          padding: readNonNegativeNumber(crop.padding, "decision.cropRegion.padding"),
        },
      };
    }
    case "NEEDS_CLARIFICATION":
      assertDecisionVariantKeys(decision, ["reason"]);
      return {
        status,
        sceneRevision: readRevision(decision.sceneRevision, "decision.sceneRevision"),
        reason: readUnion(decision.reason, "decision.reason", [
          "AMBIGUOUS_OBJECT",
          "MISSING_TARGET",
          "MISSING_DESTINATION",
          "VISUAL_UNRESOLVED",
          "CONTEXT_LIMIT",
        ] as const),
      };
    case "NOT_ALLOWED":
      assertDecisionVariantKeys(decision, ["reason"]);
      return {
        status,
        sceneRevision: readRevision(decision.sceneRevision, "decision.sceneRevision"),
        reason: readNonEmptyString(decision.reason, "decision.reason"),
      };
    case "CALL":
      assertOnlyKeys(decision, ["status", "call"], "decision");
      {
        const call = readToolCall(decision.call, "decision.call");
        validateStepReferences([call]);
        return { status, call };
      }
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
      validateStepReferences(parsed);
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

const STRICT_DECISION_KEYS = [
  "status",
  "sceneRevision",
  "steps",
  "candidateHandles",
  "cropRegion",
  "reason",
] as const;

function assertDecisionVariantKeys(
  decision: UnknownRecord,
  active: readonly (typeof STRICT_DECISION_KEYS)[number][],
): void {
  assertOnlyKeys(decision, STRICT_DECISION_KEYS, "decision");
  const activeKeys = new Set(["status", "sceneRevision", ...active]);
  for (const key of STRICT_DECISION_KEYS) {
    if (!activeKeys.has(key) && decision[key] !== undefined && decision[key] !== null) {
      fail(`decision.${key}`, "expected null for this status");
    }
  }
}

export function parseNoteDecisionInput(value: unknown): NoteDecisionInput {
  const input = readRecord(value, "input");
  assertOnlyKeys(input, ["turn", "frozenContext", "availableTools", "objectCatalog"], "input");
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
  const catalog = readRecord(input.objectCatalog, "input.objectCatalog");
  assertOnlyKeys(catalog, ["objects", "truncated"], "input.objectCatalog");
  const objects = readArray(catalog.objects, "input.objectCatalog.objects")
    .map((object, index) => readCatalogObject(object, `input.objectCatalog.objects[${index}]`));
  if (new Set(objects.map((object) => object.handle)).size !== objects.length) {
    fail("input.objectCatalog.objects", "handles must be unique");
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
    objectCatalog: {
      objects,
      truncated: readBoolean(catalog.truncated, "input.objectCatalog.truncated"),
    },
  };
}

function readDecisionStep(value: unknown, path: string): DecisionStep {
  const step = readRecord(value, path);
  assertOnlyKeys(step, ["action", "target", "args", "destination"], path);
  const args = readRecord(step.args, `${path}.args`);
  return {
    action: readToolId(step.action, `${path}.action`),
    target: step.target === null ? null : readDecisionObjectRef(step.target, `${path}.target`),
    args: readJsonRecord(args, `${path}.args`),
    destination: step.destination === null
      ? null
      : readDecisionDestination(step.destination, `${path}.destination`),
  };
}

function readDecisionObjectRef(value: unknown, path: string): DecisionObjectRef {
  const ref = readRecord(value, path);
  assertOnlyKeys(ref, ["object", "part"], path);
  return {
    object: readObjectHandle(ref.object, `${path}.object`),
    part: ref.part === null ? null : readDecisionPart(ref.part, `${path}.part`),
  };
}

function readDecisionPart(value: unknown, path: string): DecisionObjectPartRef {
  const part = readRecord(value, path);
  assertOnlyKeys(
    part,
    ["kind", "index", "row", "column", "text", "startText", "endText"],
    path,
  );
  return {
    kind: readUnion(part.kind, `${path}.kind`, NOTE_OBJECT_PART_KINDS),
    index: readNullablePositiveInteger(part.index, `${path}.index`),
    row: readNullablePositiveInteger(part.row, `${path}.row`),
    column: readNullablePositiveInteger(part.column, `${path}.column`),
    text: readNullableString(part.text, `${path}.text`),
    startText: readNullableString(part.startText, `${path}.startText`),
    endText: readNullableString(part.endText, `${path}.endText`),
  };
}

function readDecisionDestination(value: unknown, path: string): DecisionDestination {
  const destination = readRecord(value, path);
  assertOnlyKeys(destination, ["relation", "anchor", "region"], path);
  return {
    relation: readUnion(destination.relation, `${path}.relation`, [
      "ABOVE", "BELOW", "LEFT_OF", "RIGHT_OF", "INSIDE", "BETWEEN", "CANVAS_REGION",
    ] as const),
    anchor: destination.anchor === null
      ? null
      : readDecisionObjectRef(destination.anchor, `${path}.anchor`),
    region: destination.region === null
      ? null
      : readPageRegion(destination.region, `${path}.region`),
  };
}

function readCatalogObject(value: unknown, path: string): NoteCatalogObject {
  const object = readRecord(value, path);
  assertOnlyKeys(object, [
    "handle", "source", "kind", "text", "summary", "bounds", "capabilities",
    "selected", "focused", "recent", "parts",
  ], path);
  if (object.text !== undefined && object.summary !== undefined) {
    fail(path, "catalog object cannot contain both text and summary");
  }
  const bounds = readRecord(object.bounds, `${path}.bounds`);
  assertOnlyKeys(bounds, ["x", "y", "width", "height"], `${path}.bounds`);
  return {
    handle: readObjectHandle(object.handle, `${path}.handle`),
    source: readUnion(object.source, `${path}.source`, ["pdf", "tldraw"] as const),
    kind: readSceneObjectKind(object.kind, `${path}.kind`),
    ...(object.text === undefined
      ? {}
      : { text: readString(object.text, `${path}.text`) }),
    ...(object.summary === undefined
      ? {}
      : { summary: readString(object.summary, `${path}.summary`) }),
    bounds: {
      x: readUnitNumber(bounds.x, `${path}.bounds.x`),
      y: readUnitNumber(bounds.y, `${path}.bounds.y`),
      width: readUnitNumber(bounds.width, `${path}.bounds.width`),
      height: readUnitNumber(bounds.height, `${path}.bounds.height`),
    },
    capabilities: readArray(object.capabilities, `${path}.capabilities`)
      .map((capability, index) => readNonEmptyString(
        capability,
        `${path}.capabilities[${index}]`,
      )),
    selected: readBoolean(object.selected, `${path}.selected`),
    focused: readBoolean(object.focused, `${path}.focused`),
    recent: readBoolean(object.recent, `${path}.recent`),
    ...(object.parts === undefined ? {} : {
      parts: readArray(object.parts, `${path}.parts`).map((part, index) => {
        const partPath = `${path}.parts[${index}]`;
        const record = readRecord(part, partPath);
        assertOnlyKeys(record, ["kind", "summary"], partPath);
        return {
          kind: readNonEmptyString(record.kind, `${partPath}.kind`),
          ...(record.summary === undefined
            ? {}
            : { summary: readString(record.summary, `${partPath}.summary`) }),
        };
      }),
    }),
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
    "part",
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
    ...(selector.part === undefined
      ? {}
      : { part: readPartSelector(selector.part, `${path}.part`) }),
  };
}

function readPartSelector(value: unknown, path: string) {
  const part = readRecord(value, path);
  assertOnlyKeys(part, ["kind", "index", "row", "column", "text"], path);
  return {
    kind: readUnion(part.kind, `${path}.kind`, NOTE_OBJECT_PART_KINDS),
    ...(part.index === undefined ? {} : { index: readPositiveInteger(part.index, `${path}.index`) }),
    ...(part.row === undefined ? {} : { row: readPositiveInteger(part.row, `${path}.row`) }),
    ...(part.column === undefined ? {} : { column: readPositiveInteger(part.column, `${path}.column`) }),
    ...(part.text === undefined ? {} : { text: readNonEmptyString(part.text, `${path}.text`) }),
  };
}

export function parseNoteDisambiguationInput(value: unknown): NoteDisambiguationInput {
  const input = readRecord(value, "input");
  assertOnlyKeys(input, [
    "turnId", "language", "rawFinalTranscript", "stepId", "toolId", "candidates",
  ], "input");
  const candidates = readArray(input.candidates, "input.candidates").map((value, index) => {
    const path = `input.candidates[${index}]`;
    const candidate = readRecord(value, path);
    assertOnlyKeys(candidate, ["alias", "kind", "source", "textPreview"], path);
    return {
      alias: readCandidateAlias(candidate.alias, `${path}.alias`),
      ...(candidate.kind === undefined ? {} : { kind: readNonEmptyString(candidate.kind, `${path}.kind`) }),
      ...(candidate.source === undefined ? {} : { source: readNonEmptyString(candidate.source, `${path}.source`) }),
      ...(candidate.textPreview === undefined ? {} : { textPreview: readString(candidate.textPreview, `${path}.textPreview`) }),
    };
  });
  if (candidates.length < 2 || candidates.length > 6) {
    fail("input.candidates", "expected between 2 and 6 candidates");
  }
  if (new Set(candidates.map((candidate) => candidate.alias)).size !== candidates.length) {
    fail("input.candidates", "candidate aliases must be unique");
  }
  return {
    turnId: readNonEmptyString(input.turnId, "input.turnId"),
    language: readNonEmptyString(input.language, "input.language"),
    rawFinalTranscript: readString(input.rawFinalTranscript, "input.rawFinalTranscript"),
    stepId: readNonEmptyString(input.stepId, "input.stepId"),
    toolId: readToolId(input.toolId, "input.toolId"),
    candidates,
  };
}

export function parseNoteDisambiguationChoice(value: unknown): NoteDisambiguationChoice {
  const choice = readRecord(value, "choice");
  const status = readString(choice.status, "choice.status");
  if (status === "NONE") {
    assertOnlyKeys(choice, ["status"], "choice");
    return { status };
  }
  if (status === "SELECTED") {
    assertOnlyKeys(choice, ["status", "alias"], "choice");
    return { status, alias: readCandidateAlias(choice.alias, "choice.alias") };
  }
  return fail("choice.status", `unsupported choice status: ${status}`);
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
  assertOnlyKeys(tool, ["id", "kind", "description", "examples", "input", "strictArgs"], path);
  const fields = tool.input === undefined
    ? undefined
    : readRecord(tool.input, `${path}.input`);
  return {
    id: readToolId(tool.id, `${path}.id`),
    kind: readUnion(tool.kind, `${path}.kind`, ["QUERY", "COMPUTE", "MUTATION"] as const),
    description: readNonEmptyString(tool.description, `${path}.description`),
    ...(tool.examples === undefined
      ? {}
      : { examples: readNonEmptyStringArray(tool.examples, `${path}.examples`) }),
    ...(fields === undefined ? {} : {
      input: Object.fromEntries(Object.entries(fields).map(([key, entry]) => [
        key,
        readNonEmptyString(entry, `${path}.input.${key}`),
      ])),
    }),
    ...(tool.strictArgs === undefined
      ? {}
      : { strictArgs: readJsonRecord(readRecord(tool.strictArgs, `${path}.strictArgs`), `${path}.strictArgs`) }),
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

function readSceneObjectKind(value: unknown, path: string): SceneObjectKind {
  const kind = readNonEmptyString(value, path);
  return (DIRECT_TARGET_OBJECT_TYPES as readonly string[]).includes(kind)
    ? kind as SceneObjectKind
    : fail(path, `unsupported object kind: ${kind}`);
}

function readObjectHandle(value: unknown, path: string): `O${number}` {
  const handle = readNonEmptyString(value, path);
  return /^O[1-9][0-9]*$/u.test(handle)
    ? handle as `O${number}`
    : fail(path, `invalid request-local object handle: ${handle}`);
}

function readNullablePositiveInteger(value: unknown, path: string): number | null {
  return value === null || value === undefined ? null : readPositiveInteger(value, path);
}

function readNullableString(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : readString(value, path);
}

function readNonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fail(path, "expected a finite non-negative number");
  }
  return value;
}

function readUnitNumber(value: unknown, path: string): number {
  const number = readNonNegativeNumber(value, path);
  return number <= 1 ? number : fail(path, "expected a normalized number between 0 and 1");
}

function readJsonRecord(
  value: Record<string, unknown>,
  path: string,
): Readonly<Record<string, JsonValue>> {
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    cloneJsonValue(entry, `${path}.${key}`, 0),
  ])));
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

function validateStepReferences(calls: readonly NoteToolCall[]): void {
  const completed = new Set<string>();
  calls.forEach((call, index) => {
    visitStepReferences(call.input, `decision.steps[${index}].input`, completed);
    completed.add(call.stepId);
  });
}

function visitStepReferences(
  value: unknown,
  path: string,
  completed: ReadonlySet<string>,
): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitStepReferences(entry, `${path}[${index}]`, completed));
    return;
  }
  const record = readRecord(value, path);
  if ("fromStep" in record) {
    assertOnlyKeys(record, ["fromStep", "path"], path);
    const fromStep = readNonEmptyString(record.fromStep, `${path}.fromStep`);
    if (!completed.has(fromStep)) {
      fail(`${path}.fromStep`, "step output references must point to an earlier step");
    }
    if (record.path !== undefined) {
      const segments = readArray(record.path, `${path}.path`);
      if (segments.length > 8) fail(`${path}.path`, "expected at most 8 path segments");
      segments.forEach((segment, index) =>
        readNonEmptyString(segment, `${path}.path[${index}]`));
    }
    return;
  }
  Object.entries(record).forEach(([key, entry]) =>
    visitStepReferences(entry, `${path}.${key}`, completed));
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

function readPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fail(path, "expected a positive integer");
  }
  return value;
}

function readCandidateAlias(value: unknown, path: string): `${"C" | "S"}${number}` {
  const alias = readNonEmptyString(value, path);
  return /^[CS][1-9][0-9]*$/u.test(alias)
    ? alias as `${"C" | "S"}${number}`
    : fail(path, "expected a candidate alias");
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
