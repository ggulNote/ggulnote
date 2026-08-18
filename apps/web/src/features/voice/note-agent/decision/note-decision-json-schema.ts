import {
  NOTE_OBJECT_PART_KINDS,
  NOTE_PAGE_REGIONS,
  type CompactToolSchema,
  type JsonValue,
} from "../domain";

type JsonSchema = Readonly<Record<string, JsonValue>>;

export const NOTE_DECISION_SCHEMA_VERSION = "phase5-one-decision-v1";

export function buildNoteDecisionJsonSchema(
  tools: readonly CompactToolSchema[],
): JsonSchema {
  const stepVariants = tools.map((tool): JsonSchema => strictObject({
    action: { type: "string", const: tool.id },
    target: nullable(objectRefSchema()),
    args: tool.strictArgs ?? strictObject({}, []),
    destination: actionMutatesExistingObject(tool.id)
      ? { type: "null" }
      : nullable(destinationSchema()),
  }, ["action", "target", "args", "destination"]));
  if (stepVariants.length === 0) {
    throw new Error("One Note Decision requires at least one enabled action.");
  }
  // Responses strict schemas require an object root and every property to be
  // required. Status-specific fields are therefore nullable and the runtime
  // parser enforces which combination is valid.
  return Object.freeze(strictObject({
    status: {
      type: "string",
      enum: ["READY", "NEEDS_VISUAL", "NEEDS_CLARIFICATION", "NOT_ALLOWED"],
    },
    sceneRevision: { type: "integer", minimum: 0 },
    steps: nullable({
      type: "array",
      items: { anyOf: stepVariants },
      minItems: 1,
      maxItems: 4,
    }),
    candidateHandles: nullable({
      type: "array",
      items: { type: "string", pattern: "^O[1-9][0-9]*$" },
      minItems: 2,
      maxItems: 6,
    }),
    cropRegion: nullable(strictObject({
      mode: { type: "string", const: "CANDIDATE_UNION" },
      padding: { type: "number", minimum: 0 },
    }, ["mode", "padding"])),
    reason: nullable({ type: "string", minLength: 1 }),
  }, [
    "status",
    "sceneRevision",
    "steps",
    "candidateHandles",
    "cropRegion",
    "reason",
  ]));
}

function objectRefSchema(): JsonSchema {
  return strictObject({
    object: { type: "string", pattern: "^O[1-9][0-9]*$" },
    part: {
      description: "For a partial text annotation use kind text_range and canonical non-empty startText/endText from this object's catalog text; use null for the whole object.",
      ...nullable(strictObject({
        kind: { type: "string", enum: [...NOTE_OBJECT_PART_KINDS] },
        index: nullable({ type: "integer", minimum: 1 }),
        row: nullable({ type: "integer", minimum: 1 }),
        column: nullable({ type: "integer", minimum: 1 }),
        text: nullable({ type: "string" }),
        startText: nullable({ type: "string", minLength: 1 }),
        endText: nullable({ type: "string", minLength: 1 }),
      }, ["kind", "index", "row", "column", "text", "startText", "endText"])),
    },
  }, ["object", "part"]);
}

function actionMutatesExistingObject(action: string): boolean {
  return action === "annotation.apply" || action === "text.replace";
}

function destinationSchema(): JsonSchema {
  return strictObject({
    relation: {
      type: "string",
      enum: [
        "ABOVE", "BELOW", "LEFT_OF", "RIGHT_OF", "INSIDE", "BETWEEN", "CANVAS_REGION",
      ],
    },
    anchor: nullable(objectRefSchema()),
    region: nullable({ type: "string", enum: [...NOTE_PAGE_REGIONS] }),
  }, ["relation", "anchor", "region"]);
}

function nullable(schema: JsonSchema): JsonSchema {
  return { anyOf: [schema, { type: "null" }] };
}

function strictObject(
  properties: Readonly<Record<string, JsonValue>>,
  required: readonly string[],
): JsonSchema {
  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false,
  };
}
