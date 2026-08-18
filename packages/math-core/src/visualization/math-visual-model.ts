import type { Point, Rect } from "@ggulnote/shared-types";
import type {
  ArithmeticLayout,
  MathGraph,
  MathObject,
  MathObjectStyle,
  MathShape,
  MathShapeMark,
  MathTable,
} from "../domain/math-object";
import { createMathArithmeticGeometry } from "../arithmetic/math-arithmetic-layout";
import { getMathExpressionDisplayText } from "../expression/math-expression-handler";
import {
  clipGraphLineToViewport,
  mapGraphPointToBounds,
  sampleMathGraphFunctionSegments,
} from "../graph/math-graph-handler";
import { getMathShapeVertices } from "../shape/math-shape-handler";

export type MathVisualTextAnchor = "start" | "middle" | "end";

export interface MathVisualStroke {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly dash?: string;
}

export type MathVisualPathCommand =
  | {
      readonly kind: "move" | "line";
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "arc";
      readonly radiusX: number;
      readonly radiusY: number;
      readonly largeArc: boolean;
      readonly sweep: boolean;
      readonly xAxisRotationRadians: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "close";
    };

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
      /** Neutral path commands let runtime adapters reuse their native stroke renderer. */
      readonly commands?: readonly MathVisualPathCommand[];
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
  readonly renderingHint: "precise" | "hand-drawn";
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
    renderingHint: object.style.handDrawn === true ? "hand-drawn" : "precise",
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
      return arithmeticPrimitives(object, width, height);
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

function arithmeticPrimitives(
  layout: ArithmeticLayout,
  width: number,
  height: number,
): readonly MathVisualPrimitive[] {
  const geometry = createMathArithmeticGeometry(layout, { x: 0, y: 0, width, height });
  const primitives: MathVisualPrimitive[] = [];
  for (const row of layout.rows) {
    const baseline = geometry.rowBaselines[row.id];
    const operatorPosition = geometry.operatorPositions[row.id];
    if (row.operator !== undefined && operatorPosition !== undefined) {
      primitives.push(textPrimitive(
        `${row.id}:operator`,
        row.operator,
        operatorPosition.x,
        operatorPosition.y,
        layout.style,
        "middle",
        geometry.fontSize,
      ));
    }
    if (baseline === undefined) continue;
    for (const cell of row.cells) {
      const cellBounds = geometry.cellBounds[cell.id];
      if (cellBounds === undefined) continue;
      primitives.push(textPrimitive(
        cell.id,
        cell.value,
        cellBounds.x + cellBounds.width / 2,
        baseline,
        layout.style,
        "middle",
        geometry.fontSize,
      ));
    }
  }
  for (const carry of layout.carryMarks) {
    const carryBounds = geometry.carryBounds[carry.id];
    if (carryBounds === undefined) continue;
    primitives.push(textPrimitive(
      carry.id,
      carry.value,
      carryBounds.x + carryBounds.width / 2,
      carryBounds.y + carryBounds.height * 0.72,
      { ...layout.style, color: layout.style.color ?? "#64748b" },
      "middle",
      geometry.carryFontSize,
    ));
  }
  for (const separator of layout.separators) {
    const separatorBounds = geometry.separatorBounds[separator.id];
    if (separatorBounds === undefined) continue;
    primitives.push({
      kind: "line",
      id: separator.id,
      x1: separatorBounds.x,
      y1: separatorBounds.y,
      x2: separatorBounds.x + separatorBounds.width,
      y2: separatorBounds.y,
      ...strokeStyle({ ...layout.style, lineStyle: separator.lineStyle }, "#172033", 1.5),
    });
  }
  if (geometry.cursorBounds !== undefined) {
    primitives.push({
      kind: "rect",
      id: `${layout.id}:cursor`,
      x: geometry.cursorBounds.x,
      y: geometry.cursorBounds.y,
      width: geometry.cursorBounds.width,
      height: geometry.cursorBounds.height,
      fill: "transparent",
      ...strokeStyle({ ...layout.style, lineStyle: "dotted" }, "#94a3b8", 1),
    });
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
      const axisEnd = { x: plot.x + plot.width, y: origin.y };
      primitives.push({
        kind: "line",
        id: `${graph.id}:axis:x`,
        x1: plot.x,
        y1: origin.y,
        x2: axisEnd.x,
        y2: axisEnd.y,
        ...axes,
      }, {
        kind: "polyline",
        id: `${graph.id}:axis:x:arrowhead`,
        points: axisArrowhead(axisEnd, "x"),
        closed: false,
        fill: "none",
        ...axes,
      });
    }
    if (graph.coordinateSystem.xMin <= 0 && graph.coordinateSystem.xMax >= 0) {
      const origin = mapGraphPointToBounds({ x: 0, y: 0 }, graph.coordinateSystem, plot);
      const axisEnd = { x: origin.x, y: plot.y };
      primitives.push({
        kind: "line",
        id: `${graph.id}:axis:y`,
        x1: origin.x,
        y1: plot.y + plot.height,
        x2: origin.x,
        y2: axisEnd.y,
        ...axes,
      }, {
        kind: "polyline",
        id: `${graph.id}:axis:y:arrowhead`,
        points: axisArrowhead(axisEnd, "y"),
        closed: false,
        fill: "none",
        ...axes,
      });
    }
  }
  graph.functions.forEach((fn, index) => {
    const style = { ...graph.style, ...fn.style };
    sampleMathGraphFunctionSegments(fn, graph.coordinateSystem).forEach((segment, segmentIndex) => {
      if (segment.length < 2) return;
      primitives.push({
        kind: "polyline",
        id: `${fn.id}:segment:${segmentIndex}`,
        points: segment.map((point) =>
          mapGraphPointToBounds(point, graph.coordinateSystem, plot)),
        closed: false,
        fill: "none",
        ...strokeStyle(style, palette(index), 2),
      });
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
  for (const helperLine of graph.helperLines) {
    const start = mapGraphPointToBounds(helperLine.start, graph.coordinateSystem, plot);
    const end = mapGraphPointToBounds(helperLine.end, graph.coordinateSystem, plot);
    primitives.push({
      kind: "line",
      id: helperLine.id,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      ...strokeStyle(
        { ...graph.style, lineStyle: helperLine.lineStyle },
        "#64748b",
        1.25,
      ),
    });
    if (helperLine.label !== undefined) {
      primitives.push(textPrimitive(
        `${helperLine.id}:label`,
        helperLine.label,
        (start.x + end.x) / 2 + 4,
        (start.y + end.y) / 2 - 4,
        graph.style,
        "start",
        Math.min(13, graph.style.fontSize ?? 13),
      ));
    }
  }
  for (const tangent of graph.tangents) {
    const segment = clipGraphLineToViewport(
      tangent.point,
      tangent.slope,
      graph.coordinateSystem,
    );
    if (segment !== undefined) {
      const start = mapGraphPointToBounds(segment[0], graph.coordinateSystem, plot);
      const end = mapGraphPointToBounds(segment[1], graph.coordinateSystem, plot);
      const functionIndex = graph.functions.findIndex((fn) => fn.id === tangent.functionId);
      primitives.push({
        kind: "line",
        id: tangent.id,
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        ...strokeStyle(graph.style, palette(Math.max(0, functionIndex)), 1.5),
      });
    }
    if (tangent.label !== undefined) {
      const position = mapGraphPointToBounds(tangent.point, graph.coordinateSystem, plot);
      primitives.push(textPrimitive(
        `${tangent.id}:label`,
        tangent.label,
        position.x + 6,
        position.y - 8,
        graph.style,
        "start",
        Math.min(13, graph.style.fontSize ?? 13),
      ));
    }
  }
  const pointStroke = strokeStyle(graph.style, "#0f172a", 1.5);
  for (const point of graph.points) {
    const position = mapGraphPointToBounds(point.position, graph.coordinateSystem, plot);
    primitives.push({
      kind: "circle",
      id: point.id,
      cx: position.x,
      cy: position.y,
      radius: 4,
      fill: pointStroke.stroke,
      ...pointStroke,
    });
    if (point.label !== undefined) {
      primitives.push(textPrimitive(
        `${point.id}:label`,
        point.label,
        position.x + 6,
        position.y - 6,
        graph.style,
        "start",
        Math.min(14, graph.style.fontSize ?? 14),
      ));
    }
  }
  for (const label of graph.labels) {
    const position = mapGraphPointToBounds(label.position, graph.coordinateSystem, plot);
    primitives.push(textPrimitive(
      label.id,
      label.text,
      position.x,
      position.y,
      graph.style,
      "start",
      Math.min(14, graph.style.fontSize ?? 14),
    ));
  }
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
    const arcPath = createArcPath(
      geometry.center,
      geometry.radius,
      geometry.startAngleDegrees,
      geometry.endAngleDegrees,
      shape.shapeType === "sector",
    );
    primitives.push({
      kind: "path",
      id: `${shape.id}:arc`,
      d: arcPath.d,
      commands: arcPath.commands,
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
    fontFamily: style.fontFamily
      ?? (style.handDrawn === true
        ? "'Segoe Print', 'Comic Sans MS', cursive"
        : "Arial, sans-serif"),
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

function axisArrowhead(end: Point, axis: "x" | "y"): readonly Point[] {
  const size = 8;
  return axis === "x"
    ? [
        { x: end.x - size, y: end.y - size * 0.65 },
        end,
        { x: end.x - size, y: end.y + size * 0.65 },
      ]
    : [
        { x: end.x - size * 0.65, y: end.y + size },
        end,
        { x: end.x + size * 0.65, y: end.y + size },
      ];
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
): { readonly d: string; readonly commands: readonly MathVisualPathCommand[] } {
  const start = pointOnCircle(center, radius, startAngleDegrees);
  const end = pointOnCircle(center, radius, endAngleDegrees);
  const delta = normalizedArcDelta(startAngleDegrees, endAngleDegrees);
  const arc = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${delta > 180 ? 1 : 0} 1 ${end.x} ${end.y}`;
  const commands: MathVisualPathCommand[] = [
    { kind: "move", x: start.x, y: start.y },
    {
      kind: "arc",
      radiusX: radius,
      radiusY: radius,
      largeArc: delta > 180,
      sweep: true,
      xAxisRotationRadians: 0,
      x: end.x,
      y: end.y,
    },
  ];
  if (sector) {
    commands.push(
      { kind: "line", x: center.x, y: center.y },
      { kind: "close" },
    );
  }
  return {
    d: sector ? `${arc} L ${center.x} ${center.y} Z` : arc,
    commands,
  };
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
