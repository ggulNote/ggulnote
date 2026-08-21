import { describe, expect, it } from "vitest";
import {
  DirectPlannerResultValidationError,
  parseDirectPlannerDraftResult,
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
      target: { kind: "relative", relation: "focused" },
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
      target: { kind: "relative", relation: "focused" },
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

  it("accepts text.create only with a strict semantic placement query", () => {
    const value = {
      ...createExecutableResult(),
      command: {
        capability: "text",
        operation: "create",
        target: { kind: "CURRENT_PAGE" },
        payload: { text: "그림 설명" },
      },
      placementQuery: {
        reference: {
          kind: "TARGET",
          query: { kind: "object", objectType: "image", query: "이 그림" },
        },
        relation: "BELOW",
        alignment: "START",
        overlayIntent: "NONE",
      },
    };

    expect(parseDirectPlannerResult(value)).toEqual(value);
    const withoutPlacement = { ...value };
    delete (withoutPlacement as { placementQuery?: unknown }).placementQuery;
    expect(() => parseDirectPlannerResult(withoutPlacement)).toThrowError(
      /text\.create requires a spatial placement query/u,
    );
  });

  it("accepts only the text.create placement omission in planner draft mode", () => {
    const value = createExecutableResult();
    value.command = {
      capability: "text",
      operation: "create",
      target: { kind: "CURRENT_PAGE" },
      payload: { text: "가나다라" },
    };

    expect(parseDirectPlannerDraftResult(value)).toEqual(value);
    expect(() => parseDirectPlannerResult(value)).toThrowError(
      /text\.create requires a spatial placement query/u,
    );

    const forbidden = { ...value, placementQuery: { x: 100, y: 200 } };
    expect(() => parseDirectPlannerDraftResult(forbidden)).toThrowError(
      /placementQuery\.x: unexpected field/u,
    );
  });

  it("lifts only a nested text.create placementQuery in planner draft mode", () => {
    const placementQuery = {
      reference: { kind: "PAGE" },
      relation: "FREE_SPACE",
      regionHint: "TOP",
      alignment: "START",
      overlayIntent: "NONE",
    };
    const nested = {
      ...createExecutableResult(),
      command: {
        capability: "text",
        operation: "create",
        target: { kind: "CURRENT_PAGE" },
        payload: { text: "가나다라" },
        placementQuery,
      },
    };

    const parsed = parseDirectPlannerDraftResult(nested);
    expect(parsed).toMatchObject({
      command: {
        capability: "text",
        operation: "create",
        payload: { text: "가나다라" },
      },
      placementQuery,
    });
    if (parsed.status !== "EXECUTABLE") throw new Error("Expected executable draft.");
    expect(parsed.command).not.toHaveProperty("placementQuery");
    expect(() => parseDirectPlannerResult(nested)).toThrowError(
      /result\.command\.placementQuery: unexpected field/u,
    );
    expect(() => parseDirectPlannerDraftResult({
      ...nested,
      placementQuery,
    })).toThrowError(/placementQuery must appear exactly once/u);

    const forbiddenCommand = {
      ...createExecutableResult(),
      command: {
        ...createExecutableResult().command,
        placementQuery,
      },
    };
    expect(() => parseDirectPlannerDraftResult(forbiddenCommand)).toThrowError(
      /result\.command\.placementQuery: unexpected field/u,
    );
  });

  it("rejects coordinate fields mixed into an executable command", () => {
    const value = createExecutableResult();
    value.command.target = {
      kind: "relative",
      relation: "focused",
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
