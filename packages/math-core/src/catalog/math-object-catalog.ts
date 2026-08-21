import type { Rect } from "@ggulnote/shared-types";
import type {
  ArithmeticLayout,
  MathGraph,
  MathObject,
  MathObjectKind,
  MathShape,
  MathTable,
} from "../domain/math-object";
import { getMathExpressionDisplayText } from "../expression/math-expression-handler";

export type MathCatalogKind = "math" | "table" | "graph" | "shape";

export type MathCatalogCapability =
  | "anchorable"
  | "editable"
  | "movable"
  | "resizable"
  | "deletable"
  | "partAddressable"
  | "mathExpressionEditable"
  | "mathCellEditable"
  | "mathRowAddable"
  | "mathColumnAddable"
  | "mathPointAddable"
  | "tangentAddable"
  | "helperLineAddable"
  | "mathShapeLabelable"
  | "mathShapeMarkable"
  | "mathArithmeticWritable"
  | "carryWritable";

export interface MathCatalogPart {
  readonly kind: string;
  readonly summary?: string;
}

/** Structurally compatible with the Note Agent catalog without importing it. */
export interface MathCatalogEntry<THandle extends string = string> {
  readonly handle: THandle;
  readonly source: "tldraw";
  readonly kind: MathCatalogKind;
  readonly summary: string;
  /** Page-normalized bounds, matching the Note Agent catalog contract. */
  readonly bounds: Rect;
  readonly capabilities: readonly MathCatalogCapability[];
  readonly selected: boolean;
  readonly focused: boolean;
  readonly recent: boolean;
  readonly parts?: readonly MathCatalogPart[];
}

export interface MathCatalogProjectionOptions<THandle extends string> {
  readonly handle: THandle;
  readonly pageSize: {
    readonly width: number;
    readonly height: number;
  };
  readonly selected?: boolean;
  readonly focused?: boolean;
  readonly recent?: boolean;
}

/**
 * Projects one logical math object into a request-local catalog entry.
 * Handle allocation and selection/focus tracking stay outside math-core.
 */
export const projectMathObjectToCatalog = <THandle extends string>(
  object: MathObject,
  options: MathCatalogProjectionOptions<THandle>,
): MathCatalogEntry<THandle> => {
  if (options.handle.length === 0) throw new TypeError("Math catalog handle must not be empty.");
  assertPageSize(options.pageSize);
  const parts = catalogParts(object).slice(0, 12);
  return Object.freeze({
    handle: options.handle,
    source: "tldraw",
    kind: catalogKind(object.kind),
    summary: bound(catalogSummary(object), 160),
    bounds: Object.freeze({
      x: clampUnit(object.bounds.x / options.pageSize.width),
      y: clampUnit(object.bounds.y / options.pageSize.height),
      width: clampUnit(object.bounds.width / options.pageSize.width),
      height: clampUnit(object.bounds.height / options.pageSize.height),
    }),
    capabilities: Object.freeze([...catalogCapabilities(object.kind)].sort()),
    selected: options.selected ?? false,
    focused: options.focused ?? false,
    recent: options.recent ?? false,
    ...(parts.length === 0 ? {} : { parts: Object.freeze(parts) }),
  });
};

const BASE_CAPABILITIES = [
  "anchorable",
  "editable",
  "movable",
  "resizable",
  "deletable",
  "partAddressable",
] as const satisfies readonly MathCatalogCapability[];

function catalogKind(kind: MathObjectKind): MathCatalogKind {
  switch (kind) {
    case "expression":
    case "arithmetic_layout":
      return "math";
    case "table":
    case "graph":
    case "shape":
      return kind;
  }
}

function catalogCapabilities(kind: MathObjectKind): readonly MathCatalogCapability[] {
  switch (kind) {
    case "expression":
      return [...BASE_CAPABILITIES, "mathExpressionEditable"];
    case "table":
      return [
        ...BASE_CAPABILITIES,
        "mathCellEditable",
        "mathRowAddable",
        "mathColumnAddable",
      ];
    case "graph":
      return [
        ...BASE_CAPABILITIES,
        "mathPointAddable",
        "tangentAddable",
        "helperLineAddable",
      ];
    case "shape":
      return [...BASE_CAPABILITIES, "mathShapeLabelable", "mathShapeMarkable"];
    case "arithmetic_layout":
      return [
        ...BASE_CAPABILITIES,
        "mathArithmeticWritable",
        "carryWritable",
        "mathRowAddable",
      ];
  }
}

function catalogSummary(object: MathObject): string {
  if (object.label !== undefined && object.label.trim().length > 0) return object.label.trim();
  switch (object.kind) {
    case "expression":
      return getMathExpressionDisplayText(object);
    case "table":
      return `${object.rowCount}x${object.columnCount} ${tableTypeLabel(object)} table`;
    case "graph":
      return graphSummary(object);
    case "shape":
      return shapeSummary(object);
    case "arithmetic_layout":
      return arithmeticSummary(object);
  }
}

function tableTypeLabel(table: MathTable): string {
  if (table.tableType === "function_values") return "function-value";
  if (table.tableType === "xy_values") return "x-y value";
  return "general";
}

function graphSummary(graph: MathGraph): string {
  const expressions = graph.functions.map((fn) => fn.expression).join(", ");
  const extras = [
    graph.points.length === 0 ? undefined : `${graph.points.length} point(s)`,
    graph.tangents.length === 0 ? undefined : `${graph.tangents.length} tangent(s)`,
    graph.helperLines.length === 0 ? undefined : `${graph.helperLines.length} helper line(s)`,
  ].filter((value): value is string => value !== undefined);
  return `${expressions} graph${extras.length === 0 ? "" : ` with ${extras.join(", ")}`}`;
}

function shapeSummary(shape: MathShape): string {
  const type = shape.preset ?? shape.shapeType;
  const extras = [
    shape.labels.length === 0 ? undefined : `${shape.labels.length} label(s)`,
    shape.marks.length === 0 ? undefined : `${shape.marks.length} mark(s)`,
  ].filter((value): value is string => value !== undefined);
  return `${type} shape${extras.length === 0 ? "" : ` with ${extras.join(", ")}`}`;
}

function arithmeticSummary(layout: ArithmeticLayout): string {
  const operation = layout.arithmeticType === "add"
    ? { name: "addition", symbol: "+" }
    : layout.arithmeticType === "subtract"
      ? { name: "subtraction", symbol: "−" }
      : layout.arithmeticType === "multiply"
        ? { name: "multiplication", symbol: "×" }
        : { name: "division", symbol: "÷" };
  return `vertical ${operation.name}: ${layout.operands.join(` ${operation.symbol} `)}`;
}

function catalogParts(object: MathObject): readonly MathCatalogPart[] {
  switch (object.kind) {
    case "expression":
      return [{ kind: "expression", summary: bound(getMathExpressionDisplayText(object), 80) }];
    case "table":
      return object.cells.flat()
        .filter((cell) => cell.value.length > 0)
        .map((cell) => ({
          kind: "cell",
          summary: bound(`r${cell.row + 1}c${cell.column + 1}: ${cell.value}`, 80),
        }));
    case "graph":
      return [
        ...object.functions.map((fn) => ({ kind: "curve", summary: bound(fn.expression, 80) })),
        ...object.points.map((point) => ({
          kind: "point",
          summary: bound(`${point.label === undefined ? "point" : point.label}(${point.position.x}, ${point.position.y})`, 80),
        })),
        ...object.tangents.map((tangent) => ({
          kind: "tangent",
          summary: bound(tangent.label ?? `tangent at x=${tangent.atX}`, 80),
        })),
        ...object.helperLines.map((line) => ({
          kind: "helper_line",
          summary: bound(line.label ?? line.helperType, 80),
        })),
      ];
    case "shape":
      return [
        ...object.labels.map((label) => ({ kind: "label", summary: bound(label.text, 80) })),
        ...object.marks.map((mark) => ({
          kind: "mark",
          summary: bound(mark.value ?? mark.markType, 80),
        })),
      ];
    case "arithmetic_layout":
      return [
        ...object.rows.map((row) => ({
          kind: row.rowType,
          summary: bound(row.cells
            .slice()
            .sort((left, right) => right.column - left.column)
            .map((cell) => cell.value)
            .join(""), 80),
        })),
        ...object.carryMarks.map((carry) => ({ kind: "carry", summary: bound(carry.value, 80) })),
      ];
  }
}

function assertPageSize(pageSize: MathCatalogProjectionOptions<string>["pageSize"]): void {
  if (!Number.isFinite(pageSize.width) || pageSize.width <= 0
    || !Number.isFinite(pageSize.height) || pageSize.height <= 0) {
    throw new RangeError("Math catalog page size must contain positive finite dimensions.");
  }
}

function bound(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}
