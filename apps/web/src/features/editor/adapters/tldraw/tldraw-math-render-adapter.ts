import {
  MATH_TLDRAW_SHAPE_TYPE,
  deserializeMathObject,
  type MathRenderAdapter,
  type MathRenderOperation,
} from "@ggulnote/math-core";
import {
  createShapeId,
  type Editor,
  type TLShapeId,
} from "tldraw";
import type { MathObjectShape } from "./math-object-shape";
import {
  finishMathGraphCreateAnimation,
  startMathGraphCreateAnimation,
} from "./math-graph-animation";

export interface TldrawMathRenderResult {
  readonly logicalObjectId: string;
  readonly shapeId: TLShapeId;
  readonly change: "created" | "updated" | "deleted" | "unchanged";
}

/** tldraw-only consumer of the runtime-neutral math render operation. */
export class TldrawMathRenderAdapter implements MathRenderAdapter<TldrawMathRenderResult> {
  public constructor(private readonly editor: Editor) {}

  public apply(operation: MathRenderOperation): TldrawMathRenderResult {
    if (operation.kind === "DELETE_MATH_OBJECT") {
      return this.delete(operation.logicalObjectId);
    }
    const { plan } = operation;
    const object = deserializeMathObject(plan.snapshot);
    if (object.id !== plan.logicalObjectId || object.kind !== plan.objectKind) {
      throw new TypeError("Math render plan does not match its serialized object.");
    }
    const shapeId = mathObjectShapeId(plan.logicalObjectId);
    const existing = this.editor.getShape(shapeId);
    const props: MathObjectShape["props"] = {
      w: Math.max(1, plan.bounds.width),
      h: Math.max(1, plan.bounds.height),
      logicalObjectId: plan.logicalObjectId,
      objectKind: plan.objectKind,
      serializedObject: JSON.stringify(plan.snapshot),
    };
    if (existing === undefined) {
      if (object.kind === "graph") startMathGraphCreateAnimation(object.id);
      this.editor.createShape<MathObjectShape>({
        id: shapeId,
        type: MATH_TLDRAW_SHAPE_TYPE,
        x: plan.bounds.x,
        y: plan.bounds.y,
        props,
      });
      return {
        logicalObjectId: plan.logicalObjectId,
        shapeId,
        change: "created",
      };
    }
    if (existing.type !== MATH_TLDRAW_SHAPE_TYPE) {
      throw new TypeError(`Shape id collision for math object: ${plan.logicalObjectId}`);
    }
    if (object.kind === "graph") finishMathGraphCreateAnimation(object.id);
    this.editor.updateShape<MathObjectShape>({
      id: shapeId,
      type: MATH_TLDRAW_SHAPE_TYPE,
      x: plan.bounds.x,
      y: plan.bounds.y,
      props,
    });
    return {
      logicalObjectId: plan.logicalObjectId,
      shapeId,
      change: "updated",
    };
  }

  private delete(logicalObjectId: string): TldrawMathRenderResult {
    finishMathGraphCreateAnimation(logicalObjectId);
    const shapeId = mathObjectShapeId(logicalObjectId);
    const existing = this.editor.getShape(shapeId);
    if (existing === undefined) {
      return { logicalObjectId, shapeId, change: "unchanged" };
    }
    if (existing.type !== MATH_TLDRAW_SHAPE_TYPE) {
      throw new TypeError(`Shape id collision for math object: ${logicalObjectId}`);
    }
    this.editor.deleteShapes([shapeId]);
    return { logicalObjectId, shapeId, change: "deleted" };
  }
}

export const mathObjectShapeId = (logicalObjectId: string): TLShapeId => {
  if (logicalObjectId.length === 0) throw new TypeError("logicalObjectId must not be empty.");
  return createShapeId(`ggulnote-math:${logicalObjectId}`);
};
