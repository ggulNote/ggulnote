import { describe, expect, it } from "vitest";
import type { NoteToolContext } from "./note-tool-registry";
import {
  addFiniteNumbers,
  createMathTools,
  multiplyNumericMatrices,
} from "./math-tools";
import { createExistingNoteToolRegistry } from "./existing-tool-adapters";

describe("registry-based math compute tools", () => {
  it("adds finite numbers deterministically", () => {
    expect(addFiniteNumbers([1, 2, 3.5])).toBe(6.5);
    expect(() => addFiniteNumbers([1, Number.NaN])).toThrow(RangeError);
  });

  it("multiplies rectangular matrices and rejects incompatible dimensions", () => {
    expect(multiplyNumericMatrices(
      [[1, 2, 3], [4, 5, 6]],
      [[7, 8], [9, 10], [11, 12]],
    )).toEqual({ value: [[58, 64], [139, 154]], rows: 2, columns: 2 });
    expect(() => multiplyNumericMatrices([[1, 2]], [[1, 2]]))
      .toThrowError("INCOMPATIBLE_MATRIX_DIMENSIONS");
  });

  it("strictly validates tool input and exposes compute schemas by registry only", async () => {
    const registry = createExistingNoteToolRegistry();
    const context = { mode: "SHADOW" } as NoteToolContext;
    expect(registry.compactSchemas(context).map((tool) => tool.id)).toEqual(
      expect.arrayContaining(["math.add", "math.matrix_multiply"]),
    );
    const tools = createMathTools();
    const matrix = tools.find((tool) => tool.id === "math.matrix_multiply");
    if (matrix === undefined) throw new Error("Expected matrix tool.");
    expect(() => matrix.inputSchema.parse({
      left: [[1, 2], [3]],
      right: [[1], [2]],
    })).toThrowError(/rectangular/u);
    const parsed = matrix.inputSchema.parse({ left: [[1, 2]], right: [[1, 2]] });
    await expect(matrix.execute(parsed, context)).resolves.toEqual({
      status: "FAILED",
      reasonCode: "INCOMPATIBLE_MATRIX_DIMENSIONS",
    });
  });

  it("keeps graph/table contracts unavailable until stable editor adapters exist", () => {
    const registry = createExistingNoteToolRegistry();
    const context = { mode: "PRODUCTION" } as NoteToolContext;
    expect(registry.get("graph.add_tangent")?.isAvailable(context)).toBe(false);
    expect(registry.get("table.update_cell")?.isAvailable(context)).toBe(false);
    expect(registry.compactSchemas(context).map((tool) => tool.id))
      .not.toEqual(expect.arrayContaining(["graph.add_tangent", "table.update_cell"]));
  });
});
