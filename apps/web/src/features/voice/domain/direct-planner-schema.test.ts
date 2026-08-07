import { describe, expect, it } from "vitest";
import {
  DirectPlannerResultValidationError,
  parseDirectPlannerResult,
  safeParseDirectPlannerResult,
} from "./direct-planner-schema";

function createExecutableResult(): {
  status: string;
  planId: string;
  turnId: string;
  sceneRevision: number;
  normalizedIntent: string;
  relation: string;
  command: {
    capability: string;
    operation: string;
    target: Record<string, unknown>;
    payload: Record<string, unknown>;
  };
} {
  return {
    status: "EXECUTABLE",
    planId: "plan-1",
    turnId: "turn-1",
    sceneRevision: 7,
    normalizedIntent: "현재 포커스를 노란색으로 하이라이트",
    relation: "NEW",
    command: {
      capability: "annotation",
      operation: "highlight",
      target: { kind: "FROZEN_FOCUS" },
      payload: { color: "#facc15" },
    },
  };
}

describe("DirectPlannerResult runtime schema", () => {
  it("accepts a valid executable result", () => {
    expect(parseDirectPlannerResult(createExecutableResult())).toEqual(
      createExecutableResult(),
    );
  });

  it("rejects an unknown capability", () => {
    const value = createExecutableResult();
    value.command.capability = "drawing";

    expect(() => parseDirectPlannerResult(value)).toThrowError(
      /result\.command\.capability: unsupported capability/u,
    );
  });

  it("rejects an unknown operation", () => {
    const value = createExecutableResult();
    value.command.operation = "strikethrough";

    expect(() => parseDirectPlannerResult(value)).toThrowError(
      /result\.command\.operation: unsupported annotation operation/u,
    );
  });

  it("rejects an invalid operation payload", () => {
    const value = createExecutableResult();
    value.command = {
      capability: "text",
      operation: "replace_content",
      target: { kind: "FROZEN_FOCUS" },
      payload: { text: 42 },
    };

    expect(() => parseDirectPlannerResult(value)).toThrowError(
      /result\.command\.payload\.text: expected a string/u,
    );
  });

  it("accepts DEFER_SPATIAL without an executable command", () => {
    const value = {
      status: "DEFER_SPATIAL",
      turnId: "turn-spatial",
      reasonCode: "SPATIAL_REQUIRED",
    };

    expect(parseDirectPlannerResult(value)).toEqual(value);
  });

  it("rejects coordinate fields mixed into an executable command", () => {
    const value = createExecutableResult();
    value.command.target = {
      kind: "FROZEN_FOCUS",
      x: 830,
      y: 412,
    };

    const parsed = safeParseDirectPlannerResult(value);

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected coordinate-bearing planner output to fail.");
    }
    expect(parsed.error).toBeInstanceOf(DirectPlannerResultValidationError);
    expect(parsed.error.path).toBe("result.command.target.x");
  });

  it("rejects executable CANCEL relations in favor of CANCELLED", () => {
    const value = createExecutableResult();
    value.relation = "CANCEL";

    expect(() => parseDirectPlannerResult(value)).toThrowError(
      /CANCEL must use the CANCELLED planner result/u,
    );
  });
});
