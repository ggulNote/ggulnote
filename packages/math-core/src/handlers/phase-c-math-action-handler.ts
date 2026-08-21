import type { AnyMathAction } from "../actions/math-action";
import { mathActionDefinitionById } from "../actions/math-action-definitions";
import type { MathGraph, MathObject } from "../domain/math-object";
import {
  addMathGraphHelperLine,
  addMathGraphPoint,
  addMathGraphTangent,
  labelMathGraphPoint,
} from "../graph/math-graph-handler";
import { compileMathRenderUpsert, type MathRenderOperation } from "../rendering/math-render-adapter";
import { requireMathObject } from "./math-handler-support";
import {
  executePhaseBMathAction,
  type PhaseBMathActionContext,
} from "./phase-b-math-action-handler";

export type PhaseCMathActionContext = PhaseBMathActionContext;

export interface PhaseCMathActionResult {
  readonly object: MathObject;
  readonly renderOperation: MathRenderOperation;
}

/** M3 boundary: delegates M2 actions and adds graph sub-entity mutations. */
export const executePhaseCMathAction = (
  action: AnyMathAction,
  context: PhaseCMathActionContext = {},
): PhaseCMathActionResult => {
  let graph: MathGraph;
  switch (action.id) {
    case "math.graph.add_point":
      graph = addMathGraphPoint(
        requireMathObject(context.currentObject, "graph", action.input.objectId),
        action.input,
      );
      break;
    case "math.graph.add_tangent":
      graph = addMathGraphTangent(
        requireMathObject(context.currentObject, "graph", action.input.objectId),
        action.input,
      );
      break;
    case "math.graph.add_helper_line":
      graph = addMathGraphHelperLine(
        requireMathObject(context.currentObject, "graph", action.input.objectId),
        action.input,
      );
      break;
    case "math.graph.label_point":
      graph = labelMathGraphPoint(
        requireMathObject(context.currentObject, "graph", action.input.objectId),
        action.input,
      );
      break;
    default:
      if (mathActionDefinitionById(action.id).milestone === "B") {
        return executePhaseBMathAction(action, context);
      }
      throw new Error(`Math action is outside Phase C: ${action.id}`);
  }
  return {
    object: graph,
    renderOperation: compileMathRenderUpsert(graph),
  };
};
