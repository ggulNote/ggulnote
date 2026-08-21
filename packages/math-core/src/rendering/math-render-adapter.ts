import type { Rect } from "@ggulnote/shared-types";
import type { MathObject, MathObjectKind } from "../domain/math-object";
import {
  BASE_MATH_LAYOUT_ENGINE,
  type MathLayoutEngine,
  type MathLayoutResult,
} from "../layout/math-layout-engine";
import {
  serializeMathObject,
  type SerializedMathObject,
} from "../serialization/math-object-serializer";

export const MATH_TLDRAW_SHAPE_TYPE = "ggulnote-math" as const;

export interface MathRenderPlan {
  readonly logicalObjectId: string;
  readonly objectKind: MathObjectKind;
  readonly shapeType: typeof MATH_TLDRAW_SHAPE_TYPE;
  readonly bounds: Rect;
  readonly childIds: readonly string[];
  readonly layout: MathLayoutResult;
  readonly snapshot: SerializedMathObject;
}

export type MathRenderOperation =
  | {
      readonly kind: "UPSERT_MATH_OBJECT";
      readonly plan: MathRenderPlan;
    }
  | {
      readonly kind: "DELETE_MATH_OBJECT";
      readonly logicalObjectId: string;
    };

/** Runtime-specific adapters (tldraw first) implement this small boundary. */
export interface MathRenderAdapter<TResult = void> {
  apply(operation: MathRenderOperation): TResult;
}

export const createMathRenderPlan = (
  object: MathObject,
  layoutEngine: MathLayoutEngine = BASE_MATH_LAYOUT_ENGINE,
): MathRenderPlan => ({
  logicalObjectId: object.id,
  objectKind: object.kind,
  shapeType: MATH_TLDRAW_SHAPE_TYPE,
  bounds: { ...object.bounds },
  childIds: object.children.map((child) => child.id),
  layout: layoutEngine.layout(object),
  snapshot: serializeMathObject(object),
});

export const compileMathRenderUpsert = (
  object: MathObject,
  layoutEngine?: MathLayoutEngine,
): MathRenderOperation => ({
  kind: "UPSERT_MATH_OBJECT",
  plan: createMathRenderPlan(object, layoutEngine),
});

export const compileMathRenderDelete = (
  logicalObjectId: string,
): MathRenderOperation => {
  if (logicalObjectId.length === 0) {
    throw new TypeError("logicalObjectId must not be empty.");
  }
  return {
    kind: "DELETE_MATH_OBJECT",
    logicalObjectId,
  };
};
