import type { AnyMathAction } from "../actions/math-action";
import { mathActionDefinitionById } from "../actions/math-action-definitions";
import {
  addArithmeticRow,
  advanceArithmeticCursor,
  drawArithmeticSeparator,
  setupVerticalArithmetic,
  writeArithmeticCarry,
  writeArithmeticDigit,
  writeArithmeticPartialRow,
} from "../arithmetic/math-arithmetic-handler";
import type { ArithmeticLayout, MathObject } from "../domain/math-object";
import { compileMathRenderUpsert, type MathRenderOperation } from "../rendering/math-render-adapter";
import { requireMathObject } from "./math-handler-support";
import {
  executePhaseCMathAction,
  type PhaseCMathActionContext,
} from "./phase-c-math-action-handler";

export type PhaseDMathActionContext = PhaseCMathActionContext;

export interface PhaseDMathActionResult {
  readonly object: MathObject;
  readonly renderOperation: MathRenderOperation;
}

/** M4 boundary: delegates earlier milestones and records handwritten arithmetic actions. */
export const executePhaseDMathAction = (
  action: AnyMathAction,
  context: PhaseDMathActionContext = {},
): PhaseDMathActionResult => {
  let layout: ArithmeticLayout;
  switch (action.id) {
    case "math.arithmetic.setup_vertical_add":
      layout = setupVerticalArithmetic(
        "add",
        action.input,
        resolveCreatedId(action.input.objectId, context),
      );
      break;
    case "math.arithmetic.setup_vertical_subtract":
      layout = setupVerticalArithmetic(
        "subtract",
        action.input,
        resolveCreatedId(action.input.objectId, context),
      );
      break;
    case "math.arithmetic.setup_vertical_multiply":
      layout = setupVerticalArithmetic(
        "multiply",
        action.input,
        resolveCreatedId(action.input.objectId, context),
      );
      break;
    case "math.arithmetic.write_digit":
      layout = writeArithmeticDigit(
        requireArithmetic(context, action.input.objectId),
        action.input,
      );
      break;
    case "math.arithmetic.write_carry":
      layout = writeArithmeticCarry(
        requireArithmetic(context, action.input.objectId),
        action.input,
      );
      break;
    case "math.arithmetic.write_partial_row":
      layout = writeArithmeticPartialRow(
        requireArithmetic(context, action.input.objectId),
        action.input,
      );
      break;
    case "math.arithmetic.draw_separator":
      layout = drawArithmeticSeparator(
        requireArithmetic(context, action.input.objectId),
        action.input,
      );
      break;
    case "math.arithmetic.advance_cursor":
      layout = advanceArithmeticCursor(
        requireArithmetic(context, action.input.objectId),
        action.input,
      );
      break;
    case "math.arithmetic.add_row":
      layout = addArithmeticRow(
        requireArithmetic(context, action.input.objectId),
        action.input,
      );
      break;
    default:
      if (mathActionDefinitionById(action.id).milestone !== "D") {
        return executePhaseCMathAction(action, context);
      }
      throw new Error(`Math action is outside Phase D: ${action.id}`);
  }
  return {
    object: layout,
    renderOperation: compileMathRenderUpsert(layout),
  };
};

function requireArithmetic(
  context: PhaseDMathActionContext,
  objectId: string,
): ArithmeticLayout {
  return requireMathObject(context.currentObject, "arithmetic_layout", objectId);
}

function resolveCreatedId(
  requestedId: string | undefined,
  context: PhaseDMathActionContext,
): string {
  const objectId = requestedId ?? context.createObjectId?.("arithmetic_layout");
  if (objectId === undefined || objectId.length === 0) {
    throw new TypeError("Creating an arithmetic layout requires objectId or createObjectId.");
  }
  return objectId;
}
