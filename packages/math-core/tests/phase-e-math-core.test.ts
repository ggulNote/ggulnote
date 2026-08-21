import { describe, expect, it } from "vitest";
import {
  addMathGraphHelperLine,
  addMathGraphPoint,
  addMathGraphTangent,
  createMathAction,
  createMathExpression,
  createMathGraph,
  createMathTable,
  createMathVisualModel,
  prepareMathActionExecution,
  projectMathObjectToCatalog,
  setupVerticalArithmetic,
  type MathObject,
} from "../src";

const bounds = { x: 100, y: 200, width: 300, height: 180 };
const pageSize = { width: 1_000, height: 1_000 };

describe("Phase E rendering hint", () => {
  it("keeps precise rendering by default and exposes opt-in hand-drawn presentation", () => {
    const precise = createMathExpression({
      bounds,
      content: { source: "y=x^2", format: "plain" },
    }, "expression-precise");
    const handDrawn = createMathExpression({
      bounds,
      style: { handDrawn: true },
      content: { source: "y=x^2", format: "plain" },
    }, "expression-hand-drawn");

    expect(createMathVisualModel(precise)).toMatchObject({ renderingHint: "precise" });
    const handDrawnVisual = createMathVisualModel(handDrawn);
    expect(handDrawnVisual).toMatchObject({ renderingHint: "hand-drawn" });
    expect(handDrawnVisual.primitives).toEqual([
      expect.objectContaining({ kind: "text", fontFamily: expect.stringContaining("Segoe Print") }),
    ]);
  });
});

describe("Phase E Object Catalog projection", () => {
  it("projects page-normalized bounds and expression capabilities without Note Agent imports", () => {
    const expression = createMathExpression({
      bounds,
      content: { source: "(x+1)/2", format: "plain" },
    }, "expression-catalog");
    const projected = projectMathObjectToCatalog(expression, {
      handle: "O42" as const,
      pageSize,
      selected: true,
    });

    expect(projected).toMatchObject({
      handle: "O42",
      source: "tldraw",
      kind: "math",
      summary: "(x+1)/2",
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.18 },
      selected: true,
      focused: false,
      recent: false,
      parts: [{ kind: "expression", summary: "(x+1)/2" }],
    });
    expect(projected.capabilities).toEqual(expect.arrayContaining([
      "anchorable",
      "editable",
      "mathExpressionEditable",
      "partAddressable",
    ]));
  });

  it("summarizes graph sub-entities and advertises follow-up graph actions", () => {
    const fn = {
      id: "quadratic",
      functionType: "quadratic" as const,
      expression: "y=x^2",
      parameters: { a: 1, b: 0, c: 0 },
    };
    const graph = createMathGraph({ bounds, functions: [fn] }, "graph-catalog");
    const withPoint = addMathGraphPoint(graph, {
      objectId: graph.id,
      pointId: "point-a",
      x: 1,
      y: 1,
      label: "A",
      functionIds: [fn.id],
    });
    const withTangent = addMathGraphTangent(withPoint, {
      objectId: graph.id,
      tangentId: "tangent-a",
      functionId: fn.id,
      atX: 1,
    });
    const complete = addMathGraphHelperLine(withTangent, {
      objectId: graph.id,
      helperLine: {
        id: "guide-a",
        helperType: "vertical",
        start: { x: 1, y: 0 },
        end: { x: 1, y: 1 },
        lineStyle: "dotted",
      },
    });
    const projected = projectMathObjectToCatalog(complete, { handle: "O7", pageSize });

    expect(projected).toMatchObject({
      kind: "graph",
      summary: "y=x^2 graph with 1 point(s), 1 tangent(s), 1 helper line(s)",
    });
    expect(projected.capabilities).toEqual(expect.arrayContaining([
      "mathPointAddable",
      "tangentAddable",
      "helperLineAddable",
    ]));
    expect(projected.parts).toEqual(expect.arrayContaining([
      { kind: "curve", summary: "y=x^2" },
      { kind: "point", summary: "A(1, 1)" },
      { kind: "tangent", summary: "tangent at x=1" },
      { kind: "helper_line", summary: "vertical" },
    ]));
  });

  it("describes vertical arithmetic as recorded work without deriving an answer", () => {
    const layout = setupVerticalArithmetic("multiply", {
      bounds,
      operands: ["78", "34"],
    }, "arithmetic-catalog");
    const projected = projectMathObjectToCatalog(layout, { handle: "O51", pageSize });

    expect(projected).toMatchObject({
      kind: "math",
      summary: "vertical multiplication: 78 × 34",
    });
    expect(projected.summary).not.toContain("2652");
    expect(projected.capabilities).toEqual(expect.arrayContaining([
      "mathArithmeticWritable",
      "carryWritable",
    ]));
  });

  it("rejects invalid page dimensions before normalizing bounds", () => {
    const table = createMathTable({ bounds, rows: 1, columns: 1 }, "table-page-size");
    expect(() => projectMathObjectToCatalog(table, {
      handle: "O1",
      pageSize: { width: 0, height: 1_000 },
    })).toThrow("positive finite dimensions");
  });
});

describe("Phase E Action Registry integration hook", () => {
  it("prepares create and update results while leaving persistence and rendering to the caller", () => {
    const objects = new Map<string, MathObject>();
    const port = {
      getObject: (objectId: string) => objects.get(objectId),
      createObjectId: () => "table-from-port",
    };
    const created = prepareMathActionExecution(createMathAction("math.table.create", {
      bounds,
      rows: 2,
      columns: 2,
    }), port);
    expect(created).toMatchObject({
      actionId: "math.table.create",
      definition: { target: "create", objectKind: "table" },
      object: { id: "table-from-port", kind: "table" },
      renderOperation: { kind: "UPSERT_MATH_OBJECT" },
    });
    expect(objects.size).toBe(0);

    objects.set(created.object.id, created.object);
    const updated = prepareMathActionExecution(createMathAction("math.table.set_cell", {
      objectId: created.object.id,
      row: 0,
      column: 0,
      value: "x",
    }), port);
    expect(updated.object).toMatchObject({ kind: "table", cells: [[{ value: "x" }, {}], [{}, {}]] });
    expect(objects.get(created.object.id)).toBe(created.object);
  });

  it("fails before dispatch when the runtime cannot resolve an existing target", () => {
    expect(() => prepareMathActionExecution(createMathAction("math.graph.add_point", {
      objectId: "missing-graph",
      x: 1,
      y: 2,
    }), { getObject: () => undefined })).toThrow("target does not exist");
  });
});
