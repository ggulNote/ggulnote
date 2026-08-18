import { describe, expect, it } from "vitest";
import {
  BASE_MATH_LAYOUT_ENGINE,
  addArithmeticRow,
  advanceArithmeticCursor,
  createMathAction,
  createMathArithmeticGeometry,
  createMathVisualModel,
  drawArithmeticSeparator,
  executePhaseDMathAction,
  setupVerticalArithmetic,
  writeArithmeticCarry,
  writeArithmeticDigit,
  writeArithmeticPartialRow,
} from "../src";

const bounds = { x: 10, y: 20, width: 220, height: 220 };

describe("Phase D vertical arithmetic setup", () => {
  it("right-aligns operand characters and creates an empty writable multiplication row", () => {
    const layout = setupVerticalArithmetic("multiply", {
      bounds,
      operands: ["78", "34"],
    }, "multiply-1");

    expect(layout).toMatchObject({
      arithmeticType: "multiply",
      operands: ["78", "34"],
      rows: [
        { rowType: "operand", offsetColumns: 0 },
        { rowType: "operand", operator: "×", offsetColumns: 0 },
        { rowType: "partial", cells: [], offsetColumns: 0 },
      ],
    });
    expect(layout.rows[0]!.cells).toEqual([
      expect.objectContaining({ column: 0, value: "8" }),
      expect.objectContaining({ column: 1, value: "7" }),
    ]);
    expect(layout.cursor).toEqual({ rowId: layout.rows[2]!.id, column: 0 });
    expect(layout.children.map((child) => child.kind)).toEqual([
      "arithmetic_row",
      "arithmetic_cell",
      "arithmetic_cell",
      "arithmetic_row",
      "arithmetic_cell",
      "arithmetic_cell",
      "arithmetic_row",
    ]);
  });

  it("uses result work rows for addition and subtraction without calculating them", () => {
    const addition = setupVerticalArithmetic("add", { bounds, operands: ["1", "2", "3"] }, "add-1");
    const subtraction = setupVerticalArithmetic("subtract", { bounds, operands: ["10", "9"] }, "sub-1");
    expect(addition.rows.at(-2)).toMatchObject({ operator: "+" });
    expect(addition.rows.at(-1)).toMatchObject({ rowType: "result", cells: [] });
    expect(subtraction.rows.at(-2)).toMatchObject({ operator: "−" });
    expect(subtraction.rows.at(-1)).toMatchObject({ rowType: "result", cells: [] });
  });
});

describe("Phase D handwritten-work recording", () => {
  it("records user-provided digits and carries verbatim without answer validation", () => {
    const original = setupVerticalArithmetic("multiply", {
      bounds,
      operands: ["78", "34"],
    }, "record-1");
    const workRowId = original.rows[2]!.id;
    const withDigit = writeArithmeticDigit(original, {
      objectId: original.id,
      rowId: workRowId,
      column: 0,
      value: "9",
    });
    const withWrongText = writeArithmeticDigit(withDigit, {
      objectId: original.id,
      rowId: workRowId,
      column: 1,
      value: "WRONG",
    });
    const withCarry = writeArithmeticCarry(withWrongText, {
      objectId: original.id,
      column: 1,
      value: "3",
      sourceRowId: original.rows[0]!.id,
    });
    const moved = advanceArithmeticCursor(withCarry, {
      objectId: original.id,
      columnDelta: 1,
    });

    expect(moved.rows[2]!.cells).toEqual([
      expect.objectContaining({ column: 0, value: "9" }),
      expect.objectContaining({ column: 1, value: "WRONG" }),
    ]);
    expect(moved.carryMarks[0]).toMatchObject({ column: 1, value: "3" });
    expect(moved.cursor).toEqual({ rowId: workRowId, column: 1 });
  });

  it("writes left-to-right partial rows with explicit column offsets", () => {
    const original = setupVerticalArithmetic("multiply", {
      bounds,
      operands: ["78", "34"],
    }, "partial-1");
    const first = writeArithmeticPartialRow(original, {
      objectId: original.id,
      values: ["3", "1", "2"],
    });
    const second = writeArithmeticPartialRow(first, {
      objectId: original.id,
      values: ["2", "3", "4"],
      offsetColumns: 1,
    });

    expect(second.rows[2]!.cells).toEqual([
      expect.objectContaining({ column: 0, value: "2" }),
      expect.objectContaining({ column: 1, value: "1" }),
      expect.objectContaining({ column: 2, value: "3" }),
    ]);
    expect(second.rows[3]).toMatchObject({
      rowType: "partial",
      offsetColumns: 1,
      cells: [
        { column: 0, value: "4" },
        { column: 1, value: "3" },
        { column: 2, value: "2" },
      ],
    });
    expect(new Set(second.children.map((child) => child.id)).size).toBe(second.children.length);
  });

  it("adds user-defined result rows and separators without deriving a result", () => {
    const original = setupVerticalArithmetic("add", {
      bounds,
      operands: ["78", "34"],
    }, "rows-1");
    const operandRowId = original.rows[1]!.id;
    const separated = drawArithmeticSeparator(original, {
      objectId: original.id,
      afterRowId: operandRowId,
      lineStyle: "dashed",
    });
    const completed = addArithmeticRow(separated, {
      objectId: original.id,
      row: {
        id: "user-result",
        rowType: "result",
        cells: [{ id: "user-result-cell", column: 0, value: "999" }],
        offsetColumns: 0,
      },
    });
    expect(completed.separators[0]).toMatchObject({
      afterRowId: operandRowId,
      lineStyle: "dashed",
    });
    expect(completed.rows.at(-1)!.cells[0]!.value).toBe("999");
  });
});

describe("Phase D arithmetic geometry and action boundary", () => {
  it("shares deterministic right-aligned child geometry with the visual model", () => {
    const original = setupVerticalArithmetic("multiply", {
      bounds,
      style: { fontSize: 20 },
      operands: ["78", "34"],
    }, "geometry-1");
    const withPartial = writeArithmeticPartialRow(original, {
      objectId: original.id,
      values: ["3", "1", "2"],
    });
    const withCarry = writeArithmeticCarry(withPartial, {
      objectId: original.id,
      column: 1,
      value: "3",
    });
    const complete = drawArithmeticSeparator(withCarry, {
      objectId: original.id,
      afterRowId: original.rows[1]!.id,
      lineStyle: "dashed",
    });
    const geometry = createMathArithmeticGeometry(complete);
    const operandCells = complete.rows[0]!.cells;
    expect(geometry.cellBounds[operandCells[0]!.id]!.x)
      .toBeGreaterThan(geometry.cellBounds[operandCells[1]!.id]!.x);
    expect(Object.keys(BASE_MATH_LAYOUT_ENGINE.layout(complete).childBounds))
      .toHaveLength(complete.children.length);

    const visual = createMathVisualModel(complete);
    expect(visual.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", text: "×" }),
      expect.objectContaining({ kind: "text", text: "3" }),
      expect.objectContaining({ kind: "line", dash: "7 5" }),
      expect.objectContaining({ kind: "rect", id: `${complete.id}:cursor` }),
    ]));
  });

  it("dispatches setup and mutation actions as one logical render object", () => {
    const created = executePhaseDMathAction(createMathAction(
      "math.arithmetic.setup_vertical_multiply",
      { bounds, operands: ["78", "34"] },
    ), { createObjectId: () => "dispatch-arithmetic" });
    expect(created.object).toMatchObject({
      id: "dispatch-arithmetic",
      kind: "arithmetic_layout",
      arithmeticType: "multiply",
    });
    if (created.object.kind !== "arithmetic_layout") throw new Error("Expected arithmetic layout.");
    const updated = executePhaseDMathAction(createMathAction("math.arithmetic.write_digit", {
      objectId: created.object.id,
      rowId: created.object.rows[2]!.id,
      column: 0,
      value: "2",
    }), { currentObject: created.object });
    expect(updated.object).toMatchObject({ rows: [
      {},
      {},
      { cells: [{ column: 0, value: "2" }] },
    ] });
    expect(updated.renderOperation).toMatchObject({
      kind: "UPSERT_MATH_OBJECT",
      plan: { logicalObjectId: "dispatch-arithmetic", objectKind: "arithmetic_layout" },
    });
  });
});
