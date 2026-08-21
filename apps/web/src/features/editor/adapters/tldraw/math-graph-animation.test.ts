import { createMathGraph, createMathVisualModel } from "@ggulnote/math-core";
import { describe, expect, it } from "vitest";
import {
  MATH_GRAPH_CREATE_ANIMATION_DURATION_MS,
  createMathGraphStrokeAnimationPlan,
  finishMathGraphCreateAnimation,
  readMathGraphCreateAnimation,
  startMathGraphCreateAnimation,
} from "./math-graph-animation";

describe("math graph create animation", () => {
  it("animates axes, arrowheads, and the exact sampled curve in deterministic order", () => {
    const graph = graphFixture("graph-animation-order");
    const firstModel = createMathVisualModel(graph);
    const secondModel = createMathVisualModel(graph);
    const ids = firstModel.primitives.map((primitive) => primitive.id);

    expect(firstModel.renderingHint).toBe("hand-drawn");
    expect(ids.slice(0, 5)).toEqual([
      `${graph.id}:axis:x`,
      `${graph.id}:axis:x:arrowhead`,
      `${graph.id}:axis:y`,
      `${graph.id}:axis:y:arrowhead`,
      `${graph.functions[0]!.id}:segment:0`,
    ]);
    expect(ids.some((id) => id.includes(":grid:"))).toBe(false);
    expect(secondModel.primitives).toEqual(firstModel.primitives);

    const plan = createMathGraphStrokeAnimationPlan(firstModel.primitives, 0);
    expect([...plan.keys()]).toEqual(ids.slice(0, 5));
    const steps = [...plan.values()];
    expect(steps.map((step) => step.delayMs)).toEqual([...steps]
      .map((step) => step.delayMs)
      .sort((left, right) => left - right));
    expect(steps[4]!.durationMs).toBeGreaterThan(steps[0]!.durationMs);
    expect(steps[0]!.durationMs).toBeGreaterThan(steps[1]!.durationMs);
    expect(steps.at(-1)!.delayMs + steps.at(-1)!.durationMs)
      .toBeCloseTo(MATH_GRAPH_CREATE_ANIMATION_DURATION_MS);
  });

  it("continues from the original start across rerenders and finishes at the final frame", () => {
    const objectId = "graph-animation-rerender";
    startMathGraphCreateAnimation(objectId, 1_000);

    expect(readMathGraphCreateAnimation(objectId, 1_100)).toEqual({
      elapsedMs: 100,
      remainingMs: 1_100,
    });
    expect(readMathGraphCreateAnimation(objectId, 1_450)).toEqual({
      elapsedMs: 450,
      remainingMs: 750,
    });
    expect(readMathGraphCreateAnimation(objectId, 2_200)).toBeUndefined();
    expect(readMathGraphCreateAnimation(objectId, 2_201)).toBeUndefined();
  });

  it("cancels the create animation when the same logical graph is updated", () => {
    const objectId = "graph-animation-update";
    startMathGraphCreateAnimation(objectId, 1_000);
    expect(readMathGraphCreateAnimation(objectId, 1_100)).toBeDefined();

    finishMathGraphCreateAnimation(objectId);

    expect(readMathGraphCreateAnimation(objectId, 1_101)).toBeUndefined();
  });
});

function graphFixture(objectId: string) {
  return createMathGraph({
    bounds: { x: 100, y: 120, width: 360, height: 300 },
    style: { handDrawn: true },
    showAxes: true,
    showGrid: false,
    functions: [{
      id: `${objectId}:function:1`,
      expression: "y=x²",
      functionType: "quadratic",
      parameters: { a: 1, b: 0, c: 0 },
    }],
  }, objectId);
}
