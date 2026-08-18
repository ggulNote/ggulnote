import type { Rect } from "@ggulnote/shared-types";
import type { AnyMathAction, MathActionId } from "./math-action";
import { createMathAction } from "./math-action";

export const CONNECTED_MATH_ACTION_IDS = [
  "math.expression.create",
  "math.graph.create",
  "math.shape.create_rectangle",
  "math.arithmetic.setup_vertical_multiply",
  "math.graph.add_point",
] as const satisfies readonly MathActionId[];

export type ConnectedMathActionId = (typeof CONNECTED_MATH_ACTION_IDS)[number];

type JsonPrimitive = string | number | boolean | null;
export type MathActionJsonValue = JsonPrimitive | readonly MathActionJsonValue[] | {
  readonly [key: string]: MathActionJsonValue;
};

export interface ConnectedMathActionContext {
  readonly objectId: string;
  readonly bounds?: Rect;
}

/**
 * Decision-facing schemas for the five editor smoke actions. Keeping them next
 * to MathActionInputMap makes math-core the single source of truth for both the
 * model contract and the typed MathAction produced from it.
 */
export const connectedMathActionDecisionArgsSchema = (
  actionId: ConnectedMathActionId,
): Readonly<Record<string, MathActionJsonValue>> => {
  switch (actionId) {
    case "math.expression.create":
      return strictObject({ source: { type: "string", minLength: 1 } }, ["source"]);
    case "math.graph.create":
      return strictObject({
        expression: { type: "string", minLength: 1 },
        functionType: {
          type: "string",
          enum: [
            "linear", "quadratic", "cubic", "quartic", "absolute", "rational",
            "radical", "exponential", "logarithmic", "sin", "cos", "tan",
          ],
        },
        parameters: {
          type: "array",
          items: strictObject({
            name: {
              type: "string",
              enum: ["a", "b", "c", "d", "e", "h", "k", "base"],
            },
            value: { type: "number" },
          }, ["name", "value"]),
          maxItems: 8,
        },
      }, ["expression", "functionType", "parameters"]);
    case "math.shape.create_rectangle":
      return strictObject({}, []);
    case "math.arithmetic.setup_vertical_multiply":
      return strictObject({
        operands: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 2,
          maxItems: 2,
        },
      }, ["operands"]);
    case "math.graph.add_point":
      return strictObject({
        xValue: nullable({ type: "number" }),
        yValue: nullable({ type: "number" }),
        label: nullable({ type: "string" }),
      }, ["xValue", "yValue", "label"]);
  }
};

export const createConnectedMathAction = (
  actionId: ConnectedMathActionId,
  decisionArgs: unknown,
  context: ConnectedMathActionContext,
): AnyMathAction => {
  if (context.objectId.length === 0) throw new TypeError("Math object id must not be empty.");
  switch (actionId) {
    case "math.expression.create": {
      const args = strictRecord(decisionArgs, "math.expression.create args", ["source"]);
      return createMathAction(actionId, {
        objectId: context.objectId,
        bounds: requireBounds(context, actionId),
        content: {
          source: nonEmptyString(args.source, "math.expression.create args.source"),
          format: "plain",
        },
        displayMode: "block",
        alignment: "center",
        editable: true,
      });
    }
    case "math.graph.create": {
      const args = strictRecord(
        decisionArgs,
        "math.graph.create args",
        ["expression", "functionType", "parameters"],
      );
      const functionType = enumValue(args.functionType, "math.graph.create args.functionType", [
        "linear", "quadratic", "cubic", "quartic", "absolute", "rational",
        "radical", "exponential", "logarithmic", "sin", "cos", "tan",
      ] as const);
      return createMathAction(actionId, {
        objectId: context.objectId,
        bounds: requireBounds(context, actionId),
        style: { handDrawn: true },
        functions: [{
          id: `${context.objectId}:function:1`,
          expression: nonEmptyString(args.expression, "math.graph.create args.expression"),
          functionType,
          parameters: graphParameters(args.parameters),
        }],
        showAxes: true,
        showGrid: false,
      });
    }
    case "math.shape.create_rectangle": {
      strictRecord(decisionArgs, "math.shape.create_rectangle args", []);
      const bounds = requireBounds(context, actionId);
      const inset = Math.max(4, Math.min(16, bounds.width / 10, bounds.height / 10));
      return createMathAction(actionId, {
        objectId: context.objectId,
        bounds,
        shapeType: "rectangle",
        preset: "rectangle",
        geometry: {
          kind: "polygon",
          vertices: [
            { x: inset, y: inset },
            { x: bounds.width - inset, y: inset },
            { x: bounds.width - inset, y: bounds.height - inset },
            { x: inset, y: bounds.height - inset },
          ],
        },
      });
    }
    case "math.arithmetic.setup_vertical_multiply": {
      const args = strictRecord(
        decisionArgs,
        "math.arithmetic.setup_vertical_multiply args",
        ["operands"],
      );
      const operands = stringArray(args.operands, "math.arithmetic.setup_vertical_multiply args.operands");
      if (operands.length !== 2) {
        throw new RangeError("Vertical multiplication requires exactly two operands.");
      }
      return createMathAction(actionId, {
        objectId: context.objectId,
        bounds: requireBounds(context, actionId),
        operands,
      });
    }
    case "math.graph.add_point": {
      const args = strictRecord(
        decisionArgs,
        "math.graph.add_point args",
        ["xValue", "yValue", "label"],
      );
      return createMathAction(actionId, {
        objectId: context.objectId,
        x: nullableFiniteNumber(args.xValue, "math.graph.add_point args.xValue") ?? 1,
        y: nullableFiniteNumber(args.yValue, "math.graph.add_point args.yValue") ?? 1,
        ...(args.label === null
          ? {}
          : { label: nonEmptyString(args.label, "math.graph.add_point args.label") }),
      });
    }
  }
};

/** Validates Decision args without requiring editor-owned ids or placement. */
export const parseConnectedMathActionDecisionArgs = (
  actionId: ConnectedMathActionId,
  decisionArgs: unknown,
): Readonly<Record<string, unknown>> => {
  switch (actionId) {
    case "math.expression.create": {
      const args = strictRecord(decisionArgs, `${actionId} args`, ["source"]);
      return Object.freeze({ source: nonEmptyString(args.source, `${actionId} args.source`) });
    }
    case "math.graph.create": {
      const args = strictRecord(
        decisionArgs,
        `${actionId} args`,
        ["expression", "functionType", "parameters"],
      );
      return Object.freeze({
        expression: nonEmptyString(args.expression, `${actionId} args.expression`),
        functionType: enumValue(args.functionType, `${actionId} args.functionType`, [
          "linear", "quadratic", "cubic", "quartic", "absolute", "rational",
          "radical", "exponential", "logarithmic", "sin", "cos", "tan",
        ] as const),
        parameters: Object.freeze(Object.entries(graphParameters(args.parameters)).map(
          ([name, value]) => Object.freeze({ name, value }),
        )),
      });
    }
    case "math.shape.create_rectangle":
      strictRecord(decisionArgs, `${actionId} args`, []);
      return Object.freeze({});
    case "math.arithmetic.setup_vertical_multiply": {
      const args = strictRecord(decisionArgs, `${actionId} args`, ["operands"]);
      const operands = stringArray(args.operands, `${actionId} args.operands`);
      if (operands.length !== 2) {
        throw new RangeError("Vertical multiplication requires exactly two operands.");
      }
      return Object.freeze({ operands: Object.freeze([...operands]) });
    }
    case "math.graph.add_point": {
      const args = strictRecord(decisionArgs, `${actionId} args`, ["xValue", "yValue", "label"]);
      return Object.freeze({
        xValue: nullableFiniteNumber(args.xValue, `${actionId} args.xValue`) ?? null,
        yValue: nullableFiniteNumber(args.yValue, `${actionId} args.yValue`) ?? null,
        ...(args.label === null
          ? { label: null }
          : { label: nonEmptyString(args.label, `${actionId} args.label`) }),
      });
    }
  }
};

function graphParameters(value: unknown): Readonly<Record<string, number>> {
  if (!Array.isArray(value) || value.length > 8) {
    throw new TypeError("math.graph.create args.parameters must be an array of at most 8 entries.");
  }
  const parameters: Record<string, number> = {};
  for (const [index, entry] of value.entries()) {
    const parameter = strictRecord(
      entry,
      `math.graph.create args.parameters[${index}]`,
      ["name", "value"],
    );
    const name = enumValue(parameter.name, `math.graph.create args.parameters[${index}].name`, [
      "a", "b", "c", "d", "e", "h", "k", "base",
    ] as const);
    if (parameters[name] !== undefined) throw new TypeError(`Duplicate graph parameter: ${name}`);
    parameters[name] = finiteNumber(parameter.value, `math.graph.create args.parameters[${index}].value`);
  }
  return parameters;
}

function requireBounds(context: ConnectedMathActionContext, actionId: ConnectedMathActionId): Rect {
  const bounds = context.bounds;
  if (bounds === undefined) throw new TypeError(`${actionId} requires bounds.`);
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0) {
    throw new RangeError(`${actionId} requires positive finite bounds.`);
  }
  return { ...bounds };
}

function strictRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  const record = value as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.includes(key));
  if (unknownKey !== undefined) throw new TypeError(`${path}.${unknownKey} is not supported.`);
  return record;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value.map((entry, index) => nonEmptyString(entry, `${path}[${index}]`));
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value;
}

function nullableFiniteNumber(value: unknown, path: string): number | undefined {
  return value === null ? undefined : finiteNumber(value, path);
}

function enumValue<const TValues extends readonly string[]>(
  value: unknown,
  path: string,
  values: TValues,
): TValues[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${path} is not supported.`);
  }
  return value as TValues[number];
}

function strictObject(
  properties: Readonly<Record<string, MathActionJsonValue>>,
  required: readonly string[],
): Readonly<Record<string, MathActionJsonValue>> {
  return { type: "object", properties, required, additionalProperties: false };
}

function nullable(schema: Readonly<Record<string, MathActionJsonValue>>) {
  return { anyOf: [schema, { type: "null" }] };
}
