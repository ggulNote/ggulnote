import { describe, expect, it } from "vitest";
import {
  BASE_MATH_LAYOUT_ENGINE,
  MATH_ACTION_DEFINITIONS,
  MATH_TLDRAW_SHAPE_TYPE,
  compileMathRenderDelete,
  compileMathRenderUpsert,
  createMathAction,
  deserializeMathObject,
  isSerializedMathObject,
  mathActionDefinitionById,
  parseMathObject,
  serializeMathObject,
  stringifyMathObject,
  type ArithmeticLayout,
  type MathExpression,
  type MathGraph,
  type MathObject,
  type MathRenderAdapter,
  type MathRenderOperation,
  type MathShape,
  type MathTable,
} from "../src";

const expression: MathExpression = {
  id: "expression-1",
  kind: "expression",
  bounds: { x: 10, y: 20, width: 180, height: 60 },
  style: { color: "#111827", fontSize: 20 },
  label: "quadratic expression",
  metadata: { source: "user" },
  children: [{ id: "expression-1:root", kind: "expression_node" }],
  content: {
    source: "y=(x^2+1)/sqrt(2)",
    format: "structured",
    root: {
      type: "equation",
      operator: "=",
      left: { type: "text", value: "y" },
      right: {
        type: "fraction",
        numerator: {
          type: "group",
          opening: "(",
          closing: ")",
          content: {
            type: "sequence",
            items: [
              {
                type: "power",
                base: { type: "text", value: "x" },
                exponent: { type: "text", value: "2" },
              },
              { type: "text", value: "+1" },
            ],
          },
        },
        denominator: {
          type: "root",
          radicand: { type: "text", value: "2" },
        },
      },
    },
  },
  displayMode: "block",
  alignment: "center",
  editable: true,
};

const table: MathTable = {
  id: "table-1",
  kind: "table",
  bounds: { x: 0, y: 0, width: 160, height: 80 },
  style: {},
  metadata: {},
  children: [],
  tableType: "xy_values",
  rowCount: 1,
  columnCount: 2,
  cells: [[
    { id: "cell-x", row: 0, column: 0, value: "x" },
    { id: "cell-y", row: 0, column: 1, value: "y" },
  ]],
  headerRows: [0],
  headerColumns: [],
  defaultCellAlignment: "center",
};

const graph: MathGraph = {
  id: "graph-1",
  kind: "graph",
  bounds: { x: 30, y: 40, width: 320, height: 240 },
  style: { handDrawn: true },
  metadata: {},
  children: [{ id: "fn-1", kind: "function" }, { id: "point-a", kind: "point" }],
  coordinateSystem: {
    xMin: -5,
    xMax: 5,
    yMin: -5,
    yMax: 5,
    xStep: 1,
    yStep: 1,
    showAxes: true,
    showGrid: true,
    xLabel: "x",
    yLabel: "y",
  },
  functions: [{
    id: "fn-1",
    functionType: "quadratic",
    expression: "y=x^2",
    parameters: { a: 1, b: 0, c: 0 },
  }],
  points: [{
    id: "point-a",
    position: { x: 1, y: 1 },
    label: "A",
    role: "user",
    functionIds: ["fn-1"],
  }],
  tangents: [{
    id: "tangent-1",
    functionId: "fn-1",
    atX: 1,
    point: { x: 1, y: 1 },
    slope: 2,
  }],
  helperLines: [{
    id: "guide-1",
    helperType: "axis_guides",
    start: { x: 1, y: 0 },
    end: { x: 1, y: 1 },
    lineStyle: "dashed",
  }],
  labels: [],
};

const shape: MathShape = {
  id: "shape-1",
  kind: "shape",
  bounds: { x: 5, y: 6, width: 100, height: 80 },
  style: { strokeColor: "#111827" },
  metadata: {},
  children: [],
  shapeType: "triangle",
  preset: "right_triangle",
  geometry: {
    kind: "polygon",
    vertices: [{ x: 0, y: 80 }, { x: 0, y: 0 }, { x: 100, y: 80 }],
  },
  labels: [{ id: "vertex-a", text: "A", target: "vertex", targetIndex: 0 }],
  marks: [{ id: "right-angle", markType: "perpendicular", targetIndices: [0, 1] }],
};

const arithmetic: ArithmeticLayout = {
  id: "arithmetic-1",
  kind: "arithmetic_layout",
  bounds: { x: 10, y: 10, width: 120, height: 160 },
  style: { fontFamily: "handwriting" },
  metadata: {},
  children: [],
  arithmeticType: "multiply",
  operands: ["78", "34"],
  rows: [
    {
      id: "operand-1",
      rowType: "operand",
      cells: [
        { id: "operand-1-ones", column: 0, value: "8" },
        { id: "operand-1-tens", column: 1, value: "7" },
      ],
      offsetColumns: 0,
    },
    {
      id: "partial-1",
      rowType: "partial",
      cells: [{ id: "partial-1-ones", column: 0, value: "2" }],
      offsetColumns: 0,
    },
  ],
  carryMarks: [{ id: "carry-1", column: 1, value: "3", sourceRowId: "partial-1" }],
  separators: [{ id: "separator-1", afterRowId: "operand-1", lineStyle: "solid" }],
  cursor: { rowId: "partial-1", column: 1 },
};

const allObjects: readonly MathObject[] = [expression, table, graph, shape, arithmetic];

describe("math object serialization", () => {
  it("round-trips every logical object kind", () => {
    for (const object of allObjects) {
      const serialized = serializeMathObject(object);
      expect(serialized.object).not.toBe(object);
      expect(deserializeMathObject(serialized)).toEqual(object);
      expect(parseMathObject(stringifyMathObject(object))).toEqual(object);
      expect(isSerializedMathObject(serialized)).toBe(true);
    }
  });

  it("preserves handwritten arithmetic exactly without checking the answer", () => {
    const restored = deserializeMathObject(serializeMathObject(arithmetic));
    expect(restored.kind).toBe("arithmetic_layout");
    if (restored.kind !== "arithmetic_layout") return;
    expect(restored.rows[1]?.cells[0]?.value).toBe("2");
    expect(restored.carryMarks[0]?.value).toBe("3");
  });

  it("rejects unsupported versions and malformed geometry", () => {
    expect(() => deserializeMathObject({ schemaVersion: 2, object: expression })).toThrow(
      "Unsupported math object schemaVersion",
    );
    expect(() => serializeMathObject({
      ...expression,
      bounds: { ...expression.bounds, width: Number.NaN },
    })).toThrow("object.bounds.width must be a finite number");
    expect(isSerializedMathObject({
      schemaVersion: 1,
      object: { ...table, cells: [] },
    })).toBe(false);
  });
});

describe("math action definitions", () => {
  it("keeps every small action id unique", () => {
    const ids = MATH_ACTION_DEFINITIONS.map((definition) => definition.id);
    expect(ids).toHaveLength(33);
    expect(new Set(ids).size).toBe(ids.length);
    expect(mathActionDefinitionById("math.graph.add_tangent")).toMatchObject({
      objectKind: "graph",
      target: "existing",
      milestone: "C",
    });
  });

  it("builds a voice-registry-friendly typed action envelope", () => {
    const action = createMathAction("math.arithmetic.write_carry", {
      objectId: "arithmetic-1",
      column: 1,
      value: "3",
    });
    expect(action).toEqual({
      id: "math.arithmetic.write_carry",
      input: { objectId: "arithmetic-1", column: 1, value: "3" },
    });
  });
});

describe("math layout and render boundary", () => {
  it("creates deterministic anchors without runtime dependencies", () => {
    const layout = BASE_MATH_LAYOUT_ENGINE.layout(expression);
    expect(layout.anchors.map((anchor) => [anchor.role, anchor.point])).toEqual([
      ["center", { x: 100, y: 50 }],
      ["top", { x: 100, y: 20 }],
      ["right", { x: 190, y: 50 }],
      ["bottom", { x: 100, y: 80 }],
      ["left", { x: 10, y: 50 }],
    ]);
  });

  it("keeps a graph and its children inside one custom-shape plan", () => {
    const operation = compileMathRenderUpsert(graph);
    expect(operation.kind).toBe("UPSERT_MATH_OBJECT");
    if (operation.kind !== "UPSERT_MATH_OBJECT") return;
    expect(operation.plan).toMatchObject({
      logicalObjectId: "graph-1",
      objectKind: "graph",
      shapeType: MATH_TLDRAW_SHAPE_TYPE,
      childIds: ["fn-1", "point-a"],
    });
    expect(operation.plan.snapshot.object).toEqual(graph);
  });

  it("can be consumed by a runtime adapter without importing tldraw", () => {
    const applied: MathRenderOperation[] = [];
    const adapter: MathRenderAdapter<number> = {
      apply(operation) {
        applied.push(operation);
        return applied.length;
      },
    };
    expect(adapter.apply(compileMathRenderUpsert(expression))).toBe(1);
    expect(adapter.apply(compileMathRenderDelete("expression-1"))).toBe(2);
    expect(applied.map((operation) => operation.kind)).toEqual([
      "UPSERT_MATH_OBJECT",
      "DELETE_MATH_OBJECT",
    ]);
  });
});
