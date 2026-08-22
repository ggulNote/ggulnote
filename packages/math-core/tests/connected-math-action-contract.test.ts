import { describe, expect, it } from "vitest";
import {
  connectedMathActionDecisionArgsSchema,
  createConnectedMathAction,
  parseConnectedMathActionDecisionArgs,
} from "../src/actions/connected-math-action-contract";
import { executePhaseCMathAction } from "../src/handlers/phase-c-math-action-handler";

describe("connected circle action", () => {
  it("keeps semantic args empty and calculates exact circle geometry locally", () => {
    expect(connectedMathActionDecisionArgsSchema("math.shape.create_circle"))
      .toMatchObject({ required: [], additionalProperties: false });
    expect(parseConnectedMathActionDecisionArgs("math.shape.create_circle", {}))
      .toEqual({});
    expect(createConnectedMathAction("math.shape.create_circle", {}, {
      objectId: "circle-1",
      bounds: { x: 300, y: 350, width: 80, height: 70 },
    })).toEqual({
      id: "math.shape.create_circle",
      input: {
        objectId: "circle-1",
        bounds: { x: 300, y: 350, width: 80, height: 70 },
        shapeType: "circle",
        geometry: {
          kind: "circle",
          center: { x: 40, y: 35 },
          radius: 28,
        },
      },
    });
  });
});

describe("connected graph semantic contract", () => {
  it("keeps expression as source of truth and compiles graph parameters locally", () => {
    const action = createConnectedMathAction("math.graph.create", {
      expression: "y=x^2+1",
    }, {
      objectId: "graph-1",
      bounds: { x: 120, y: 160, width: 300, height: 240 },
    });

    expect(action).toMatchObject({
      id: "math.graph.create",
      input: {
        bounds: { x: 120, y: 160, width: 300, height: 240 },
        functions: [{
          expression: "y=x^2+1",
          functionType: "quadratic",
          parameters: { a: 1, b: 0, c: 1 },
        }],
      },
    });
  });

  it("keeps graph points in graph-domain coordinates", () => {
    expect(createConnectedMathAction("math.graph.add_point", {
      point: { x: 1, y: 2 },
      label: null,
    }, { objectId: "graph-1" })).toEqual({
      id: "math.graph.add_point",
      input: { objectId: "graph-1", x: 1, y: 2 },
    });
  });

  it("uses model-selected graph-domain x and calculates the tangent locally", () => {
    const created = executePhaseCMathAction(createConnectedMathAction("math.graph.create", {
      expression: "y=x^2+1",
    }, {
      objectId: "graph-1",
      bounds: { x: 120, y: 160, width: 300, height: 240 },
    }));
    const tangentAction = createConnectedMathAction("math.graph.add_tangent", {
      at: { x: 2 },
      label: null,
    }, {
      objectId: "graph-1",
      currentObject: created.object,
    });
    const updated = executePhaseCMathAction(tangentAction, { currentObject: created.object });

    expect(tangentAction).toMatchObject({
      input: { objectId: "graph-1", atX: 2 },
    });
    expect(updated.object).toMatchObject({
      kind: "graph",
      tangents: [{ point: { x: 2, y: 5 }, slope: 4 }],
    });
  });
});
