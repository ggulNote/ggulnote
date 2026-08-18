import { CONNECTED_MATH_ACTION_IDS } from "@ggulnote/math-core";
import { describe, expect, it } from "vitest";
import type { NoteToolContext } from "./note-tool-registry";
import { createMathTools } from "./math-tools";
import { createExistingNoteToolRegistry } from "./existing-tool-adapters";

describe("editor-connected math action tools", () => {
  it("registers exactly the five math-core smoke actions", () => {
    const registry = createExistingNoteToolRegistry();
    const context = { mode: "SHADOW" } as NoteToolContext;
    const mathIds = registry.compactSchemas(context)
      .map((tool) => tool.id)
      .filter((id) => id.startsWith("math."));

    expect(mathIds).toEqual(CONNECTED_MATH_ACTION_IDS);
    expect(mathIds).not.toContain("math.add");
    expect(mathIds).not.toContain("math.matrix_multiply");
  });

  it("uses math-core Decision schemas and validates the smoke inputs strictly", () => {
    const tools = createMathTools();
    const expression = tools.find((tool) => tool.id === "math.expression.create");
    const graph = tools.find((tool) => tool.id === "math.graph.create");
    const point = tools.find((tool) => tool.id === "math.graph.add_point");
    if (expression === undefined || graph === undefined || point === undefined) {
      throw new Error("Expected all connected math tools.");
    }

    expect(expression.inputSchema.parse({ source: "x² + 2x + 1" })).toMatchObject({
      args: { source: "x² + 2x + 1" },
    });
    expect(() => expression.inputSchema.parse({ source: "x", extra: true }))
      .toThrowError(/extra/u);
    expect(graph.inputSchema.parse({
      expression: "y=x²",
      functionType: "quadratic",
      parameters: [
        { name: "a", value: 1 },
        { name: "b", value: 0 },
        { name: "c", value: 0 },
      ],
    })).toMatchObject({ args: { expression: "y=x²", functionType: "quadratic" } });
    expect(point.inputSchema.parse({
      target: { object: "O1", part: null },
      xValue: null,
      yValue: null,
      label: null,
    })).toMatchObject({ target: { object: "O1", part: null } });
    expect(() => point.inputSchema.parse({ xValue: null, yValue: null, label: null }))
      .toThrowError(/target/u);
  });

  it("keeps unrelated graph/table extension contracts unavailable", () => {
    const registry = createExistingNoteToolRegistry();
    const context = { mode: "PRODUCTION" } as NoteToolContext;
    expect(registry.get("graph.add_tangent")?.isAvailable(context)).toBe(false);
    expect(registry.get("table.update_cell")?.isAvailable(context)).toBe(false);
  });
});
