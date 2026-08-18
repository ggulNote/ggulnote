import type { AnyMathAction, MathActionId } from "../actions/math-action";
import type { MathObject, MathObjectKind, MathShapeType } from "../domain/math-object";
import {
  createMathExpression,
  insertMathFraction,
  insertMathPower,
  insertMathRoot,
  updateMathExpression,
} from "../expression/math-expression-handler";
import { createMathGraph } from "../graph/math-graph-handler";
import { requireMathObject } from "./math-handler-support";
import { compileMathRenderUpsert, type MathRenderOperation } from "../rendering/math-render-adapter";
import {
  createMathShape,
  labelMathShapeVertex,
  markMathShape,
} from "../shape/math-shape-handler";
import {
  addMathTableColumn,
  addMathTableRow,
  createMathTable,
  setMathTableCell,
} from "../table/math-table-handler";

export interface PhaseBMathActionContext {
  /** Required for mutations; storage remains owned by the caller. */
  readonly currentObject?: MathObject;
  /** Used only when a create input omits objectId. */
  readonly createObjectId?: (kind: MathObjectKind) => string;
}

export interface PhaseBMathActionResult {
  readonly object: MathObject;
  readonly renderOperation: MathRenderOperation;
}

/**
 * Stateless Phase B dispatch boundary for a future Action Registry adapter.
 * It returns the next logical object and a runtime-neutral render operation;
 * it never writes to a repository or tldraw directly.
 */
export const executePhaseBMathAction = (
  action: AnyMathAction,
  context: PhaseBMathActionContext = {},
): PhaseBMathActionResult => {
  let object: MathObject;
  switch (action.id) {
    case "math.expression.create":
      object = createMathExpression(
        action.input,
        resolveCreatedId(action.input.objectId, "expression", context),
      );
      break;
    case "math.expression.update":
      object = updateMathExpression(
        requireMathObject(context.currentObject, "expression", action.input.objectId),
        action.input,
      );
      break;
    case "math.expression.insert_fraction":
      object = insertMathFraction(
        requireMathObject(context.currentObject, "expression", action.input.objectId),
        action.input,
      );
      break;
    case "math.expression.insert_power":
      object = insertMathPower(
        requireMathObject(context.currentObject, "expression", action.input.objectId),
        action.input,
      );
      break;
    case "math.expression.insert_root":
      object = insertMathRoot(
        requireMathObject(context.currentObject, "expression", action.input.objectId),
        action.input,
      );
      break;
    case "math.table.create":
      object = createMathTable(
        action.input,
        resolveCreatedId(action.input.objectId, "table", context),
      );
      break;
    case "math.table.set_cell":
      object = setMathTableCell(
        requireMathObject(context.currentObject, "table", action.input.objectId),
        action.input,
      );
      break;
    case "math.table.add_row":
      object = addMathTableRow(
        requireMathObject(context.currentObject, "table", action.input.objectId),
        action.input,
      );
      break;
    case "math.table.add_column":
      object = addMathTableColumn(
        requireMathObject(context.currentObject, "table", action.input.objectId),
        action.input,
      );
      break;
    case "math.graph.create":
      object = createMathGraph(
        action.input,
        resolveCreatedId(action.input.objectId, "graph", context),
      );
      break;
    case "math.shape.create":
    case "math.shape.create_line":
    case "math.shape.create_triangle":
    case "math.shape.create_rectangle":
    case "math.shape.create_circle":
    case "math.shape.create_polygon":
      assertShapeActionType(action.id, action.input.shapeType);
      object = createMathShape(
        action.input,
        resolveCreatedId(action.input.objectId, "shape", context),
      );
      break;
    case "math.shape.label_vertex":
      object = labelMathShapeVertex(
        requireMathObject(context.currentObject, "shape", action.input.objectId),
        action.input,
      );
      break;
    case "math.shape.mark_angle":
      object = markMathShape(
        requireMathObject(context.currentObject, "shape", action.input.objectId),
        "angle",
        action.input,
      );
      break;
    case "math.shape.mark_parallel":
      object = markMathShape(
        requireMathObject(context.currentObject, "shape", action.input.objectId),
        "parallel",
        action.input,
      );
      break;
    case "math.shape.mark_perpendicular":
      object = markMathShape(
        requireMathObject(context.currentObject, "shape", action.input.objectId),
        "perpendicular",
        action.input,
      );
      break;
    default:
      throw new Error(`Math action is outside Phase B: ${action.id}`);
  }
  return {
    object,
    renderOperation: compileMathRenderUpsert(object),
  };
};

function assertShapeActionType(actionId: MathActionId, shapeType: MathShapeType): void {
  const allowed: Partial<Record<MathActionId, readonly MathShapeType[]>> = {
    "math.shape.create_line": ["segment", "line", "ray"],
    "math.shape.create_triangle": ["triangle"],
    "math.shape.create_rectangle": ["rectangle", "square"],
    "math.shape.create_circle": ["circle"],
    "math.shape.create_polygon": ["polygon"],
  };
  const expected = allowed[actionId];
  if (expected !== undefined && !expected.includes(shapeType)) {
    throw new TypeError(`${actionId} cannot create shapeType ${shapeType}.`);
  }
}

function resolveCreatedId(
  requestedId: string | undefined,
  kind: MathObjectKind,
  context: PhaseBMathActionContext,
): string {
  const objectId = requestedId ?? context.createObjectId?.(kind);
  if (objectId === undefined || objectId.length === 0) {
    throw new TypeError(`Creating a math ${kind} requires objectId or createObjectId.`);
  }
  return objectId;
}
