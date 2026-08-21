import type {
  AddMathTableColumnInput,
  AddMathTableRowInput,
  CreateMathTableInput,
  SetMathTableCellInput,
} from "../actions/math-action";
import type { MathObjectChild, MathTable, MathTableCell } from "../domain/math-object";
import {
  createBaseMathObject,
  nextSubEntityIds,
  validateMathObject,
} from "../handlers/math-handler-support";

export const createMathTable = (
  input: CreateMathTableInput,
  objectId: string,
): MathTable => {
  assertPositiveInteger(input.rows, "rows");
  assertPositiveInteger(input.columns, "columns");
  if ((input.initialValues?.length ?? 0) > input.rows) {
    throw new RangeError("initialValues has more rows than the table.");
  }
  const cellIds = nextSubEntityIds(objectId, "cell", input.rows * input.columns);
  const cells = Array.from({ length: input.rows }, (_, row) => {
    const initialRow = input.initialValues?.[row] ?? [];
    if (initialRow.length > input.columns) {
      throw new RangeError(`initialValues[${row}] has more columns than the table.`);
    }
    return Array.from({ length: input.columns }, (_, column): MathTableCell => ({
      id: cellIds[row * input.columns + column]!,
      row,
      column,
      value: initialRow[column] ?? "",
    }));
  });
  const table: MathTable = {
    ...createBaseMathObject("table", objectId, input, cellChildren(cells)),
    kind: "table",
    tableType: input.tableType ?? "general",
    rowCount: input.rows,
    columnCount: input.columns,
    cells,
    headerRows: normalizeHeaderIndices(input.headerRows ?? [], input.rows, "headerRows"),
    headerColumns: normalizeHeaderIndices(input.headerColumns ?? [], input.columns, "headerColumns"),
    defaultCellAlignment: "center",
  };
  return validateMathObject(table);
};

export const setMathTableCell = (
  table: MathTable,
  input: SetMathTableCellInput,
): MathTable => {
  assertTarget(table, input.objectId);
  assertCellIndex(input.row, table.rowCount, "row");
  assertCellIndex(input.column, table.columnCount, "column");
  const cells = table.cells.map((row, rowIndex) => row.map((cell, columnIndex) =>
    rowIndex === input.row && columnIndex === input.column
      ? {
          ...cell,
          value: input.value,
          ...(input.alignment === undefined ? {} : { alignment: input.alignment }),
        }
      : cell));
  return validateMathObject({ ...table, cells });
};

export const addMathTableRow = (
  table: MathTable,
  input: AddMathTableRowInput,
): MathTable => {
  assertTarget(table, input.objectId);
  const atIndex = input.atIndex ?? table.rowCount;
  assertInsertIndex(atIndex, table.rowCount, "row");
  const values = input.values ?? [];
  if (values.length > table.columnCount) {
    throw new RangeError("Row values exceed the table column count.");
  }
  const occupied = new Set(table.cells.flat().map((cell) => cell.id));
  const ids = nextSubEntityIds(table.id, "cell", table.columnCount, occupied);
  const inserted = Array.from({ length: table.columnCount }, (_, column): MathTableCell => ({
    id: ids[column]!,
    row: atIndex,
    column,
    value: values[column] ?? "",
  }));
  const rows = [...table.cells.slice(0, atIndex), inserted, ...table.cells.slice(atIndex)];
  const cells = reindexCells(rows);
  return validateMathObject({
    ...table,
    rowCount: table.rowCount + 1,
    cells,
    headerRows: table.headerRows.map((index) => index >= atIndex ? index + 1 : index),
    children: cellChildren(cells),
  });
};

export const addMathTableColumn = (
  table: MathTable,
  input: AddMathTableColumnInput,
): MathTable => {
  assertTarget(table, input.objectId);
  const atIndex = input.atIndex ?? table.columnCount;
  assertInsertIndex(atIndex, table.columnCount, "column");
  const values = input.values ?? [];
  if (values.length > table.rowCount) {
    throw new RangeError("Column values exceed the table row count.");
  }
  const occupied = new Set(table.cells.flat().map((cell) => cell.id));
  const ids = nextSubEntityIds(table.id, "cell", table.rowCount, occupied);
  const rows = table.cells.map((row, rowIndex) => [
    ...row.slice(0, atIndex),
    {
      id: ids[rowIndex]!,
      row: rowIndex,
      column: atIndex,
      value: values[rowIndex] ?? "",
    },
    ...row.slice(atIndex),
  ]);
  const cells = reindexCells(rows);
  return validateMathObject({
    ...table,
    columnCount: table.columnCount + 1,
    cells,
    headerColumns: table.headerColumns.map((index) => index >= atIndex ? index + 1 : index),
    children: cellChildren(cells),
  });
};

function reindexCells(rows: readonly (readonly MathTableCell[])[]): readonly (readonly MathTableCell[])[] {
  return rows.map((row, rowIndex) => row.map((cell, columnIndex) => ({
    ...cell,
    row: rowIndex,
    column: columnIndex,
  })));
}

function cellChildren(cells: readonly (readonly MathTableCell[])[]): readonly MathObjectChild[] {
  return cells.flat().map((cell) => ({ id: cell.id, kind: "table_cell" }));
}

function normalizeHeaderIndices(
  values: readonly number[],
  limit: number,
  name: string,
): readonly number[] {
  const unique = new Set<number>();
  for (const value of values) {
    assertCellIndex(value, limit, name);
    unique.add(value);
  }
  return [...unique].sort((left, right) => left - right);
}

function assertTarget(table: MathTable, objectId: string): void {
  if (table.id !== objectId) throw new Error(`Math table target does not exist: ${objectId}`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function assertCellIndex(value: number, limit: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= limit) {
    throw new RangeError(`${name} is outside the table.`);
  }
}

function assertInsertIndex(value: number, limit: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > limit) {
    throw new RangeError(`${name} insertion index is outside the table.`);
  }
}
