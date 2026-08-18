import type {
  MathExpressionNode,
  MathObject,
} from "../domain/math-object";

export const MATH_OBJECT_SERIALIZATION_VERSION = 1 as const;

export interface SerializedMathObject {
  readonly schemaVersion: typeof MATH_OBJECT_SERIALIZATION_VERSION;
  readonly object: MathObject;
}

export const serializeMathObject = (object: MathObject): SerializedMathObject => {
  assertMathObject(object, "object");
  return {
    schemaVersion: MATH_OBJECT_SERIALIZATION_VERSION,
    object: cloneJson(object),
  };
};

export const deserializeMathObject = (value: unknown): MathObject => {
  const envelope = assertRecord(value, "serialized math object");
  if (envelope.schemaVersion !== MATH_OBJECT_SERIALIZATION_VERSION) {
    throw new TypeError("Unsupported math object schemaVersion.");
  }
  assertMathObject(envelope.object, "serialized math object.object");
  return cloneJson(envelope.object);
};

export const stringifyMathObject = (object: MathObject): string =>
  JSON.stringify(serializeMathObject(object));

export const parseMathObject = (value: string): MathObject => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new TypeError("Math object JSON is invalid.");
  }
  return deserializeMathObject(parsed);
};

export const isSerializedMathObject = (value: unknown): value is SerializedMathObject => {
  try {
    deserializeMathObject(value);
    return true;
  } catch {
    return false;
  }
};

function assertMathObject(value: unknown, path: string): asserts value is MathObject {
  const object = assertRecord(value, path);
  assertNonEmptyString(object.id, `${path}.id`);
  assertRect(object.bounds, `${path}.bounds`);
  assertStyle(object.style, `${path}.style`);
  assertOptionalString(object.label, `${path}.label`);
  assertJsonValue(object.metadata, `${path}.metadata`);
  const children = assertArray(object.children, `${path}.children`);
  children.forEach((child, index) => {
    const record = assertRecord(child, `${path}.children[${index}]`);
    assertNonEmptyString(record.id, `${path}.children[${index}].id`);
    assertNonEmptyString(record.kind, `${path}.children[${index}].kind`);
  });

  switch (object.kind) {
    case "expression":
      assertExpression(object, path);
      return;
    case "table":
      assertTable(object, path);
      return;
    case "graph":
      assertGraph(object, path);
      return;
    case "shape":
      assertShape(object, path);
      return;
    case "arithmetic_layout":
      assertArithmeticLayout(object, path);
      return;
    default:
      throw new TypeError(`${path}.kind is not a supported math object kind.`);
  }
}

function assertExpression(
  object: Record<string, unknown>,
  path: string,
): void {
  const content = assertRecord(object.content, `${path}.content`);
  assertString(content.source, `${path}.content.source`);
  assertUnion(content.format, `${path}.content.format`, ["plain", "latex", "structured"]);
  if (content.root !== undefined) {
    assertExpressionNode(content.root, `${path}.content.root`, 0);
  }
  assertUnion(object.displayMode, `${path}.displayMode`, ["inline", "block", "equation_stack"]);
  assertUnion(object.alignment, `${path}.alignment`, ["left", "center", "right"]);
  assertBoolean(object.editable, `${path}.editable`);
}

function assertExpressionNode(
  value: unknown,
  path: string,
  depth: number,
): asserts value is MathExpressionNode {
  if (depth > 100) {
    throw new TypeError(`${path} exceeds the supported expression nesting depth.`);
  }
  const node = assertRecord(value, path);
  switch (node.type) {
    case "text":
      assertString(node.value, `${path}.value`);
      return;
    case "sequence":
      assertArray(node.items, `${path}.items`).forEach((item, index) =>
        assertExpressionNode(item, `${path}.items[${index}]`, depth + 1));
      return;
    case "fraction":
      assertExpressionNode(node.numerator, `${path}.numerator`, depth + 1);
      assertExpressionNode(node.denominator, `${path}.denominator`, depth + 1);
      return;
    case "power":
      assertExpressionNode(node.base, `${path}.base`, depth + 1);
      assertExpressionNode(node.exponent, `${path}.exponent`, depth + 1);
      return;
    case "subscript":
      assertExpressionNode(node.base, `${path}.base`, depth + 1);
      assertExpressionNode(node.subscript, `${path}.subscript`, depth + 1);
      return;
    case "root":
      assertExpressionNode(node.radicand, `${path}.radicand`, depth + 1);
      if (node.index !== undefined) {
        assertExpressionNode(node.index, `${path}.index`, depth + 1);
      }
      return;
    case "group":
      assertUnion(node.opening, `${path}.opening`, ["(", "[", "{"]);
      assertUnion(node.closing, `${path}.closing`, [")", "]", "}"]);
      assertExpressionNode(node.content, `${path}.content`, depth + 1);
      return;
    case "equation":
      assertExpressionNode(node.left, `${path}.left`, depth + 1);
      assertExpressionNode(node.right, `${path}.right`, depth + 1);
      assertUnion(node.operator, `${path}.operator`, ["=", "<", ">", "≤", "≥", "≠"]);
      return;
    case "system":
      assertArray(node.equations, `${path}.equations`).forEach((equation, index) =>
        assertExpressionNode(equation, `${path}.equations[${index}]`, depth + 1));
      return;
    default:
      throw new TypeError(`${path}.type is not a supported expression node.`);
  }
}

function assertTable(
  object: Record<string, unknown>,
  path: string,
): void {
  assertUnion(object.tableType, `${path}.tableType`, ["general", "function_values", "xy_values"]);
  const rowCount = assertPositiveInteger(object.rowCount, `${path}.rowCount`);
  const columnCount = assertPositiveInteger(object.columnCount, `${path}.columnCount`);
  const rows = assertArray(object.cells, `${path}.cells`);
  if (rows.length !== rowCount) {
    throw new TypeError(`${path}.cells must match rowCount.`);
  }
  rows.forEach((row, rowIndex) => {
    const cells = assertArray(row, `${path}.cells[${rowIndex}]`);
    if (cells.length !== columnCount) {
      throw new TypeError(`${path}.cells[${rowIndex}] must match columnCount.`);
    }
    cells.forEach((cell, columnIndex) => {
      const record = assertRecord(cell, `${path}.cells[${rowIndex}][${columnIndex}]`);
      assertNonEmptyString(record.id, `${path}.cells[${rowIndex}][${columnIndex}].id`);
      if (record.row !== rowIndex || record.column !== columnIndex) {
        throw new TypeError(`${path}.cells coordinates must match their matrix position.`);
      }
      assertString(record.value, `${path}.cells[${rowIndex}][${columnIndex}].value`);
      assertOptionalUnion(record.alignment, `${path}.cells[${rowIndex}][${columnIndex}].alignment`, [
        "left",
        "center",
        "right",
      ]);
    });
  });
  assertIndexArray(object.headerRows, rowCount, `${path}.headerRows`);
  assertIndexArray(object.headerColumns, columnCount, `${path}.headerColumns`);
  assertUnion(object.defaultCellAlignment, `${path}.defaultCellAlignment`, ["left", "center", "right"]);
}

function assertGraph(
  object: Record<string, unknown>,
  path: string,
): void {
  const coordinateSystem = assertRecord(object.coordinateSystem, `${path}.coordinateSystem`);
  const xMin = assertFiniteNumber(coordinateSystem.xMin, `${path}.coordinateSystem.xMin`);
  const xMax = assertFiniteNumber(coordinateSystem.xMax, `${path}.coordinateSystem.xMax`);
  const yMin = assertFiniteNumber(coordinateSystem.yMin, `${path}.coordinateSystem.yMin`);
  const yMax = assertFiniteNumber(coordinateSystem.yMax, `${path}.coordinateSystem.yMax`);
  if (xMin >= xMax || yMin >= yMax) {
    throw new TypeError(`${path}.coordinateSystem ranges must be increasing.`);
  }
  if (assertFiniteNumber(coordinateSystem.xStep, `${path}.coordinateSystem.xStep`) <= 0
    || assertFiniteNumber(coordinateSystem.yStep, `${path}.coordinateSystem.yStep`) <= 0) {
    throw new TypeError(`${path}.coordinateSystem steps must be positive.`);
  }
  assertBoolean(coordinateSystem.showAxes, `${path}.coordinateSystem.showAxes`);
  assertBoolean(coordinateSystem.showGrid, `${path}.coordinateSystem.showGrid`);
  assertOptionalString(coordinateSystem.xLabel, `${path}.coordinateSystem.xLabel`);
  assertOptionalString(coordinateSystem.yLabel, `${path}.coordinateSystem.yLabel`);

  assertArray(object.functions, `${path}.functions`).forEach((entry, index) => {
    const fn = assertRecord(entry, `${path}.functions[${index}]`);
    assertNonEmptyString(fn.id, `${path}.functions[${index}].id`);
    assertUnion(fn.functionType, `${path}.functions[${index}].functionType`, [
      "linear", "quadratic", "cubic", "quartic", "absolute", "rational", "radical",
      "exponential", "logarithmic", "sin", "cos", "tan", "circle", "ellipse",
      "hyperbola", "custom",
    ]);
    assertString(fn.expression, `${path}.functions[${index}].expression`);
    const parameters = assertRecord(fn.parameters, `${path}.functions[${index}].parameters`);
    Object.entries(parameters).forEach(([key, parameter]) =>
      assertFiniteNumber(parameter, `${path}.functions[${index}].parameters.${key}`));
    if (fn.domain !== undefined) {
      assertInterval(fn.domain, `${path}.functions[${index}].domain`);
    }
    if (fn.style !== undefined) assertStyle(fn.style, `${path}.functions[${index}].style`);
    assertOptionalString(fn.label, `${path}.functions[${index}].label`);
  });

  assertArray(object.points, `${path}.points`).forEach((entry, index) => {
    const point = assertRecord(entry, `${path}.points[${index}]`);
    assertNonEmptyString(point.id, `${path}.points[${index}].id`);
    assertPoint(point.position, `${path}.points[${index}].position`);
    assertOptionalString(point.label, `${path}.points[${index}].label`);
    assertUnion(point.role, `${path}.points[${index}].role`, ["user", "intersection", "extremum", "reference"]);
    assertStringArray(point.functionIds, `${path}.points[${index}].functionIds`);
  });

  assertArray(object.tangents, `${path}.tangents`).forEach((entry, index) => {
    const tangent = assertRecord(entry, `${path}.tangents[${index}]`);
    assertNonEmptyString(tangent.id, `${path}.tangents[${index}].id`);
    assertNonEmptyString(tangent.functionId, `${path}.tangents[${index}].functionId`);
    assertFiniteNumber(tangent.atX, `${path}.tangents[${index}].atX`);
    assertPoint(tangent.point, `${path}.tangents[${index}].point`);
    assertFiniteNumber(tangent.slope, `${path}.tangents[${index}].slope`);
    assertOptionalString(tangent.label, `${path}.tangents[${index}].label`);
  });

  assertArray(object.helperLines, `${path}.helperLines`).forEach((entry, index) => {
    const line = assertRecord(entry, `${path}.helperLines[${index}]`);
    assertNonEmptyString(line.id, `${path}.helperLines[${index}].id`);
    assertUnion(line.helperType, `${path}.helperLines[${index}].helperType`, ["vertical", "horizontal", "axis_guides", "segment"]);
    assertPoint(line.start, `${path}.helperLines[${index}].start`);
    assertPoint(line.end, `${path}.helperLines[${index}].end`);
    assertUnion(line.lineStyle, `${path}.helperLines[${index}].lineStyle`, ["solid", "dashed", "dotted"]);
    assertOptionalString(line.label, `${path}.helperLines[${index}].label`);
  });

  assertArray(object.labels, `${path}.labels`).forEach((entry, index) => {
    const label = assertRecord(entry, `${path}.labels[${index}]`);
    assertNonEmptyString(label.id, `${path}.labels[${index}].id`);
    assertString(label.text, `${path}.labels[${index}].text`);
    assertPoint(label.position, `${path}.labels[${index}].position`);
    assertOptionalString(label.targetId, `${path}.labels[${index}].targetId`);
  });
}

function assertShape(
  object: Record<string, unknown>,
  path: string,
): void {
  assertUnion(object.shapeType, `${path}.shapeType`, [
    "point", "segment", "line", "ray", "angle", "triangle", "quadrilateral", "rectangle",
    "square", "parallelogram", "rhombus", "trapezoid", "circle", "sector", "arc", "polygon",
  ]);
  assertOptionalUnion(object.preset, `${path}.preset`, [
    "equilateral", "isosceles", "right_triangle", "rectangle", "square", "parallelogram",
    "rhombus", "trapezoid",
  ]);
  const geometry = assertRecord(object.geometry, `${path}.geometry`);
  switch (geometry.kind) {
    case "point":
      assertPoint(geometry.point, `${path}.geometry.point`);
      break;
    case "linear":
      assertPoint(geometry.start, `${path}.geometry.start`);
      assertPoint(geometry.end, `${path}.geometry.end`);
      break;
    case "angle":
      assertPoint(geometry.vertex, `${path}.geometry.vertex`);
      assertPoint(geometry.firstRayPoint, `${path}.geometry.firstRayPoint`);
      assertPoint(geometry.secondRayPoint, `${path}.geometry.secondRayPoint`);
      break;
    case "polygon":
      assertArray(geometry.vertices, `${path}.geometry.vertices`).forEach((point, index) =>
        assertPoint(point, `${path}.geometry.vertices[${index}]`));
      break;
    case "circle":
      assertPoint(geometry.center, `${path}.geometry.center`);
      assertPositiveNumber(geometry.radius, `${path}.geometry.radius`);
      break;
    case "arc":
      assertPoint(geometry.center, `${path}.geometry.center`);
      assertPositiveNumber(geometry.radius, `${path}.geometry.radius`);
      assertFiniteNumber(geometry.startAngleDegrees, `${path}.geometry.startAngleDegrees`);
      assertFiniteNumber(geometry.endAngleDegrees, `${path}.geometry.endAngleDegrees`);
      break;
    default:
      throw new TypeError(`${path}.geometry.kind is not supported.`);
  }
  assertArray(object.labels, `${path}.labels`).forEach((entry, index) => {
    const label = assertRecord(entry, `${path}.labels[${index}]`);
    assertNonEmptyString(label.id, `${path}.labels[${index}].id`);
    assertString(label.text, `${path}.labels[${index}].text`);
    assertUnion(label.target, `${path}.labels[${index}].target`, ["vertex", "edge", "angle", "center", "shape"]);
    assertOptionalNonNegativeInteger(label.targetIndex, `${path}.labels[${index}].targetIndex`);
    if (label.position !== undefined) assertPoint(label.position, `${path}.labels[${index}].position`);
  });
  assertArray(object.marks, `${path}.marks`).forEach((entry, index) => {
    const mark = assertRecord(entry, `${path}.marks[${index}]`);
    assertNonEmptyString(mark.id, `${path}.marks[${index}].id`);
    assertUnion(mark.markType, `${path}.marks[${index}].markType`, ["length", "angle", "parallel", "perpendicular"]);
    assertIndexList(mark.targetIndices, `${path}.marks[${index}].targetIndices`);
    assertOptionalString(mark.value, `${path}.marks[${index}].value`);
  });
}

function assertArithmeticLayout(
  object: Record<string, unknown>,
  path: string,
): void {
  assertUnion(object.arithmeticType, `${path}.arithmeticType`, ["add", "subtract", "multiply", "divide"]);
  assertStringArray(object.operands, `${path}.operands`);
  assertArray(object.rows, `${path}.rows`).forEach((entry, index) => {
    const row = assertRecord(entry, `${path}.rows[${index}]`);
    assertNonEmptyString(row.id, `${path}.rows[${index}].id`);
    assertUnion(row.rowType, `${path}.rows[${index}].rowType`, ["operand", "partial", "result", "note"]);
    assertNonNegativeInteger(row.offsetColumns, `${path}.rows[${index}].offsetColumns`);
    assertOptionalUnion(row.operator, `${path}.rows[${index}].operator`, ["+", "−", "×", "÷"]);
    assertArray(row.cells, `${path}.rows[${index}].cells`).forEach((entryCell, cellIndex) => {
      const cell = assertRecord(entryCell, `${path}.rows[${index}].cells[${cellIndex}]`);
      assertNonEmptyString(cell.id, `${path}.rows[${index}].cells[${cellIndex}].id`);
      assertNonNegativeInteger(cell.column, `${path}.rows[${index}].cells[${cellIndex}].column`);
      assertString(cell.value, `${path}.rows[${index}].cells[${cellIndex}].value`);
    });
  });
  assertArray(object.carryMarks, `${path}.carryMarks`).forEach((entry, index) => {
    const carry = assertRecord(entry, `${path}.carryMarks[${index}]`);
    assertNonEmptyString(carry.id, `${path}.carryMarks[${index}].id`);
    assertNonNegativeInteger(carry.column, `${path}.carryMarks[${index}].column`);
    assertString(carry.value, `${path}.carryMarks[${index}].value`);
    assertOptionalString(carry.sourceRowId, `${path}.carryMarks[${index}].sourceRowId`);
  });
  assertArray(object.separators, `${path}.separators`).forEach((entry, index) => {
    const separator = assertRecord(entry, `${path}.separators[${index}]`);
    assertNonEmptyString(separator.id, `${path}.separators[${index}].id`);
    assertNonEmptyString(separator.afterRowId, `${path}.separators[${index}].afterRowId`);
    assertUnion(separator.lineStyle, `${path}.separators[${index}].lineStyle`, ["solid", "dashed"]);
  });
  if (object.cursor !== undefined) {
    const cursor = assertRecord(object.cursor, `${path}.cursor`);
    assertNonEmptyString(cursor.rowId, `${path}.cursor.rowId`);
    assertNonNegativeInteger(cursor.column, `${path}.cursor.column`);
  }
}

function assertRect(value: unknown, path: string): void {
  const rect = assertRecord(value, path);
  assertFiniteNumber(rect.x, `${path}.x`);
  assertFiniteNumber(rect.y, `${path}.y`);
  assertNonNegativeNumber(rect.width, `${path}.width`);
  assertNonNegativeNumber(rect.height, `${path}.height`);
}

function assertPoint(value: unknown, path: string): void {
  const point = assertRecord(value, path);
  assertFiniteNumber(point.x, `${path}.x`);
  assertFiniteNumber(point.y, `${path}.y`);
}

function assertStyle(value: unknown, path: string): void {
  const style = assertRecord(value, path);
  assertOptionalString(style.color, `${path}.color`);
  assertOptionalString(style.backgroundColor, `${path}.backgroundColor`);
  assertOptionalString(style.strokeColor, `${path}.strokeColor`);
  if (style.strokeWidth !== undefined) assertNonNegativeNumber(style.strokeWidth, `${path}.strokeWidth`);
  if (style.opacity !== undefined) {
    const opacity = assertFiniteNumber(style.opacity, `${path}.opacity`);
    if (opacity < 0 || opacity > 1) throw new TypeError(`${path}.opacity must be between 0 and 1.`);
  }
  assertOptionalString(style.fontFamily, `${path}.fontFamily`);
  if (style.fontSize !== undefined) assertPositiveNumber(style.fontSize, `${path}.fontSize`);
  assertOptionalUnion(style.lineStyle, `${path}.lineStyle`, ["solid", "dashed", "dotted"]);
  if (style.handDrawn !== undefined) assertBoolean(style.handDrawn, `${path}.handDrawn`);
}

function assertInterval(value: unknown, path: string): void {
  const interval = assertRecord(value, path);
  const min = assertFiniteNumber(interval.min, `${path}.min`);
  const max = assertFiniteNumber(interval.max, `${path}.max`);
  if (min > max) throw new TypeError(`${path} must have min <= max.`);
  assertBoolean(interval.includeMin, `${path}.includeMin`);
  assertBoolean(interval.includeMax, `${path}.includeMax`);
}

function assertIndexArray(value: unknown, limit: number, path: string): void {
  const indexes = assertArray(value, path);
  indexes.forEach((index, position) => {
    const parsed = assertNonNegativeInteger(index, `${path}[${position}]`);
    if (parsed >= limit) throw new TypeError(`${path}[${position}] is outside the table.`);
  });
}

function assertIndexList(value: unknown, path: string): void {
  assertArray(value, path).forEach((index, position) =>
    assertNonNegativeInteger(index, `${path}[${position}]`));
}

function assertStringArray(value: unknown, path: string): void {
  assertArray(value, path).forEach((entry, index) => assertString(entry, `${path}[${index}]`));
}

function assertJsonValue(value: unknown, path: string, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    assertFiniteNumber(value, path);
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${path} must contain JSON values only.`);
  if (seen.has(value)) throw new TypeError(`${path} must not contain cycles.`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`, seen));
  } else {
    Object.entries(value).forEach(([key, entry]) => assertJsonValue(entry, `${path}.${key}`, seen));
  }
  seen.delete(value);
}

function cloneJson<T>(value: T): T {
  try {
    const json = JSON.stringify(value, (_key, entry: unknown) => {
      if (typeof entry === "number" && !Number.isFinite(entry)) {
        throw new TypeError("Math objects cannot contain non-finite numbers.");
      }
      if (typeof entry === "bigint" || typeof entry === "function" || typeof entry === "symbol") {
        throw new TypeError("Math objects must contain JSON-compatible values only.");
      }
      return entry;
    });
    return JSON.parse(json) as T;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Math object serialization failed.");
  }
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value;
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") throw new TypeError(`${path} must be a string.`);
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (value.length === 0) throw new TypeError(`${path} must not be empty.`);
}

function assertOptionalString(value: unknown, path: string): void {
  if (value !== undefined) assertString(value, path);
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean.`);
}

function assertFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value;
}

function assertPositiveNumber(value: unknown, path: string): number {
  const number = assertFiniteNumber(value, path);
  if (number <= 0) throw new TypeError(`${path} must be positive.`);
  return number;
}

function assertNonNegativeNumber(value: unknown, path: string): number {
  const number = assertFiniteNumber(value, path);
  if (number < 0) throw new TypeError(`${path} must be non-negative.`);
  return number;
}

function assertPositiveInteger(value: unknown, path: string): number {
  const number = assertFiniteNumber(value, path);
  if (!Number.isInteger(number) || number <= 0) throw new TypeError(`${path} must be a positive integer.`);
  return number;
}

function assertNonNegativeInteger(value: unknown, path: string): number {
  const number = assertFiniteNumber(value, path);
  if (!Number.isInteger(number) || number < 0) throw new TypeError(`${path} must be a non-negative integer.`);
  return number;
}

function assertOptionalNonNegativeInteger(value: unknown, path: string): void {
  if (value !== undefined) assertNonNegativeInteger(value, path);
}

function assertUnion<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`${path} is not supported.`);
  }
}

function assertOptionalUnion<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): void {
  if (value !== undefined) assertUnion(value, path, allowed);
}
