import type { Point } from "@ggulnote/shared-types";
import type { CreateMathGraphInput } from "../actions/math-action";
import type {
  MathCoordinateSystem,
  MathGraph,
  MathGraphFunction,
  MathInterval,
} from "../domain/math-object";
import {
  createBaseMathObject,
  validateMathObject,
} from "../handlers/math-handler-support";

export interface MathGraphSamplingOptions {
  readonly sampleCount?: number;
  readonly xMin?: number;
  readonly xMax?: number;
}

export const createMathGraph = (
  input: CreateMathGraphInput,
  objectId: string,
): MathGraph => {
  if (input.functions.length === 0) {
    throw new TypeError("A graph requires at least one function.");
  }
  const functionIds = new Set<string>();
  for (const fn of input.functions) {
    if (functionIds.has(fn.id)) throw new TypeError(`Duplicate graph function id: ${fn.id}`);
    functionIds.add(fn.id);
    assertPhaseBFunction(fn);
  }
  const viewport = input.viewport ?? { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
  assertIncreasingRange(viewport.xMin, viewport.xMax, "x");
  assertIncreasingRange(viewport.yMin, viewport.yMax, "y");
  const coordinateSystem: MathCoordinateSystem = {
    ...viewport,
    xStep: chooseGraphStep(viewport.xMin, viewport.xMax),
    yStep: chooseGraphStep(viewport.yMin, viewport.yMax),
    showAxes: input.showAxes ?? true,
    showGrid: input.showGrid ?? true,
    xLabel: "x",
    yLabel: "y",
  };
  return validateMathObject({
    ...createBaseMathObject(
      "graph",
      objectId,
      input,
      input.functions.map((fn) => ({ id: fn.id, kind: "function" })),
    ),
    kind: "graph",
    coordinateSystem,
    functions: input.functions.map(cloneFunction),
    points: [],
    tangents: [],
    helperLines: [],
    labels: [],
  });
};

/** Evaluates only the deterministic M2 function subset. */
export const evaluateMathGraphFunction = (
  fn: MathGraphFunction,
  x: number,
): number | undefined => {
  if (!Number.isFinite(x) || !isInsideDomain(x, fn.domain)) return undefined;
  const a = parameter(fn, "a", 1);
  const b = parameter(fn, "b", 0);
  if (fn.functionType === "linear") return a * x + b;
  if (fn.functionType === "quadratic") {
    const c = parameter(fn, "c", 0);
    return a * x * x + b * x + c;
  }
  return undefined;
};

export const sampleMathGraphFunction = (
  fn: MathGraphFunction,
  coordinateSystem: MathCoordinateSystem,
  options: MathGraphSamplingOptions = {},
): readonly Point[] => {
  assertPhaseBFunction(fn);
  const sampleCount = options.sampleCount ?? 96;
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 2_000) {
    throw new RangeError("sampleCount must be an integer between 2 and 2000.");
  }
  const xMin = options.xMin ?? coordinateSystem.xMin;
  const xMax = options.xMax ?? coordinateSystem.xMax;
  assertIncreasingRange(xMin, xMax, "sample x");
  const points: Point[] = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const x = xMin + (xMax - xMin) * index / sampleCount;
    const y = evaluateMathGraphFunction(fn, x);
    if (y !== undefined && Number.isFinite(y)) points.push({ x, y });
  }
  return points;
};

export const mapGraphPointToBounds = (
  point: Point,
  coordinateSystem: MathCoordinateSystem,
  bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): Point => ({
  x: bounds.x + (point.x - coordinateSystem.xMin)
    / (coordinateSystem.xMax - coordinateSystem.xMin) * bounds.width,
  y: bounds.y + (coordinateSystem.yMax - point.y)
    / (coordinateSystem.yMax - coordinateSystem.yMin) * bounds.height,
});

export const chooseGraphStep = (min: number, max: number): number => {
  assertIncreasingRange(min, max, "graph");
  const roughStep = (max - min) / 10;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
};

function assertPhaseBFunction(fn: MathGraphFunction): void {
  if (fn.functionType !== "linear" && fn.functionType !== "quadratic") {
    throw new TypeError(`Phase B does not support ${fn.functionType} graph evaluation.`);
  }
  parameter(fn, "a", 1);
  parameter(fn, "b", 0);
  if (fn.functionType === "quadratic") parameter(fn, "c", 0);
}

function parameter(fn: MathGraphFunction, name: string, fallback: number): number {
  const value = fn.parameters[name] ?? fallback;
  if (!Number.isFinite(value)) {
    throw new TypeError(`Graph parameter ${name} must be finite.`);
  }
  return value;
}

function cloneFunction(fn: MathGraphFunction): MathGraphFunction {
  return {
    ...fn,
    parameters: { ...fn.parameters },
    ...(fn.domain === undefined ? {} : { domain: { ...fn.domain } }),
    ...(fn.style === undefined ? {} : { style: { ...fn.style } }),
  };
}

function isInsideDomain(x: number, domain: MathInterval | undefined): boolean {
  if (domain === undefined) return true;
  const aboveMin = domain.includeMin ? x >= domain.min : x > domain.min;
  const belowMax = domain.includeMax ? x <= domain.max : x < domain.max;
  return aboveMin && belowMax;
}

function assertIncreasingRange(min: number, max: number, name: string): void {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    throw new RangeError(`${name} range must contain finite increasing values.`);
  }
}
