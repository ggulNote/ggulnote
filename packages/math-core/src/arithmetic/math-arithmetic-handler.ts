import type {
  AddArithmeticRowInput,
  AdvanceArithmeticCursorInput,
  DrawArithmeticSeparatorInput,
  SetupArithmeticInput,
  WriteArithmeticCarryInput,
  WriteArithmeticDigitInput,
  WriteArithmeticPartialRowInput,
} from "../actions/math-action";
import type {
  ArithmeticCell,
  ArithmeticLayout,
  ArithmeticRow,
  ArithmeticType,
  MathObjectChild,
} from "../domain/math-object";
import {
  createBaseMathObject,
  nextSubEntityIds,
  validateMathObject,
} from "../handlers/math-handler-support";

export const setupVerticalArithmetic = (
  arithmeticType: Exclude<ArithmeticType, "divide">,
  input: SetupArithmeticInput,
  objectId: string,
): ArithmeticLayout => {
  if (input.operands.length < 2) {
    throw new RangeError("Vertical arithmetic requires at least two operands.");
  }
  if (input.operands.some((operand) => operand.length === 0)) {
    throw new RangeError("Vertical arithmetic operands must not be empty.");
  }
  const rowIds = nextSubEntityIds(objectId, "row", input.operands.length + 1);
  const operandRows = input.operands.map((operand, index): ArithmeticRow => {
    const rowId = rowIds[index]!;
    return {
      id: rowId,
      rowType: "operand",
      cells: cellsFromDisplayValues(rowId, Array.from(operand)),
      offsetColumns: 0,
      ...(index === input.operands.length - 1
        ? { operator: operatorFor(arithmeticType) }
        : {}),
    };
  });
  const workRow: ArithmeticRow = {
    id: rowIds[rowIds.length - 1]!,
    rowType: arithmeticType === "multiply" ? "partial" : "result",
    cells: [],
    offsetColumns: 0,
  };
  const rows = [...operandRows, workRow];
  const layout: ArithmeticLayout = {
    ...createBaseMathObject("arithmetic_layout", objectId, input),
    kind: "arithmetic_layout",
    arithmeticType,
    operands: [...input.operands],
    rows,
    carryMarks: [],
    separators: [],
    cursor: { rowId: workRow.id, column: 0 },
  };
  return validateArithmeticLayout({
    ...layout,
    children: arithmeticChildren(layout),
  });
};

export const writeArithmeticDigit = (
  layout: ArithmeticLayout,
  input: WriteArithmeticDigitInput,
): ArithmeticLayout => {
  assertTarget(layout, input.objectId);
  assertColumn(input.column);
  const target = requireRow(layout, input.rowId);
  const existing = target.cells.find((cell) => cell.column === input.column);
  const cell: ArithmeticCell = existing === undefined
    ? {
        id: nextSubEntityIds(layout.id, "cell", 1, entityIds(layout))[0]!,
        column: input.column,
        value: input.value,
      }
    : { ...existing, value: input.value };
  const rows = layout.rows.map((row) => row.id === target.id
    ? {
        ...row,
        cells: existing === undefined
          ? [...row.cells, cell].sort((left, right) => left.column - right.column)
          : row.cells.map((candidate) => candidate.id === cell.id ? cell : candidate),
      }
    : row);
  return nextLayout(layout, { rows });
};

export const writeArithmeticCarry = (
  layout: ArithmeticLayout,
  input: WriteArithmeticCarryInput,
): ArithmeticLayout => {
  assertTarget(layout, input.objectId);
  assertColumn(input.column);
  if (input.sourceRowId !== undefined) requireRow(layout, input.sourceRowId);
  const existing = layout.carryMarks.find((carry) =>
    carry.column === input.column && carry.sourceRowId === input.sourceRowId);
  const carry = existing === undefined
    ? {
        id: nextSubEntityIds(layout.id, "carry", 1, entityIds(layout))[0]!,
        column: input.column,
        value: input.value,
        ...(input.sourceRowId === undefined ? {} : { sourceRowId: input.sourceRowId }),
      }
    : { ...existing, value: input.value };
  const carryMarks = existing === undefined
    ? [...layout.carryMarks, carry]
    : layout.carryMarks.map((candidate) => candidate.id === carry.id ? carry : candidate);
  return nextLayout(layout, { carryMarks });
};

export const writeArithmeticPartialRow = (
  layout: ArithmeticLayout,
  input: WriteArithmeticPartialRowInput,
): ArithmeticLayout => {
  assertTarget(layout, input.objectId);
  const offsetColumns = input.offsetColumns ?? 0;
  assertColumn(offsetColumns, "offsetColumns");
  const target = resolvePartialRow(layout, input.rowId);
  const occupied = entityIds(layout);
  const rowId = target?.id ?? resolveNewRowId(layout, input.rowId);
  const cells = cellsFromDisplayValues(rowId, input.values, target?.cells, occupied);
  const row: ArithmeticRow = {
    id: rowId,
    rowType: "partial",
    cells,
    offsetColumns,
  };
  const rows = target === undefined
    ? [...layout.rows, row]
    : layout.rows.map((candidate) => candidate.id === target.id ? row : candidate);
  return nextLayout(layout, { rows });
};

export const drawArithmeticSeparator = (
  layout: ArithmeticLayout,
  input: DrawArithmeticSeparatorInput,
): ArithmeticLayout => {
  assertTarget(layout, input.objectId);
  requireRow(layout, input.afterRowId);
  const existing = layout.separators.find((separator) =>
    separator.afterRowId === input.afterRowId);
  const separator = existing === undefined
    ? {
        id: nextSubEntityIds(layout.id, "separator", 1, entityIds(layout))[0]!,
        afterRowId: input.afterRowId,
        lineStyle: input.lineStyle ?? "solid" as const,
      }
    : { ...existing, lineStyle: input.lineStyle ?? existing.lineStyle };
  const separators = existing === undefined
    ? [...layout.separators, separator]
    : layout.separators.map((candidate) =>
      candidate.id === separator.id ? separator : candidate);
  return nextLayout(layout, { separators });
};

export const advanceArithmeticCursor = (
  layout: ArithmeticLayout,
  input: AdvanceArithmeticCursorInput,
): ArithmeticLayout => {
  assertTarget(layout, input.objectId);
  const base = input.cursor ?? layout.cursor;
  if (base === undefined) throw new Error("Arithmetic cursor is not set.");
  const baseRow = requireRow(layout, base.rowId);
  assertColumn(base.column);
  const rowDelta = input.rowDelta ?? 0;
  const columnDelta = input.columnDelta ?? 0;
  if (!Number.isInteger(rowDelta) || !Number.isInteger(columnDelta)) {
    throw new RangeError("Cursor deltas must be integers.");
  }
  const baseRowIndex = layout.rows.findIndex((row) => row.id === baseRow.id);
  const nextRowIndex = baseRowIndex + rowDelta;
  if (nextRowIndex < 0 || nextRowIndex >= layout.rows.length) {
    throw new RangeError("Arithmetic cursor row is outside the layout.");
  }
  const column = base.column + columnDelta;
  assertColumn(column);
  return nextLayout(layout, {
    cursor: { rowId: layout.rows[nextRowIndex]!.id, column },
  });
};

export const addArithmeticRow = (
  layout: ArithmeticLayout,
  input: AddArithmeticRowInput,
): ArithmeticLayout => {
  assertTarget(layout, input.objectId);
  assertNewEntityId(layout, input.row.id);
  assertColumn(input.row.offsetColumns, "offsetColumns");
  const occupiedColumns = new Set<number>();
  const occupiedIds = entityIds(layout);
  occupiedIds.add(input.row.id);
  for (const cell of input.row.cells) {
    assertColumn(cell.column);
    if (occupiedColumns.has(cell.column)) {
      throw new TypeError(`Duplicate arithmetic cell column: ${cell.column}`);
    }
    occupiedColumns.add(cell.column);
    if (cell.id.length === 0 || occupiedIds.has(cell.id)) {
      throw new TypeError(`Duplicate or empty arithmetic cell id: ${cell.id}`);
    }
    occupiedIds.add(cell.id);
  }
  const row: ArithmeticRow = {
    ...input.row,
    cells: input.row.cells.map((cell) => ({ ...cell })),
  };
  const rows = [...layout.rows, row];
  return nextLayout(layout, { rows });
};

function nextLayout(
  layout: ArithmeticLayout,
  patch: Partial<Pick<ArithmeticLayout, "rows" | "carryMarks" | "separators" | "cursor">>,
): ArithmeticLayout {
  const next = { ...layout, ...patch };
  return validateArithmeticLayout({
    ...next,
    children: arithmeticChildren(next),
  });
}

function validateArithmeticLayout(layout: ArithmeticLayout): ArithmeticLayout {
  const rowIds = new Set<string>();
  const entityIdSet = new Set<string>();
  for (const row of layout.rows) {
    if (rowIds.has(row.id)) throw new TypeError(`Duplicate arithmetic row id: ${row.id}`);
    rowIds.add(row.id);
    assertUniqueEntityId(entityIdSet, row.id);
    const columns = new Set<number>();
    for (const cell of row.cells) {
      assertColumn(cell.column);
      if (columns.has(cell.column)) {
        throw new TypeError(`Duplicate arithmetic cell column: ${cell.column}`);
      }
      columns.add(cell.column);
      assertUniqueEntityId(entityIdSet, cell.id);
    }
  }
  for (const carry of layout.carryMarks) {
    assertUniqueEntityId(entityIdSet, carry.id);
    assertColumn(carry.column);
    if (carry.sourceRowId !== undefined && !rowIds.has(carry.sourceRowId)) {
      throw new Error(`Arithmetic carry source row does not exist: ${carry.sourceRowId}`);
    }
  }
  for (const separator of layout.separators) {
    assertUniqueEntityId(entityIdSet, separator.id);
    if (!rowIds.has(separator.afterRowId)) {
      throw new Error(`Arithmetic separator row does not exist: ${separator.afterRowId}`);
    }
  }
  if (layout.cursor !== undefined) {
    if (!rowIds.has(layout.cursor.rowId)) {
      throw new Error(`Arithmetic cursor row does not exist: ${layout.cursor.rowId}`);
    }
    assertColumn(layout.cursor.column);
  }
  return validateMathObject(layout);
}

function cellsFromDisplayValues(
  rowId: string,
  values: readonly string[],
  existing: readonly ArithmeticCell[] = [],
  occupiedIds: ReadonlySet<string> = new Set(),
): readonly ArithmeticCell[] {
  const existingByColumn = new Map(existing.map((cell) => [cell.column, cell]));
  const generatedIds = nextSubEntityIds(rowId, "cell", values.length, occupiedIds);
  let generatedIndex = 0;
  return values.map((value, displayIndex): ArithmeticCell => {
    const column = values.length - displayIndex - 1;
    const previous = existingByColumn.get(column);
    if (previous !== undefined) return { ...previous, value };
    const id = generatedIds[generatedIndex]!;
    generatedIndex += 1;
    return { id, column, value };
  }).sort((left, right) => left.column - right.column);
}

function resolvePartialRow(
  layout: ArithmeticLayout,
  requestedId: string | undefined,
): ArithmeticRow | undefined {
  if (requestedId !== undefined) {
    const existing = layout.rows.find((row) => row.id === requestedId);
    if (existing !== undefined && existing.rowType !== "partial") {
      throw new TypeError(`Arithmetic row is not a partial row: ${requestedId}`);
    }
    return existing;
  }
  return layout.rows.find((row) => row.rowType === "partial" && row.cells.length === 0);
}

function resolveNewRowId(layout: ArithmeticLayout, requestedId: string | undefined): string {
  if (requestedId !== undefined) {
    assertNewEntityId(layout, requestedId);
    return requestedId;
  }
  return nextSubEntityIds(layout.id, "row", 1, entityIds(layout))[0]!;
}

function arithmeticChildren(layout: ArithmeticLayout): readonly MathObjectChild[] {
  return [
    ...layout.rows.flatMap((row) => [
      { id: row.id, kind: "arithmetic_row" },
      ...row.cells.map((cell) => ({ id: cell.id, kind: "arithmetic_cell" })),
    ]),
    ...layout.carryMarks.map((carry) => ({ id: carry.id, kind: "arithmetic_carry" })),
    ...layout.separators.map((separator) => ({
      id: separator.id,
      kind: "arithmetic_separator",
    })),
  ];
}

function entityIds(layout: ArithmeticLayout): Set<string> {
  return new Set([
    ...layout.rows.flatMap((row) => [row.id, ...row.cells.map((cell) => cell.id)]),
    ...layout.carryMarks.map((carry) => carry.id),
    ...layout.separators.map((separator) => separator.id),
  ]);
}

function requireRow(layout: ArithmeticLayout, rowId: string): ArithmeticRow {
  const row = layout.rows.find((candidate) => candidate.id === rowId);
  if (row === undefined) throw new Error(`Arithmetic row does not exist: ${rowId}`);
  return row;
}

function assertTarget(layout: ArithmeticLayout, objectId: string): void {
  if (layout.id !== objectId) {
    throw new Error(`Arithmetic layout target does not exist: ${objectId}`);
  }
}

function assertColumn(value: number, name = "column"): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
}

function assertNewEntityId(layout: ArithmeticLayout, id: string): void {
  if (id.length === 0 || entityIds(layout).has(id)) {
    throw new TypeError(`Duplicate or empty arithmetic entity id: ${id}`);
  }
}

function assertUniqueEntityId(ids: Set<string>, id: string): void {
  if (id.length === 0 || ids.has(id)) {
    throw new TypeError(`Duplicate or empty arithmetic entity id: ${id}`);
  }
  ids.add(id);
}

function operatorFor(type: Exclude<ArithmeticType, "divide">): "+" | "−" | "×" {
  if (type === "add") return "+";
  if (type === "subtract") return "−";
  return "×";
}
