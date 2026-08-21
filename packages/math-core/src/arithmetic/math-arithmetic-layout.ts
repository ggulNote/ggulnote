import type { Point, Rect } from "@ggulnote/shared-types";
import type { ArithmeticLayout } from "../domain/math-object";

export interface MathArithmeticGeometry {
  readonly fontSize: number;
  readonly carryFontSize: number;
  readonly cellWidth: number;
  readonly rowHeight: number;
  readonly rowBounds: Readonly<Record<string, Rect>>;
  readonly cellBounds: Readonly<Record<string, Rect>>;
  readonly carryBounds: Readonly<Record<string, Rect>>;
  readonly separatorBounds: Readonly<Record<string, Rect>>;
  readonly rowBaselines: Readonly<Record<string, number>>;
  readonly operatorPositions: Readonly<Record<string, Point>>;
  readonly cursorBounds?: Rect;
}

/** Deterministic right-aligned handwriting grid shared by layout and rendering. */
export const createMathArithmeticGeometry = (
  layout: ArithmeticLayout,
  bounds: Rect = layout.bounds,
): MathArithmeticGeometry => {
  const fontSize = layout.style.fontSize ?? 22;
  const carryFontSize = Math.max(8, fontSize * 0.62);
  const padding = Math.min(12, bounds.width * 0.08, bounds.height * 0.08);
  const operatorWidth = Math.max(10, fontSize * 0.8);
  const cursorRow = layout.cursor === undefined
    ? undefined
    : layout.rows.find((row) => row.id === layout.cursor!.rowId);
  const maxColumns = Math.max(1, ...[
    ...layout.rows.flatMap((row) => row.cells.map((cell) =>
      cell.column + row.offsetColumns + 1)),
    ...layout.carryMarks.map((carry) => carry.column + 1),
    ...(layout.cursor === undefined
      ? []
      : [layout.cursor.column + (cursorRow?.offsetColumns ?? 0) + 1]),
  ]);
  const availableWidth = Math.max(1, bounds.width - padding * 2 - operatorWidth);
  const cellWidth = Math.max(1, Math.min(fontSize * 0.78, availableWidth / maxColumns));
  const carryBand = Math.min(Math.max(10, carryFontSize * 1.25), bounds.height * 0.2);
  const availableHeight = Math.max(1, bounds.height - padding * 2 - carryBand);
  const rowHeight = Math.max(1, Math.min(fontSize * 1.35, availableHeight / Math.max(1, layout.rows.length)));
  const right = bounds.x + bounds.width - padding;
  const contentLeft = right - maxColumns * cellWidth;
  const rowBounds: Record<string, Rect> = {};
  const cellBounds: Record<string, Rect> = {};
  const carryBounds: Record<string, Rect> = {};
  const separatorBounds: Record<string, Rect> = {};
  const rowBaselines: Record<string, number> = {};
  const operatorPositions: Record<string, Point> = {};

  layout.rows.forEach((row, rowIndex) => {
    const y = bounds.y + padding + carryBand + rowIndex * rowHeight;
    rowBounds[row.id] = {
      x: contentLeft - operatorWidth,
      y,
      width: right - contentLeft + operatorWidth,
      height: rowHeight,
    };
    rowBaselines[row.id] = y + rowHeight * 0.72;
    if (row.operator !== undefined) {
      operatorPositions[row.id] = {
        x: contentLeft - operatorWidth * 0.45,
        y: rowBaselines[row.id]!,
      };
    }
    for (const cell of row.cells) {
      cellBounds[cell.id] = {
        x: right - (cell.column + row.offsetColumns + 1) * cellWidth,
        y,
        width: cellWidth,
        height: rowHeight,
      };
    }
  });

  for (const carry of layout.carryMarks) {
    const sourceBounds = carry.sourceRowId === undefined
      ? undefined
      : rowBounds[carry.sourceRowId];
    carryBounds[carry.id] = {
      x: right - (carry.column + 1) * cellWidth,
      y: sourceBounds === undefined
        ? bounds.y + padding
        : Math.max(bounds.y + padding, sourceBounds.y - carryBand),
      width: cellWidth,
      height: carryBand,
    };
  }

  for (const separator of layout.separators) {
    const afterRowBounds = rowBounds[separator.afterRowId];
    if (afterRowBounds === undefined) continue;
    separatorBounds[separator.id] = {
      x: contentLeft - operatorWidth * 0.75,
      y: afterRowBounds.y + afterRowBounds.height - 1,
      width: right - contentLeft + operatorWidth * 0.75,
      height: 1,
    };
  }

  const cursorBounds = createCursorBounds(layout, rowBounds, right, cellWidth);
  return {
    fontSize,
    carryFontSize,
    cellWidth,
    rowHeight,
    rowBounds,
    cellBounds,
    carryBounds,
    separatorBounds,
    rowBaselines,
    operatorPositions,
    ...(cursorBounds === undefined ? {} : { cursorBounds }),
  };
};

export const createMathArithmeticChildBounds = (
  layout: ArithmeticLayout,
): Readonly<Record<string, Rect>> => {
  const geometry = createMathArithmeticGeometry(layout);
  return {
    ...geometry.rowBounds,
    ...geometry.cellBounds,
    ...geometry.carryBounds,
    ...geometry.separatorBounds,
  };
};

function createCursorBounds(
  layout: ArithmeticLayout,
  rowBounds: Readonly<Record<string, Rect>>,
  right: number,
  cellWidth: number,
): Rect | undefined {
  if (layout.cursor === undefined) return undefined;
  const row = layout.rows.find((candidate) => candidate.id === layout.cursor!.rowId);
  const bounds = row === undefined ? undefined : rowBounds[row.id];
  if (row === undefined || bounds === undefined) return undefined;
  return {
    x: right - (layout.cursor.column + row.offsetColumns + 1) * cellWidth,
    y: bounds.y,
    width: cellWidth,
    height: bounds.height,
  };
}
