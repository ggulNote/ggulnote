import { describe, expect, it } from "vitest";
import {
  addMathGraphHelperLine,
  addMathGraphPoint,
  addMathGraphTangent,
  clipGraphLineToViewport,
  createMathAction,
  createMathGraph,
  createMathVisualModel,
  evaluateMathGraphDerivative,
  evaluateMathGraphFunction,
  executePhaseCMathAction,
  labelMathGraphPoint,
  sampleMathGraphFunctionSegments,
  type MathGraphFunction,
} from "../src";

const bounds = { x: 20, y: 30, width: 320, height: 220 };
const viewport = { xMin: -2, xMax: 4, yMin: -4, yMax: 8 };

const fn = (
  functionType: MathGraphFunction["functionType"],
  parameters: Readonly<Record<string, number>>,
  id = functionType,
): MathGraphFunction => ({ id, functionType, expression: `y=${functionType}(x)`, parameters });

describe("Phase C typed graph evaluator", () => {
  it("evaluates the supported high-school function families", () => {
    expect(evaluateMathGraphFunction(fn("cubic", { a: 1, b: 2, c: 3, d: 4 }), 2)).toBe(26);
    expect(evaluateMathGraphFunction(fn("quartic", { a: 1, b: 1, c: 1, d: 1, e: 1 }), 2)).toBe(31);
    expect(evaluateMathGraphFunction(fn("absolute", { a: 2, h: 1, k: -1 }), 3)).toBe(3);
    expect(evaluateMathGraphFunction(fn("rational", { a: 2, h: 1, k: 1 }), 3)).toBe(2);
    expect(evaluateMathGraphFunction(fn("radical", { a: 3, h: 1, k: 2 }), 5)).toBe(8);
    expect(evaluateMathGraphFunction(fn("exponential", { a: 2, base: 3, h: 1, k: 4 }), 3)).toBe(22);
    expect(evaluateMathGraphFunction(fn("logarithmic", { a: 2, base: 2, h: 1, k: 3 }), 5)).toBe(7);
    expect(evaluateMathGraphFunction(fn("sin", { a: 2 }), Math.PI / 2)).toBeCloseTo(2);
    expect(evaluateMathGraphFunction(fn("cos", {}), 0)).toBe(1);
    expect(evaluateMathGraphFunction(fn("tan", {}), Math.PI / 4)).toBeCloseTo(1);
  });

  it("honors domains and undefined natural domains without inventing values", () => {
    const restricted = {
      ...fn("linear", { a: 1, b: 0 }),
      domain: { min: 0, max: 2, includeMin: false, includeMax: true },
    };
    expect(evaluateMathGraphFunction(restricted, 0)).toBeUndefined();
    expect(evaluateMathGraphFunction(restricted, 2)).toBe(2);
    expect(evaluateMathGraphFunction(fn("rational", { h: 1 }), 1)).toBeUndefined();
    expect(evaluateMathGraphFunction(fn("radical", { h: 1 }), 0)).toBeUndefined();
    expect(evaluateMathGraphFunction(fn("logarithmic", { h: 1, base: 2 }), 1)).toBeUndefined();
    expect(() => createMathGraph({
      bounds,
      functions: [fn("logarithmic", { base: 1 })],
    }, "invalid-base")).toThrow("different from 1");
  });

  it("computes analytic slopes and leaves cusps undefined", () => {
    expect(evaluateMathGraphDerivative(fn("quadratic", { a: 1, b: 0, c: 0 }), 2)).toBe(4);
    expect(evaluateMathGraphDerivative(fn("sin", { a: 2, b: 3 }), 0)).toBe(6);
    expect(evaluateMathGraphDerivative(fn("absolute", { a: 2, h: 1 }), 1)).toBeUndefined();
    expect(evaluateMathGraphDerivative(fn("radical", { h: 1 }), 1)).toBeUndefined();
  });

  it("splits rational and tangent samples at every visible asymptote", () => {
    const coordinateSystem = {
      ...viewport,
      xMin: -2,
      xMax: 2,
      xStep: 1,
      yStep: 1,
      showAxes: true,
      showGrid: true,
    };
    const rationalSegments = sampleMathGraphFunctionSegments(
      fn("rational", { h: 0 }),
      coordinateSystem,
      { sampleCount: 3 },
    );
    const tangentSegments = sampleMathGraphFunctionSegments(
      fn("tan", {}),
      coordinateSystem,
      { sampleCount: 16 },
    );
    expect(rationalSegments).toHaveLength(2);
    expect(rationalSegments[0]!.every((point) => point.x < 0)).toBe(true);
    expect(rationalSegments[1]!.every((point) => point.x > 0)).toBe(true);
    expect(tangentSegments).toHaveLength(3);
  });
});

describe("Phase C graph sub-entities", () => {
  const quadratic = fn("quadratic", { a: 1, b: 0, c: 0 }, "quadratic-1");

  it("adds and labels explicit points without checking the user's claimed value", () => {
    const graph = createMathGraph({ bounds, viewport, functions: [quadratic] }, "graph-point");
    const withPoint = addMathGraphPoint(graph, {
      objectId: graph.id,
      x: 1,
      y: 99,
      label: "A",
      functionIds: [quadratic.id],
    });
    const labeled = labelMathGraphPoint(withPoint, {
      objectId: graph.id,
      pointId: withPoint.points[0]!.id,
      label: "B",
    });
    expect(labeled.points[0]).toMatchObject({
      position: { x: 1, y: 99 },
      label: "B",
      role: "user",
    });
    expect(labeled.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "graph_point" }),
    ]));
  });

  it("creates deterministic tangents and clips them to the viewport", () => {
    const graph = createMathGraph({ bounds, viewport, functions: [quadratic] }, "graph-tangent");
    const withTangent = addMathGraphTangent(graph, {
      objectId: graph.id,
      functionId: quadratic.id,
      atX: 1,
      label: "t",
    });
    expect(withTangent.tangents[0]).toMatchObject({
      point: { x: 1, y: 1 },
      slope: 2,
      label: "t",
    });
    expect(clipGraphLineToViewport(
      withTangent.tangents[0]!.point,
      withTangent.tangents[0]!.slope,
      withTangent.coordinateSystem,
    )).toEqual([{ x: -1.5, y: -4 }, { x: 4, y: 7 }]);

    const absolute = createMathGraph({
      bounds,
      functions: [fn("absolute", { h: 1 }, "absolute-1")],
    }, "graph-cusp");
    expect(() => addMathGraphTangent(absolute, {
      objectId: absolute.id,
      functionId: "absolute-1",
      atX: 1,
    })).toThrow("finite tangent does not exist");
  });

  it("validates helper geometry and renders point, tangent, helper, and labels", () => {
    const graph = createMathGraph({ bounds, viewport, functions: [quadratic] }, "graph-visual");
    const withPoint = addMathGraphPoint(graph, {
      objectId: graph.id,
      pointId: "point-A",
      x: 1,
      y: 1,
      label: "A",
    });
    const withTangent = addMathGraphTangent(withPoint, {
      objectId: graph.id,
      tangentId: "tangent-A",
      functionId: quadratic.id,
      atX: 1,
      label: "t",
    });
    const complete = addMathGraphHelperLine(withTangent, {
      objectId: graph.id,
      helperLine: {
        id: "guide-A",
        helperType: "vertical",
        start: { x: 1, y: 0 },
        end: { x: 1, y: 1 },
        lineStyle: "dashed",
        label: "x=1",
      },
    });
    const visual = createMathVisualModel(complete);
    expect(visual.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "circle", id: "point-A" }),
      expect.objectContaining({ kind: "line", id: "tangent-A" }),
      expect.objectContaining({ kind: "line", id: "guide-A", dash: "7 5" }),
      expect.objectContaining({ kind: "text", text: "A" }),
      expect.objectContaining({ kind: "text", text: "t" }),
      expect.objectContaining({ kind: "text", text: "x=1" }),
    ]));
    expect(() => addMathGraphHelperLine(complete, {
      objectId: graph.id,
      helperLine: {
        id: "bad-guide",
        helperType: "vertical",
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        lineStyle: "solid",
      },
    })).toThrow("equal x coordinates");
  });

  it("dispatches M2 and M3 actions while keeping arithmetic outside Phase C", () => {
    const created = executePhaseCMathAction(createMathAction("math.graph.create", {
      bounds,
      viewport,
      functions: [quadratic],
    }), { createObjectId: () => "graph-dispatch" });
    const updated = executePhaseCMathAction(createMathAction("math.graph.add_point", {
      objectId: created.object.id,
      x: 2,
      y: 4,
    }), { currentObject: created.object });
    expect(updated.object).toMatchObject({ kind: "graph", points: [{ position: { x: 2, y: 4 } }] });
    expect(updated.renderOperation).toMatchObject({
      kind: "UPSERT_MATH_OBJECT",
      plan: { logicalObjectId: "graph-dispatch" },
    });
    expect(() => executePhaseCMathAction(createMathAction("math.arithmetic.setup_vertical_add", {
      bounds,
      operands: ["1", "2"],
    }))).toThrow("outside Phase C");
  });
});
