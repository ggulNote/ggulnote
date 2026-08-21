import type { Point, Rect } from "@ggulnote/shared-types";
import type { MathObject, MathTable } from "../domain/math-object";
import { createMathArithmeticChildBounds } from "../arithmetic/math-arithmetic-layout";

export type MathLayoutAnchorRole = "center" | "top" | "right" | "bottom" | "left";

export interface MathLayoutAnchor {
  readonly id: string;
  readonly role: MathLayoutAnchorRole;
  readonly point: Point;
}

export interface MathLayoutResult {
  readonly objectId: string;
  readonly bounds: Rect;
  readonly anchors: readonly MathLayoutAnchor[];
  readonly childBounds: Readonly<Record<string, Rect>>;
}

export interface MathLayoutEngine {
  layout(object: MathObject): MathLayoutResult;
}

/**
 * Preserves requested logical bounds and exposes stable attachment anchors.
 * M2 adds child bounds for editable expression roots, table cells, graph
 * functions, and shape annotations behind this same runtime-neutral contract.
 */
export const createBaseMathLayout = (
  object: MathObject,
  childBounds: Readonly<Record<string, Rect>> = {},
): MathLayoutResult => {
  const { x, y, width, height } = object.bounds;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return {
    objectId: object.id,
    bounds: { ...object.bounds },
    anchors: [
      anchor(object.id, "center", centerX, centerY),
      anchor(object.id, "top", centerX, y),
      anchor(object.id, "right", x + width, centerY),
      anchor(object.id, "bottom", centerX, y + height),
      anchor(object.id, "left", x, centerY),
    ],
    childBounds,
  };
};

export const createMathLayout = (object: MathObject): MathLayoutResult =>
  createBaseMathLayout(object, createChildBounds(object));

export const BASE_MATH_LAYOUT_ENGINE: MathLayoutEngine = {
  layout: createMathLayout,
};

export const createMathTableCellBounds = (
  table: MathTable,
): Readonly<Record<string, Rect>> => {
  const cellWidth = table.bounds.width / table.columnCount;
  const cellHeight = table.bounds.height / table.rowCount;
  return Object.fromEntries(table.cells.flat().map((cell) => [cell.id, {
    x: table.bounds.x + cell.column * cellWidth,
    y: table.bounds.y + cell.row * cellHeight,
    width: cellWidth,
    height: cellHeight,
  }]));
};

function createChildBounds(object: MathObject): Readonly<Record<string, Rect>> {
  if (object.kind === "arithmetic_layout") return createMathArithmeticChildBounds(object);
  if (object.kind === "table") return createMathTableCellBounds(object);
  if (object.kind === "expression" && object.content.root !== undefined) {
    return {
      [`${object.id}:root`]: insetRect(object.bounds, 8),
    };
  }
  if (object.kind === "graph") {
    return Object.fromEntries(object.functions.map((fn) => [fn.id, insetRect(object.bounds, 20)]));
  }
  if (object.kind === "shape") {
    return Object.fromEntries(object.children.map((child) => [child.id, { ...object.bounds }]));
  }
  return {};
}

function insetRect(rect: Rect, amount: number): Rect {
  const insetX = Math.min(amount, rect.width / 2);
  const insetY = Math.min(amount, rect.height / 2);
  return {
    x: rect.x + insetX,
    y: rect.y + insetY,
    width: Math.max(0, rect.width - insetX * 2),
    height: Math.max(0, rect.height - insetY * 2),
  };
}

function anchor(
  objectId: string,
  role: MathLayoutAnchorRole,
  x: number,
  y: number,
): MathLayoutAnchor {
  return {
    id: `${objectId}:anchor:${role}`,
    role,
    point: { x, y },
  };
}
