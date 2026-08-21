import { describe, expect, it } from "vitest";
import {
  connectedMathActionDecisionArgsSchema,
  createConnectedMathAction,
  parseConnectedMathActionDecisionArgs,
} from "../src/actions/connected-math-action-contract";

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
