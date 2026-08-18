import type { AnyMathAction, MathActionId } from "../actions/math-action";
import {
  mathActionDefinitionById,
  type MathActionDefinition,
} from "../actions/math-action-definitions";
import type { MathObject, MathObjectKind } from "../domain/math-object";
import {
  executePhaseDMathAction,
  type PhaseDMathActionResult,
} from "../handlers/phase-d-math-action-handler";

export interface MathActionIntegrationPort {
  /** Runtime-owned lookup. math-core never stores the returned object. */
  readonly getObject: (objectId: string) => MathObject | undefined;
  /** Runtime-owned id allocation, used only when a create action omits objectId. */
  readonly createObjectId?: (kind: MathObjectKind) => string;
}

export interface PreparedMathActionExecution extends PhaseDMathActionResult {
  readonly actionId: MathActionId;
  readonly definition: MathActionDefinition;
}

/**
 * Thin Action Registry hook. It resolves one target and invokes the latest dispatcher,
 * but deliberately performs no persistence and applies no render operation.
 */
export const prepareMathActionExecution = (
  action: AnyMathAction,
  port: MathActionIntegrationPort,
): PreparedMathActionExecution => {
  const definition = mathActionDefinitionById(action.id);
  const requestedObjectId = "objectId" in action.input ? action.input.objectId : undefined;
  let currentObject: MathObject | undefined;
  if (definition.target === "existing") {
    if (requestedObjectId === undefined || requestedObjectId.length === 0) {
      throw new TypeError(`Math action requires an objectId: ${action.id}`);
    }
    currentObject = port.getObject(requestedObjectId);
    if (currentObject === undefined) {
      throw new Error(`Math action target does not exist: ${requestedObjectId}`);
    }
  }
  const result = executePhaseDMathAction(action, {
    ...(currentObject === undefined ? {} : { currentObject }),
    ...(port.createObjectId === undefined ? {} : { createObjectId: port.createObjectId }),
  });
  return {
    actionId: action.id,
    definition,
    ...result,
  };
};
