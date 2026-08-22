import type { Rect } from "@ggulnote/shared-types";
import type { AnyMathAction, MathActionId } from "./math-action";
import { createMathAction } from "./math-action";
import type { MathGraph, MathObject } from "../domain/math-object";
import {
  compileMathGraphExpression,
  resolveMathGraphTangentRequest,
} from "../graph/math-graph-handler";

export const CONNECTED_MATH_ACTION_IDS = [
  "math.expression.create",
  "math.graph.create",
  "math.shape.create_rectangle",
  "math.shape.create_circle",
  "math.arithmetic.setup_vertical_multiply",
  "math.graph.add_point",
  "math.graph.add_tangent",
] as const satisfies readonly MathActionId[];

export type ConnectedMathActionId = (typeof CONNECTED_MATH_ACTION_IDS)[number];

type JsonPrimitive = string | number | boolean | null;
export type MathActionJsonValue = JsonPrimitive | readonly MathActionJsonValue[] | {
  readonly [key: string]: MathActionJsonValue;
};

export interface ConnectedMathActionContext {
  readonly objectId: string;
  readonly bounds?: Rect;
  readonly currentObject?: MathObject;
}

/**
 * Decision-facing schemas for the editor-connected math actions. Keeping them next
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
      }, ["expression"]);
    case "math.shape.create_rectangle":
    case "math.shape.create_circle":
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
        point: strictObject({
          x: { type: "number" },
          y: { type: "number" },
        }, ["x", "y"]),
        label: nullable({ type: "string" }),
      }, ["point", "label"]);
    case "math.graph.add_tangent":
      return strictObject({
        at: strictObject({ x: { type: "number" } }, ["x"]),
        label: nullable({ type: "string" }),
      }, ["at", "label"]);
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
        ["expression"],
      );
      const compiled = compileMathGraphExpression(
        nonEmptyString(args.expression, "math.graph.create args.expression"),
      );
      return createMathAction(actionId, {
        objectId: context.objectId,
        bounds: requireBounds(context, actionId),
        style: { handDrawn: true },
        functions: [{
          id: `${context.objectId}:function:1`,
          expression: compiled.expression,
          functionType: compiled.functionType,
          parameters: compiled.parameters,
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
    case "math.shape.create_circle": {
      strictRecord(decisionArgs, "math.shape.create_circle args", []);
      const bounds = requireBounds(context, actionId);
      const inset = Math.max(4, Math.min(16, bounds.width / 10, bounds.height / 10));
      return createMathAction(actionId, {
        objectId: context.objectId,
        bounds,
        shapeType: "circle",
        geometry: {
          kind: "circle",
          center: { x: bounds.width / 2, y: bounds.height / 2 },
          radius: Math.max(1, Math.min(bounds.width, bounds.height) / 2 - inset),
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
        ["point", "label"],
      );
      const point = strictRecord(args.point, "math.graph.add_point args.point", ["x", "y"]);
      return createMathAction(actionId, {
        objectId: context.objectId,
        x: finiteNumber(point.x, "math.graph.add_point args.point.x"),
        y: finiteNumber(point.y, "math.graph.add_point args.point.y"),
        ...(args.label === null
          ? {}
          : { label: nonEmptyString(args.label, "math.graph.add_point args.label") }),
      });
    }
    case "math.graph.add_tangent": {
      const args = strictRecord(
        decisionArgs,
        "math.graph.add_tangent args",
        ["at", "label"],
      );
      const graph = requireCurrentGraph(context, actionId);
      const at = strictRecord(args.at, "math.graph.add_tangent args.at", ["x"]);
      const resolved = resolveMathGraphTangentRequest(
        graph,
        { mode: "at-x", x: finiteNumber(at.x, "math.graph.add_tangent args.at.x") },
      );
      return createMathAction(actionId, {
        objectId: context.objectId,
        functionId: resolved.functionId,
        atX: resolved.atX,
        ...(args.label === null
          ? {}
          : { label: nonEmptyString(args.label, "math.graph.add_tangent args.label") }),
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
        ["expression"],
      );
      return Object.freeze({
        expression: nonEmptyString(args.expression, `${actionId} args.expression`),
      });
    }
    case "math.shape.create_rectangle":
    case "math.shape.create_circle":
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
      const args = strictRecord(decisionArgs, `${actionId} args`, ["point", "label"]);
      const point = strictRecord(args.point, `${actionId} args.point`, ["x", "y"]);
      return Object.freeze({
        point: Object.freeze({
          x: finiteNumber(point.x, `${actionId} args.point.x`),
          y: finiteNumber(point.y, `${actionId} args.point.y`),
        }),
        ...(args.label === null
          ? { label: null }
          : { label: nonEmptyString(args.label, `${actionId} args.label`) }),
      });
    }
    case "math.graph.add_tangent": {
      const args = strictRecord(
        decisionArgs,
        `${actionId} args`,
        ["at", "label"],
      );
      const at = strictRecord(args.at, `${actionId} args.at`, ["x"]);
      return Object.freeze({
        at: Object.freeze({ x: finiteNumber(at.x, `${actionId} args.at.x`) }),
        ...(args.label === null
          ? { label: null }
          : { label: nonEmptyString(args.label, `${actionId} args.label`) }),
      });
    }
  }
};

function requireCurrentGraph(
  context: ConnectedMathActionContext,
  actionId: ConnectedMathActionId,
): MathGraph {
  const object = context.currentObject;
  if (object?.kind !== "graph" || object.id !== context.objectId) {
    throw new TypeError(`${actionId} requires the current graph object.`);
  }
  return object;
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

function strictObject(
  properties: Readonly<Record<string, MathActionJsonValue>>,
  required: readonly string[],
): Readonly<Record<string, MathActionJsonValue>> {
  return { type: "object", properties, required, additionalProperties: false };
}

function nullable(schema: Readonly<Record<string, MathActionJsonValue>>) {
  return { anyOf: [schema, { type: "null" }] };
}
