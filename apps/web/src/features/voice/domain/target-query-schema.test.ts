import { describe, expect, it } from "vitest";
import { parseTargetQuery } from "./direct-planner-schema";

describe("TargetQuery runtime schema", () => {
  it.each([
    { kind: "relative", relation: "focused" },
    { kind: "relative", relation: "last_target" },
    {
      kind: "text_span",
      startAnchor: "세종대왕의",
      endAnchor: "업적",
    },
    {
      kind: "semantic_unit",
      unit: "sentence",
      query: "AI의 문제점을 설명",
    },
    {
      kind: "object",
      objectType: "graph",
      query: "x제곱 그래프",
      relation: "recent",
    },
    {
      kind: "subrange",
      parent: { kind: "object", objectType: "text", relation: "focused" },
      query: "2x",
    },
  ])("accepts $kind queries", (query) => {
    expect(parseTargetQuery(query)).toEqual(query);
  });

  it.each([
    { kind: "relative", relation: "focused", objectId: "scene-1" },
    { kind: "relative", relation: "focused", x: 10, y: 20 },
    { kind: "object", objectType: "graph", candidateId: "candidate-1" },
    { kind: "semantic_unit", unit: "sentence", query: "AI", width: 100 },
  ])("rejects planner authority fields", (query) => {
    expect(() => parseTargetQuery(query)).toThrowError(/unexpected field/u);
  });
});
