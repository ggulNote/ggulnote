import { describe, expect, it } from "vitest";
import {
  DirectPlannerResultValidationError,
  parseDirectPlannerResult,
  parseSpatialPlacementQuery,
  safeParseDirectPlannerResult,
} from "./direct-planner-schema";

function executablePlan(): Record<string, unknown> {
  return {
    status: "EXECUTABLE",
    planId: "plan-spatial-1",
    turnId: "turn-1",
    sceneRevision: 7,
    normalizedIntent: "현재 그림 아래에 배치",
    relation: "NEW",
    command: {
      capability: "annotation",
      operation: "highlight",
      target: { kind: "relative", relation: "focused" },
      payload: {},
    },
  };
}

function placementQuery(): Record<string, unknown> {
  return {
    reference: { kind: "PAGE" },
    relation: "FREE_SPACE",
    regionHint: "CURRENT_VIEW",
    alignment: "AUTO",
    distance: "NORMAL",
    overlayIntent: "NONE",
  };
}

describe("SpatialPlacementQuery runtime schema", () => {
  it("accepts a valid spatial placement query on the existing plan", () => {
    const value = executablePlan();
    value.placementQuery = placementQuery();

    expect(parseDirectPlannerResult(value)).toMatchObject({
      status: "EXECUTABLE",
      placementQuery: placementQuery(),
    });
  });

  it("uses an optional top-level TargetQuery only for a spatial subject", () => {
    const createPlan = executablePlan();
    createPlan.placementQuery = placementQuery();
    expect(parseDirectPlannerResult(createPlan)).not.toHaveProperty("targetQuery");

    const movePlan = executablePlan();
    movePlan.targetQuery = {
      kind: "object",
      objectType: "text",
      query: "설명 메모",
    };
    movePlan.placementQuery = {
      reference: {
        kind: "TARGET",
        query: { kind: "object", objectType: "image" },
      },
      relation: "RIGHT_OF",
    };

    expect(parseDirectPlannerResult(movePlan)).toMatchObject({
      targetQuery: movePlan.targetQuery,
      placementQuery: movePlan.placementQuery,
    });

    const invalidDirectPlan = executablePlan();
    invalidDirectPlan.targetQuery = movePlan.targetQuery;
    expect(() => parseDirectPlannerResult(invalidDirectPlan)).toThrowError(
      /spatial subject requires placementQuery/u,
    );
  });

  it("accepts a nested declarative TargetQuery reference", () => {
    const value = {
      reference: {
        kind: "TARGET",
        query: {
          kind: "subrange",
          parent: {
            kind: "object",
            objectType: "image",
            query: "Transformer architecture",
          },
          query: "왼쪽 블록",
        },
      },
      relation: "BELOW",
      alignment: "CENTER",
      distance: "NEAR",
    };

    expect(parseSpatialPlacementQuery(value)).toEqual(value);
  });

  it("rejects unknown relations and unknown fields", () => {
    expect(() => parseSpatialPlacementQuery({
      reference: { kind: "PAGE" },
      relation: "AROUND",
    })).toThrowError(/unsupported spatial relation/u);

    expect(() => parseSpatialPlacementQuery({
      ...placementQuery(),
      strategy: "CENTER_OF_MASS",
    })).toThrowError(/placementQuery\.strategy: unexpected field/u);
  });

  it.each([
    "x",
    "y",
    "left",
    "top",
    "right",
    "bottom",
    "width",
    "height",
    "bounds",
    "rect",
    "objectId",
    "candidateId",
    "tokenId",
    "pagePixel",
    "viewportPixel",
  ])("rejects forbidden planner field %s", (field) => {
    const value = placementQuery();
    value[field] = field.endsWith("Id") ? "invented" : 10;

    const plan = executablePlan();
    plan.placementQuery = value;
    const parsed = safeParseDirectPlannerResult(plan);

    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected forbidden field rejection.");
    expect(parsed.error).toBeInstanceOf(DirectPlannerResultValidationError);
    expect(parsed.error.path).toBe(`result.placementQuery.${field}`);
  });

  it("rejects objectId and coordinates inside a TARGET reference", () => {
    for (const field of ["objectId", "candidateId", "x", "width"]) {
      expect(() => parseSpatialPlacementQuery({
        reference: {
          kind: "TARGET",
          query: {
            kind: "object",
            objectType: "image",
            [field]: "invented",
          },
        },
        relation: "RIGHT_OF",
      })).toThrowError(new RegExp(`placementQuery\\.reference\\.query\\.${field}`));
    }
  });

  it("rejects prototype-bearing malformed objects", () => {
    const value = Object.create({
      reference: { kind: "PAGE" },
      relation: "FREE_SPACE",
    }) as object;

    expect(() => parseSpatialPlacementQuery(value)).toThrowError(
      /expected a plain object/u,
    );
  });

  it("keeps existing direct plans byte-for-byte compatible", () => {
    const value = executablePlan();
    expect(parseDirectPlannerResult(value)).toEqual(value);
  });
});
