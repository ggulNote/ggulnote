import { describe, expect, it } from "vitest";
import {
  BASE_MATH_LAYOUT_ENGINE,
  addMathTableColumn,
  addMathTableRow,
  createMathAction,
  createMathExpression,
  createMathGraph,
  createMathShape,
  createMathTable,
  createMathVisualModel,
  evaluateMathGraphFunction,
  executePhaseBMathAction,
  insertMathPower,
  labelMathShapeVertex,
  markMathShape,
  sampleMathGraphFunction,
  setMathTableCell,
  type MathGraphFunction,
} from "../src";

const bounds = { x: 20, y: 30, width: 240, height: 160 };

describe("Phase B math expression handlers", () => {
  it("creates and immutably replaces a structured node", () => {
    const original = createMathExpression({
      objectId: "expression-1",
      bounds,
      content: {
        source: "x",
        format: "structured",
        root: { type: "text", value: "x" },
      },
    }, "expression-1");

    const powered = insertMathPower(original, {
      objectId: original.id,
      path: [],
      base: { type: "text", value: "x" },
      exponent: { type: "text", value: "2" },
    });

    expect(powered.content.source).toBe("x^(2)");
    expect(powered.content.root).toMatchObject({ type: "power" });
    expect(original.content.root).toEqual({ type: "text", value: "x" });
    expect(createMathVisualModel(powered).primitives).toEqual([
      expect.objectContaining({ kind: "text", text: "x^(2)" }),
    ]);
  });

  it("rejects a path outside the small expression tree", () => {
    const expression = createMathExpression({
      bounds,
      content: { source: "x", format: "structured", root: { type: "text", value: "x" } },
    }, "expression-path");
    expect(() => insertMathPower(expression, {
      objectId: expression.id,
      path: [0],
      base: { type: "text", value: "x" },
      exponent: { type: "text", value: "2" },
    })).toThrow("Expression path is outside");
  });
});

describe("Phase B math table handlers", () => {
  it("writes cells and inserts rows and columns while preserving existing cell ids", () => {
    const original = createMathTable({
      bounds,
      rows: 2,
      columns: 2,
      tableType: "xy_values",
      initialValues: [["x", "y"], ["1", "2"]],
      headerRows: [0],
    }, "table-1");
    const firstDataCellId = original.cells[1]![0]!.id;
    const written = setMathTableCell(original, {
      objectId: original.id,
      row: 1,
      column: 1,
      value: "3",
      alignment: "right",
    });
    const withRow = addMathTableRow(written, {
      objectId: original.id,
      atIndex: 1,
      values: ["2", "4"],
    });
    const withColumn = addMathTableColumn(withRow, {
      objectId: original.id,
      atIndex: 1,
      values: ["f(x)", "4", "3"],
    });

    expect(withColumn).toMatchObject({ rowCount: 3, columnCount: 3 });
    expect(withColumn.cells[2]![0]!.id).toBe(firstDataCellId);
    expect(withColumn.cells[2]![2]).toMatchObject({ value: "3", alignment: "right" });
    expect(new Set(withColumn.children.map((child) => child.id)).size).toBe(9);
    expect(Object.keys(BASE_MATH_LAYOUT_ENGINE.layout(withColumn).childBounds)).toHaveLength(9);
    expect(createMathVisualModel(withColumn).primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", text: "f(x)" }),
    ]));
  });
});

describe("Phase B graph evaluator and sampling", () => {
  const linear: MathGraphFunction = {
    id: "linear-1",
    functionType: "linear",
    expression: "y=2x+1",
    parameters: { a: 2, b: 1 },
  };
  const quadratic: MathGraphFunction = {
    id: "quadratic-1",
    functionType: "quadratic",
    expression: "y=x^2-1",
    parameters: { a: 1, b: 0, c: -1 },
  };

  it("evaluates linear and quadratic descriptors without parsing arbitrary expressions", () => {
    expect(evaluateMathGraphFunction(linear, 3)).toBe(7);
    expect(evaluateMathGraphFunction(quadratic, 3)).toBe(8);
    expect(evaluateMathGraphFunction({ ...linear, functionType: "sin" }, 0)).toBeUndefined();
  });

  it("samples a graph deterministically and compiles it into local visual primitives", () => {
    const graph = createMathGraph({
      bounds,
      functions: [linear, quadratic],
      viewport: { xMin: -2, xMax: 2, yMin: -3, yMax: 5 },
      showGrid: true,
    }, "graph-1");
    expect(sampleMathGraphFunction(linear, graph.coordinateSystem, { sampleCount: 4 })).toEqual([
      { x: -2, y: -3 },
      { x: -1, y: -1 },
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ]);
    expect(createMathVisualModel(graph).primitives.filter((primitive) =>
      primitive.kind === "polyline")).toHaveLength(2);
  });

  it("keeps Phase C function families out of the M2 create handler", () => {
    expect(() => createMathGraph({
      bounds,
      functions: [{ ...linear, functionType: "sin", expression: "y=sin x" }],
    }, "graph-sin")).toThrow("Phase B does not support sin");
  });
});

describe("Phase B geometry and action boundary", () => {
  it("creates, labels, and marks a basic shape as one logical object", () => {
    const rectangle = createMathShape({
      bounds,
      shapeType: "rectangle",
      preset: "rectangle",
      geometry: {
        kind: "polygon",
        vertices: [
          { x: 20, y: 20 },
          { x: 220, y: 20 },
          { x: 220, y: 140 },
          { x: 20, y: 140 },
        ],
      },
    }, "shape-1");
    const labeled = labelMathShapeVertex(rectangle, {
      objectId: rectangle.id,
      vertexIndex: 0,
      label: "A",
    });
    const marked = markMathShape(labeled, "perpendicular", {
      objectId: rectangle.id,
      targetIndices: [0, 1],
    });
    const visual = createMathVisualModel(marked);

    expect(marked.children.map((child) => child.kind)).toEqual(["shape_label", "shape_mark"]);
    expect(visual.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "polyline", closed: true }),
      expect.objectContaining({ kind: "text", text: "A" }),
      expect.objectContaining({ kind: "text", text: "⊥" }),
    ]));
  });

  it("returns a render operation without owning storage or runtime state", () => {
    const created = executePhaseBMathAction(createMathAction("math.table.create", {
      bounds,
      rows: 2,
      columns: 3,
    }), {
      createObjectId: (kind) => `${kind}-from-registry`,
    });

    expect(created.object).toMatchObject({ id: "table-from-registry", kind: "table" });
    expect(created.renderOperation).toMatchObject({
      kind: "UPSERT_MATH_OBJECT",
      plan: { logicalObjectId: "table-from-registry", objectKind: "table" },
    });
  });

  it("does not execute a Phase C action through the Phase B dispatcher", () => {
    expect(() => executePhaseBMathAction(createMathAction("math.graph.add_point", {
      objectId: "graph-1",
      x: 1,
      y: 2,
    }))).toThrow("outside Phase B");
  });
});
