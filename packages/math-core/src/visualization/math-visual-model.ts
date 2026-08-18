import type { Point, Rect } from "@ggulnote/shared-types";
import type {
  MathGraph,
  MathObject,
  MathObjectStyle,
  MathShape,
  MathShapeMark,
  MathTable,
} from "../domain/math-object";
import { getMathExpressionDisplayText } from "../expression/math-expression-handler";
import {
  mapGraphPointToBounds,
  sampleMathGraphFunction,
} from "../graph/math-graph-handler";
import { getMathShapeVertices } from "../shape/math-shape-handler";

export type MathVisualTextAnchor = "start" | "middle" | "end";

export interface MathVisualStroke {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly dash?: string;
}

export type MathVisualPrimitive =
  | ({
      readonly kind: "line";
      readonly id: string;
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    } & MathVisualStroke)
  | ({
      readonly kind: "polyline";
      readonly id: string;
      readonly points: readonly Point[];
      readonly closed: boolean;
      readonly fill: string;
    } & MathVisualStroke)
  | ({
      readonly kind: "circle";
      readonly id: string;
      readonly cx: number;
      readonly cy: number;
      readonly radius: number;
      readonly fill: string;
    } & MathVisualStroke)
  | ({
      readonly kind: "rect";
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly fill: string;
    } & MathVisualStroke)
  | {
      readonly kind: "path";
      readonly id: string;
      readonly d: string;
      readonly fill: string;
      readonly stroke: string;
      readonly strokeWidth: number;
      readonly opacity: number;
      readonly dash?: string;
    }
  | {
      readonly kind: "text";
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly text: string;
      readonly color: string;
      readonly fontSize: number;
      readonly fontFamily: string;
      readonly fontWeight: "normal" | "bold";
      readonly anchor: MathVisualTextAnchor;
      readonly opacity: number;
    };

export interface MathVisualModel {
  readonly logicalObjectId: string;
  readonly width: number;
  readonly height: number;
  readonly backgroundColor: string;
  readonly primitives: readonly MathVisualPrimitive[];
}

/** Produces local, deterministic SVG primitives; React only maps these to elements. */
export const createMathVisualModel = (object: MathObject): MathVisualModel => {
  const width = Math.max(1, object.bounds.width);
  const height = Math.max(1, object.bounds.height);
  return {
    logicalObjectId: object.id,
    width,
    height,
    backgroundColor: object.style.backgroundColor ?? "transparent",
    primitives: createPrimitives(object, width, height),
  };
};

function createPrimitives(
  object: MathObject,
  width: number,
  height: number,
): readonly MathVisualPrimitive[] {
  switch (object.kind) {
    case "expression":
      return expressionPrimitives(object, width, height);
    case "table":
      return tablePrimitives(object, width, height);
    case "graph":
      return graphPrimitives(object, width, height);
    case "shape":
      return shapePrimitives(object, width, height);
    case "arithmetic_layout":
      return [textPrimitive(
        `${object.id}:placeholder`,
        object.label ?? object.operands.join("  "),
        8,
        height / 2,
        object.style,
        "start",
      )];
  }
}

function expressionPrimitives(
  expression: Extract<MathObject, { readonly kind: "expression" }>,
  width: number,
  height: number,
): readonly MathVisualPrimitive[] {
  const lines = getMathExpressionDisplayText(expression).split("\n");
  const fontSize = expression.style.fontSize ?? 22;
  const lineHeight = fontSize * 1.35;
  const totalHeight = lineHeight * lines.length;
  const firstY = Math.max(fontSize, (height - totalHeight) / 2 + fontSize);
  const anchor = expression.alignment === "center"
    ? "middle"
    : expression.alignment === "right" ? "end" : "start";
  const x = expression.alignment === "center" ? width / 2 : expression.alignment === "right" ? width - 8 : 8;
  return lines.map((line, index) => textPrimitive(
    `${expression.id}:line:${index}`,
    line,
    x,
    firstY + index * lineHeight,
    expression.style,
    anchor,
    fontSize,
  ));
}

function tablePrimitives(
  table: MathTable,
  width: number,
  height: number,
): readonly MathVisualPrimitive[] {
  const primitives: MathVisualPrimitive[] = [];
  const cellWidth = width / table.columnCount;
  const cellHeight = height / table.rowCount;
  const stroke = strokeStyle(table.style);
  for (const cell of table.cells.flat()) {
    if (table.headerRows.includes(cell.row) || table.headerColumns.includes(cell.column)) {
      primitives.push({
        kind: "rect",
        id: `${cell.id}:header`,
        x: cell.column * cellWidth,
        y: cell.row * cellHeight,
        width: cellWidth,
        height: cellHeight,
        fill: table.style.backgroundColor ?? "#f8fafc",
        ...stroke,
      });
    }
  }
  for (let column = 0; column <= table.columnCount; column += 1) {
    primitives.push({
      kind: "line",
      id: `${table.id}:grid:column:${column}`,
      x1: column * cellWidth,
      y1: 0,
      x2: column * cellWidth,
      y2: height,
      ...stroke,
    });
  }
  for (let row = 0; row <= table.rowCount; row += 1) {
    primitives.push({
      kind: "line",
      id: `${table.id}:grid:row:${row}`,
      x1: 0,
      y1: row * cellHeight,
      x2: width,
      y2: row * cellHeight,
      ...stroke,
    });
  }
  for (const cell of table.cells.flat()) {
    const alignment = cell.alignment ?? table.defaultCellAlignment;
    const anchor = alignment === "center" ? "middle" : alignment === "right" ? "end" : "start";
    const x = alignment === "center"
      ? (cell.column + 0.5) * cellWidth
      : alignment === "right" ? (cell.column + 1) * cellWidth - 6 : cell.column * cellWidth + 6;
    primitives.push(textPrimitive(
      `${cell.id}:text`,
      cell.value,
      x,
      (cell.row + 0.5) * cellHeight + (table.style.fontSize ?? 16) * 0.35,
      table.style,
      anchor,
      table.style.fontSize ?? 16,
      table.headerRows.includes(cell.row) || table.headerColumns.includes(cell.column) ? "bold" : "normal",
    ));
  }
  return primitives;
}

function graphPrimitives(
  graph: MathGraph,
  width: number,
  height: number,
): readonly MathVisualPrimitive[] {
  const primitives: MathVisualPrimitive[] = [];
  const plot: Rect = {
    x: Math.min(30, width * 0.15),
    y: Math.min(14, height * 0.08),
    width: Math.max(1, width - Math.min(44, width * 0.22)),
    height: Math.max(1, height - Math.min(42, height * 0.22)),
  };
  const gridStroke: MathVisualStroke = {
    stroke: "#dbe3ec",
    strokeWidth: 1,
    opacity: 0.8,
  };
  if (graph.coordinateSystem.showGrid) {
    for (const x of numericTicks(
      graph.coordinateSystem.xMin,
      graph.coordinateSystem.xMax,
      graph.coordinateSystem.xStep,
    )) {
      const point = mapGraphPointToBounds({ x, y: 0 }, graph.coordinateSystem, plot);
      primitives.push({
        kind: "line",
        id: `${graph.id}:grid:x:${x}`,
        x1: point.x,
        y1: plot.y,
        x2: point.x,
        y2: plot.y + plot.height,
        ...gridStroke,
      });
    }
    for (const y of numericTicks(
      graph.coordinateSystem.yMin,
      graph.coordinateSystem.yMax,
      graph.coordinateSystem.yStep,
    )) {
      const point = mapGraphPointToBounds({ x: 0, y }, graph.coordinateSystem, plot);
      primitives.push({
        kind: "line",
        id: `${graph.id}:grid:y:${y}`,
        x1: plot.x,
        y1: point.y,
        x2: plot.x + plot.width,
        y2: point.y,
        ...gridStroke,
      });
    }
  }
  if (graph.coordinateSystem.showAxes) {
    const axes = strokeStyle(graph.style, "#475569", 1.5);
    if (graph.coordinateSystem.yMin <= 0 && graph.coordinateSystem.yMax >= 0) {
      const origin = mapGraphPointToBounds({ x: 0, y: 0 }, graph.coordinateSystem, plot);
      primitives.push({
        kind: "line",
        id: `${graph.id}:axis:x`,
        x1: plot.x,
        y1: origin.y,
        x2: plot.x + plot.width,
        y2: origin.y,
        ...axes,
      });
    }
    if (graph.coordinateSystem.xMin <= 0 && graph.coordinateSystem.xMax >= 0) {
      const origin = mapGraphPointToBounds({ x: 0, y: 0 }, graph.coordinateSystem, plot);
      primitives.push({
        kind: "line",
        id: `${graph.id}:axis:y`,
        x1: origin.x,
        y1: plot.y,
        x2: origin.x,
        y2: plot.y + plot.height,
        ...axes,
      });
    }
  }
  graph.functions.forEach((fn, index) => {
    const points = sampleMathGraphFunction(fn, graph.coordinateSystem).map((point) =>
      mapGraphPointToBounds(point, graph.coordinateSystem, plot));
    const style = { ...graph.style, ...fn.style };
    primitives.push({
      kind: "polyline",
      id: fn.id,
      points,
      closed: false,
      fill: "none",
      ...strokeStyle(style, palette(index), 2),
    });
    primitives.push(textPrimitive(
      `${fn.id}:label`,
      fn.label ?? fn.expression,
      plot.x + 6,
      plot.y + 18 + index * 18,
      style,
      "start",
      Math.min(14, graph.style.fontSize ?? 14),
    ));
  });
  return primitives;
}

function shapePrimitives(
  shape: MathShape,
  width: number,
  height: number,
): readonly MathVisualPrimitive[] {
  const primitives: MathVisualPrimitive[] = [];
  const stroke = strokeStyle(shape.style);
  const geometry = shape.geometry;
  if (geometry.kind === "point") {
    primitives.push({
      kind: "circle",
      id: `${shape.id}:point`,
      cx: geometry.point.x,
      cy: geometry.point.y,
      radius: 3.5,
      fill: stroke.stroke,
      ...stroke,
    });
  } else if (geometry.kind === "linear") {
    const [start, end] = shape.shapeType === "line"
      ? extendLinearGeometry(geometry.start, geometry.end, width, height, false)
      : shape.shapeType === "ray"
        ? extendLinearGeometry(geometry.start, geometry.end, width, height, true)
        : [geometry.start, geometry.end];
    primitives.push({
      kind: "line",
      id: `${shape.id}:linear`,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      ...stroke,
    });
  } else if (geometry.kind === "angle") {
    primitives.push({
      kind: "line",
      id: `${shape.id}:angle:first`,
      x1: geometry.vertex.x,
      y1: geometry.vertex.y,
      x2: geometry.firstRayPoint.x,
      y2: geometry.firstRayPoint.y,
      ...stroke,
    }, {
      kind: "line",
      id: `${shape.id}:angle:second`,
      x1: geometry.vertex.x,
      y1: geometry.vertex.y,
      x2: geometry.secondRayPoint.x,
      y2: geometry.secondRayPoint.y,
      ...stroke,
    });
  } else if (geometry.kind === "polygon") {
    primitives.push({
      kind: "polyline",
      id: `${shape.id}:polygon`,
      points: geometry.vertices,
      closed: true,
      fill: shape.style.backgroundColor ?? "none",
      ...stroke,
    });
  } else if (geometry.kind === "circle") {
    primitives.push({
      kind: "circle",
      id: `${shape.id}:circle`,
      cx: geometry.center.x,
      cy: geometry.center.y,
      radius: geometry.radius,
      fill: shape.style.backgroundColor ?? "none",
      ...stroke,
    });
  } else {
    primitives.push({
      kind: "path",
      id: `${shape.id}:arc`,
      d: createArcPath(
        geometry.center,
        geometry.radius,
        geometry.startAngleDegrees,
        geometry.endAngleDegrees,
        shape.shapeType === "sector",
      ),
      fill: shape.shapeType === "sector" ? shape.style.backgroundColor ?? "none" : "none",
      ...stroke,
    });
  }
  for (const label of shape.labels) {
    const target = label.position ?? defaultShapeLabelPosition(shape, label.targetIndex);
    primitives.push(textPrimitive(
      label.id,
      label.text,
      target.x,
      target.y,
      shape.style,
      "middle",
      shape.style.fontSize ?? 15,
    ));
  }
  for (const mark of shape.marks) {
    const position = shapeMarkPosition(shape, mark);
    primitives.push(textPrimitive(
      mark.id,
      mark.value ?? markSymbol(mark.markType),
      position.x,
      position.y,
      shape.style,
      "middle",
      Math.max(13, shape.style.fontSize ?? 13),
    ));
  }
  return primitives;
}

function textPrimitive(
  id: string,
  text: string,
  x: number,
  y: number,
  style: MathObjectStyle,
  anchor: MathVisualTextAnchor,
  fontSize = style.fontSize ?? 18,
  fontWeight: "normal" | "bold" = "normal",
): MathVisualPrimitive {
  return {
    kind: "text",
    id,
    x,
    y,
    text,
    color: style.color ?? style.strokeColor ?? "#172033",
    fontSize,
    fontFamily: style.fontFamily ?? "Arial, sans-serif",
    fontWeight,
    anchor,
    opacity: style.opacity ?? 1,
  };
}

function strokeStyle(
  style: MathObjectStyle,
  fallbackColor = "#172033",
  fallbackWidth = 1.5,
): MathVisualStroke {
  return {
    stroke: style.strokeColor ?? style.color ?? fallbackColor,
    strokeWidth: style.strokeWidth ?? fallbackWidth,
    opacity: style.opacity ?? 1,
    ...(style.lineStyle === "dashed"
      ? { dash: "7 5" }
      : style.lineStyle === "dotted" ? { dash: "2 4" } : {}),
  };
}

function numericTicks(min: number, max: number, step: number): readonly number[] {
  const ticks: number[] = [];
  const first = Math.ceil(min / step) * step;
  for (let value = first; value <= max + step * 1e-9 && ticks.length < 200; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
}

function palette(index: number): string {
  return ["#2563eb", "#dc2626", "#059669", "#7c3aed"][index % 4]!;
}

function extendLinearGeometry(
  start: Point,
  end: Point,
  width: number,
  height: number,
  ray: boolean,
): readonly [Point, Point] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const candidates: { readonly t: number; readonly point: Point }[] = [];
  if (dx !== 0) {
    for (const x of [0, width]) {
      const t = (x - start.x) / dx;
      const y = start.y + t * dy;
      if (y >= 0 && y <= height) candidates.push({ t, point: { x, y } });
    }
  }
  if (dy !== 0) {
    for (const y of [0, height]) {
      const t = (y - start.y) / dy;
      const x = start.x + t * dx;
      if (x >= 0 && x <= width) candidates.push({ t, point: { x, y } });
    }
  }
  const unique = candidates.filter((entry, index) =>
    candidates.findIndex((other) => samePoint(entry.point, other.point)) === index);
  if (ray) {
    const forward = unique.filter((entry) => entry.t >= 0).sort((left, right) => right.t - left.t);
    return [start, forward[0]?.point ?? end];
  }
  const sorted = unique.sort((left, right) => left.t - right.t);
  return sorted.length >= 2
    ? [sorted[0]!.point, sorted[sorted.length - 1]!.point]
    : [start, end];
}

function createArcPath(
  center: Point,
  radius: number,
  startAngleDegrees: number,
  endAngleDegrees: number,
  sector: boolean,
): string {
  const start = pointOnCircle(center, radius, startAngleDegrees);
  const end = pointOnCircle(center, radius, endAngleDegrees);
  const delta = normalizedArcDelta(startAngleDegrees, endAngleDegrees);
  const arc = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${delta > 180 ? 1 : 0} 1 ${end.x} ${end.y}`;
  return sector ? `${arc} L ${center.x} ${center.y} Z` : arc;
}

function pointOnCircle(center: Point, radius: number, angleDegrees: number): Point {
  const radians = angleDegrees * Math.PI / 180;
  return {
    x: center.x + radius * Math.cos(radians),
    y: center.y + radius * Math.sin(radians),
  };
}

function normalizedArcDelta(start: number, end: number): number {
  const delta = (end - start) % 360;
  return delta < 0 ? delta + 360 : delta;
}

function defaultShapeLabelPosition(shape: MathShape, targetIndex: number | undefined): Point {
  const vertices = getMathShapeVertices(shape);
  const target = targetIndex === undefined ? undefined : vertices[targetIndex];
  return target === undefined
    ? { x: shape.bounds.width / 2, y: shape.bounds.height / 2 }
    : { x: target.x + 8, y: target.y - 8 };
}

function shapeMarkPosition(shape: MathShape, mark: MathShapeMark): Point {
  const vertices = getMathShapeVertices(shape);
  const index = mark.targetIndices[0] ?? 0;
  const start = vertices[index];
  const end = vertices[(index + 1) % vertices.length];
  if (start === undefined) return { x: shape.bounds.width / 2, y: shape.bounds.height / 2 };
  if (end === undefined || mark.markType === "angle" || mark.markType === "perpendicular") {
    return { x: start.x + 12, y: start.y + 16 };
  }
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 5 };
}

function markSymbol(markType: MathShapeMark["markType"]): string {
  if (markType === "parallel") return "∥";
  if (markType === "perpendicular") return "⊥";
  if (markType === "angle") return "∠";
  return "|";
}

function samePoint(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) < 1e-9 && Math.abs(left.y - right.y) < 1e-9;
}
