import { NoteAgentValidationError } from "../domain";
import type { NoteSchema, NoteTool } from "./note-tool-registry";

export type NumericMatrix = readonly (readonly number[])[];

export interface MatrixMultiplyResult {
  readonly value: NumericMatrix;
  readonly rows: number;
  readonly columns: number;
}

export function addFiniteNumbers(values: readonly number[]): number {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("math.add requires at least two finite numbers.");
  }
  return values.reduce((sum, value) => sum + value, 0);
}

export function multiplyNumericMatrices(
  left: NumericMatrix,
  right: NumericMatrix,
): MatrixMultiplyResult {
  const leftShape = matrixShape(left, "left");
  const rightShape = matrixShape(right, "right");
  if (leftShape.columns !== rightShape.rows) {
    throw new RangeError("INCOMPATIBLE_MATRIX_DIMENSIONS");
  }
  const value = left.map((row) =>
    Array.from({ length: rightShape.columns }, (_, column) =>
      row.reduce((sum, entry, index) => sum + entry * (right[index]?.[column] ?? 0), 0)));
  return {
    value,
    rows: leftShape.rows,
    columns: rightShape.columns,
  };
}

export function createMathTools(): readonly NoteTool[] {
  return [mathAddTool(), matrixMultiplyTool()];
}

function mathAddTool(): NoteTool<{ values: readonly number[] }, { value: number }> {
  return {
    id: "math.add",
    kind: "COMPUTE",
    description: "Add two or more finite numbers deterministically.",
    examples: ["1, 2, 3을 더해 줘"],
    inputSchema: finiteNumberArraySchema,
    outputSchema: finiteNumberOutputSchema,
    isAvailable: () => true,
    prepare: async (input, context) => compute(context, () => ({
      status: "READY" as const,
      value: { value: addFiniteNumbers(input.values) },
      operations: [],
    })),
  };
}

function matrixMultiplyTool(): NoteTool<
  { left: NumericMatrix; right: NumericMatrix },
  MatrixMultiplyResult
> {
  return {
    id: "math.matrix_multiply",
    kind: "COMPUTE",
    description: "Multiply two rectangular numeric matrices when dimensions are compatible.",
    examples: ["첫 번째 행렬과 두 번째 행렬을 곱해 줘"],
    inputSchema: matrixMultiplyInputSchema,
    outputSchema: matrixMultiplyOutputSchema,
    isAvailable: () => true,
    prepare: async (input, context) => compute(context, () => {
      try {
        return {
          status: "READY" as const,
          value: multiplyNumericMatrices(input.left, input.right),
          operations: [],
        };
      } catch (error) {
        return error instanceof RangeError && error.message === "INCOMPATIBLE_MATRIX_DIMENSIONS"
          ? { status: "FAILED" as const, reasonCode: "INCOMPATIBLE_MATRIX_DIMENSIONS" }
          : { status: "FAILED" as const, reasonCode: "INVALID_MATRIX" };
      }
    }),
  };
}

function compute<T>(
  context: Parameters<NoteTool["prepare"]>[1],
  operation: () => T,
): T {
  const startedAt = context.metrics?.now();
  const result = operation();
  if (startedAt !== undefined) {
    context.metrics?.add("computeMs", context.metrics.now() - startedAt);
  }
  return result;
}

const finiteNumberArraySchema: NoteSchema<{ values: readonly number[] }> = {
  compact: Object.freeze({ values: "array of 2+ finite numbers" }),
  parse(value, path = "input") {
    const input = strictRecord(value, path, ["values"]);
    if (!Array.isArray(input.values) || input.values.length < 2) {
      throw validation(`${path}.values`, "expected at least two numbers");
    }
    const values = input.values.map((entry, index) =>
      finiteNumber(entry, `${path}.values[${index}]`));
    return { values };
  },
};

const matrixMultiplyInputSchema: NoteSchema<{ left: NumericMatrix; right: NumericMatrix }> = {
  compact: Object.freeze({
    left: "non-empty rectangular finite number matrix",
    right: "non-empty rectangular finite number matrix",
  }),
  parse(value, path = "input") {
    const input = strictRecord(value, path, ["left", "right"]);
    return {
      left: parseMatrix(input.left, `${path}.left`),
      right: parseMatrix(input.right, `${path}.right`),
    };
  },
};

const finiteNumberOutputSchema: NoteSchema<{ value: number }> = {
  compact: Object.freeze({ value: "finite number" }),
  parse(value, path = "output") {
    const output = strictRecord(value, path, ["value"]);
    return { value: finiteNumber(output.value, `${path}.value`) };
  },
};

const matrixMultiplyOutputSchema: NoteSchema<MatrixMultiplyResult> = {
  compact: Object.freeze({ value: "matrix", rows: "integer", columns: "integer" }),
  parse(value, path = "output") {
    const output = strictRecord(value, path, ["value", "rows", "columns"]);
    const matrix = parseMatrix(output.value, `${path}.value`);
    const rows = positiveInteger(output.rows, `${path}.rows`);
    const columns = positiveInteger(output.columns, `${path}.columns`);
    const shape = matrixShape(matrix, path);
    if (shape.rows !== rows || shape.columns !== columns) {
      throw validation(path, "matrix shape metadata mismatch");
    }
    return { value: matrix, rows, columns };
  },
};

function parseMatrix(value: unknown, path: string): NumericMatrix {
  if (!Array.isArray(value) || value.length === 0) {
    throw validation(path, "expected a non-empty matrix");
  }
  const matrix = value.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length === 0) {
      throw validation(`${path}[${rowIndex}]`, "expected a non-empty row");
    }
    return row.map((entry, columnIndex) =>
      finiteNumber(entry, `${path}[${rowIndex}][${columnIndex}]`));
  });
  matrixShape(matrix, path);
  return matrix;
}

function matrixShape(matrix: NumericMatrix, path: string) {
  const columns = matrix[0]?.length ?? 0;
  if (matrix.length === 0 || columns === 0 || matrix.some((row) => row.length !== columns)) {
    throw validation(path, "expected a rectangular matrix");
  }
  if (matrix.flat().some((value) => !Number.isFinite(value))) {
    throw validation(path, "expected finite numbers");
  }
  return { rows: matrix.length, columns };
}

function strictRecord(value: unknown, path: string, allowedKeys: readonly string[]) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validation(path, "expected an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw validation(path, "expected a plain object");
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => !allowedKeys.includes(key));
  if (unknown !== undefined) throw validation(`${path}.${unknown}`, "unexpected field");
  return record;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw validation(path, "expected a finite number");
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw validation(path, "expected a positive integer");
  }
  return value;
}

function validation(path: string, message: string): NoteAgentValidationError {
  return new NoteAgentValidationError(path, message);
}
