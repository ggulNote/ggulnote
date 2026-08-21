import type { Point } from "@ggulnote/shared-types";
import type {
  AddMathGraphHelperLineInput,
  AddMathGraphPointInput,
  AddMathGraphTangentInput,
  CreateMathGraphInput,
  LabelMathGraphPointInput,
} from "../actions/math-action";
import type {
  MathCoordinateSystem,
  MathGraph,
  MathGraphFunction,
  MathGraphFunctionType,
  MathGraphHelperLine,
  MathGraphPoint,
  MathGraphTangent,
  MathInterval,
  MathObjectChild,
} from "../domain/math-object";
import {
  createBaseMathObject,
  nextSubEntityIds,
  validateMathObject,
} from "../handlers/math-handler-support";

export interface MathGraphSamplingOptions {
  readonly sampleCount?: number;
  readonly xMin?: number;
  readonly xMax?: number;
}

const SUPPORTED_FUNCTION_TYPES = new Set<MathGraphFunctionType>([
  "linear",
  "quadratic",
  "cubic",
  "quartic",
  "absolute",
  "rational",
  "radical",
  "exponential",
  "logarithmic",
  "sin",
  "cos",
  "tan",
]);
const FUNCTION_EPSILON = 1e-10;

export const createMathGraph = (
  input: CreateMathGraphInput,
  objectId: string,
): MathGraph => {
  if (input.functions.length === 0) {
    throw new TypeError("A graph requires at least one function.");
  }
  const functionIds = new Set<string>();
  for (const fn of input.functions) {
    if (fn.id.length === 0) throw new TypeError("Graph function id must not be empty.");
    if (functionIds.has(fn.id)) throw new TypeError(`Duplicate graph function id: ${fn.id}`);
    functionIds.add(fn.id);
    assertSupportedFunction(fn);
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

/** Evaluates a typed descriptor without parsing its display expression. */
export const evaluateMathGraphFunction = (
  fn: MathGraphFunction,
  x: number,
): number | undefined => {
  if (!Number.isFinite(x) || !isInsideDomain(x, fn.domain)) return undefined;
  if (!SUPPORTED_FUNCTION_TYPES.has(fn.functionType)) return undefined;
  const a = parameter(fn, "a", 1);
  const h = parameter(fn, "h", 0);
  const k = parameter(fn, "k", 0);
  let result: number | undefined;
  switch (fn.functionType) {
    case "linear":
      result = a * x + parameter(fn, "b", 0);
      break;
    case "quadratic":
      result = a * x ** 2 + parameter(fn, "b", 0) * x + parameter(fn, "c", 0);
      break;
    case "cubic":
      result = a * x ** 3
        + parameter(fn, "b", 0) * x ** 2
        + parameter(fn, "c", 0) * x
        + parameter(fn, "d", 0);
      break;
    case "quartic":
      result = a * x ** 4
        + parameter(fn, "b", 0) * x ** 3
        + parameter(fn, "c", 0) * x ** 2
        + parameter(fn, "d", 0) * x
        + parameter(fn, "e", 0);
      break;
    case "absolute":
      result = a * Math.abs(x - h) + k;
      break;
    case "rational": {
      const denominator = x - h;
      result = Math.abs(denominator) <= FUNCTION_EPSILON ? undefined : a / denominator + k;
      break;
    }
    case "radical": {
      const radicand = x - h;
      result = radicand < 0 ? undefined : a * Math.sqrt(radicand) + k;
      break;
    }
    case "exponential":
      result = a * parameterBase(fn) ** (x - h) + k;
      break;
    case "logarithmic": {
      const argument = x - h;
      result = argument <= 0
        ? undefined
        : a * Math.log(argument) / Math.log(parameterBase(fn)) + k;
      break;
    }
    case "sin":
      result = a * Math.sin(parameter(fn, "b", 1) * (x - h)) + k;
      break;
    case "cos":
      result = a * Math.cos(parameter(fn, "b", 1) * (x - h)) + k;
      break;
    case "tan": {
      const angle = parameter(fn, "b", 1) * (x - h);
      result = Math.abs(Math.cos(angle)) <= FUNCTION_EPSILON
        ? undefined
        : a * Math.tan(angle) + k;
      break;
    }
    case "circle":
    case "ellipse":
    case "hyperbola":
    case "custom":
      result = undefined;
  }
  return result !== undefined && Number.isFinite(result) ? result : undefined;
};

/** Returns the analytic slope, or undefined at non-differentiable points. */
export const evaluateMathGraphDerivative = (
  fn: MathGraphFunction,
  x: number,
): number | undefined => {
  if (evaluateMathGraphFunction(fn, x) === undefined) return undefined;
  const a = parameter(fn, "a", 1);
  const h = parameter(fn, "h", 0);
  const b = parameter(fn, "b", 1);
  let result: number | undefined;
  switch (fn.functionType) {
    case "linear":
      result = a;
      break;
    case "quadratic":
      result = 2 * a * x + parameter(fn, "b", 0);
      break;
    case "cubic":
      result = 3 * a * x ** 2 + 2 * parameter(fn, "b", 0) * x + parameter(fn, "c", 0);
      break;
    case "quartic":
      result = 4 * a * x ** 3
        + 3 * parameter(fn, "b", 0) * x ** 2
        + 2 * parameter(fn, "c", 0) * x
        + parameter(fn, "d", 0);
      break;
    case "absolute":
      result = Math.abs(x - h) <= FUNCTION_EPSILON ? undefined : a * Math.sign(x - h);
      break;
    case "rational":
      result = -a / (x - h) ** 2;
      break;
    case "radical":
      result = x <= h ? undefined : a / (2 * Math.sqrt(x - h));
      break;
    case "exponential": {
      const base = parameterBase(fn);
      result = a * Math.log(base) * base ** (x - h);
      break;
    }
    case "logarithmic":
      result = a / ((x - h) * Math.log(parameterBase(fn)));
      break;
    case "sin":
      result = a * b * Math.cos(b * (x - h));
      break;
    case "cos":
      result = -a * b * Math.sin(b * (x - h));
      break;
    case "tan":
      result = a * b / Math.cos(b * (x - h)) ** 2;
      break;
    case "circle":
    case "ellipse":
    case "hyperbola":
    case "custom":
      result = undefined;
  }
  return result !== undefined && Number.isFinite(result) ? result : undefined;
};

/** Samples separate continuous segments so renderers never bridge an asymptote. */
export const sampleMathGraphFunctionSegments = (
  fn: MathGraphFunction,
  coordinateSystem: MathCoordinateSystem,
  options: MathGraphSamplingOptions = {},
): readonly (readonly Point[])[] => {
  assertSupportedFunction(fn);
  const sampleCount = options.sampleCount ?? 192;
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 2_000) {
    throw new RangeError("sampleCount must be an integer between 2 and 2000.");
  }
  const xMin = options.xMin ?? coordinateSystem.xMin;
  const xMax = options.xMax ?? coordinateSystem.xMax;
  assertIncreasingRange(xMin, xMax, "sample x");
  const segments: Point[][] = [];
  let current: Point[] = [];
  let previous: Point | undefined;
  for (let index = 0; index <= sampleCount; index += 1) {
    const x = xMin + (xMax - xMin) * index / sampleCount;
    const y = evaluateMathGraphFunction(fn, x);
    if (y === undefined) {
      if (current.length > 0) segments.push(current);
      current = [];
      previous = undefined;
      continue;
    }
    const point = { x, y };
    if (previous !== undefined && hasDiscontinuityBetween(fn, previous.x, x)) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    current.push(point);
    previous = point;
  }
  if (current.length > 0) segments.push(current);
  return segments;
};

/** Compatibility helper for callers that only need sampled values. */
export const sampleMathGraphFunction = (
  fn: MathGraphFunction,
  coordinateSystem: MathCoordinateSystem,
  options: MathGraphSamplingOptions = {},
): readonly Point[] => sampleMathGraphFunctionSegments(fn, coordinateSystem, options).flat();

export const addMathGraphPoint = (
  graph: MathGraph,
  input: AddMathGraphPointInput,
): MathGraph => {
  assertGraphTarget(graph, input.objectId);
  assertFinitePoint({ x: input.x, y: input.y }, "Graph point");
  const functionIds = [...new Set(input.functionIds ?? [])];
  functionIds.forEach((functionId) => requireGraphFunction(graph, functionId));
  const point: MathGraphPoint = {
    id: resolveGraphEntityId(graph, "point", input.pointId),
    position: { x: input.x, y: input.y },
    ...(input.label === undefined ? {} : { label: input.label }),
    role: "user",
    functionIds,
  };
  const points = [...graph.points, point];
  return validateMathObject({
    ...graph,
    points,
    children: graphChildren(graph, { points }),
  });
};

export const labelMathGraphPoint = (
  graph: MathGraph,
  input: LabelMathGraphPointInput,
): MathGraph => {
  assertGraphTarget(graph, input.objectId);
  if (!graph.points.some((point) => point.id === input.pointId)) {
    throw new Error(`Math graph point does not exist: ${input.pointId}`);
  }
  const points = graph.points.map((point) => point.id === input.pointId
    ? { ...point, label: input.label }
    : point);
  return validateMathObject({ ...graph, points });
};

export const addMathGraphTangent = (
  graph: MathGraph,
  input: AddMathGraphTangentInput,
): MathGraph => {
  assertGraphTarget(graph, input.objectId);
  if (!Number.isFinite(input.atX)) throw new TypeError("Tangent x must be finite.");
  const fn = requireGraphFunction(graph, input.functionId);
  const y = evaluateMathGraphFunction(fn, input.atX);
  const slope = evaluateMathGraphDerivative(fn, input.atX);
  if (y === undefined || slope === undefined) {
    throw new RangeError(`A finite tangent does not exist for ${input.functionId} at x=${input.atX}.`);
  }
  const tangent: MathGraphTangent = {
    id: resolveGraphEntityId(graph, "tangent", input.tangentId),
    functionId: input.functionId,
    atX: input.atX,
    point: { x: input.atX, y },
    slope,
    ...(input.label === undefined ? {} : { label: input.label }),
  };
  const tangents = [...graph.tangents, tangent];
  return validateMathObject({
    ...graph,
    tangents,
    children: graphChildren(graph, { tangents }),
  });
};

export type MathGraphTangentRequest =
  | { readonly mode: "at-point"; readonly x: number; readonly y?: number }
  | { readonly mode: "at-x"; readonly x: number }
  | { readonly mode: "quadrant"; readonly quadrant: 1 | 2 | 3 | 4 }
  | { readonly mode: "auto" };

export interface ResolvedMathGraphTangentRequest {
  readonly functionId: string;
  readonly atX: number;
}

/** Resolves a semantic request to one visible contact point; derivative math stays in addMathGraphTangent. */
export const resolveMathGraphTangentRequest = (
  graph: MathGraph,
  request: MathGraphTangentRequest,
): ResolvedMathGraphTangentRequest => {
  if (request.mode === "at-point" || request.mode === "at-x") {
    if (!Number.isFinite(request.x)) throw new TypeError("Tangent x must be finite.");
    const requestedY = request.mode === "at-point" ? request.y : undefined;
    if (requestedY !== undefined && !Number.isFinite(requestedY)) {
      throw new TypeError("Tangent point y must be finite.");
    }
    const tolerance = Math.max(
      FUNCTION_EPSILON,
      (graph.coordinateSystem.yMax - graph.coordinateSystem.yMin) * 1e-6,
    );
    for (const fn of graph.functions) {
      const y = evaluateMathGraphFunction(fn, request.x);
      const slope = evaluateMathGraphDerivative(fn, request.x);
      if (y === undefined || slope === undefined) continue;
      if (requestedY !== undefined && Math.abs(y - requestedY) > tolerance) continue;
      return { functionId: fn.id, atX: request.x };
    }
    throw new RangeError(requestedY === undefined
      ? `A finite tangent does not exist at x=${request.x}.`
      : `The requested point (${request.x}, ${requestedY}) is not on a graph curve.`);
  }

  const candidate = chooseVisibleTangentCandidate(
    graph,
    request.mode === "quadrant" ? request.quadrant : undefined,
  );
  if (candidate === undefined) {
    throw new RangeError(request.mode === "quadrant"
      ? `No visible finite tangent contact exists in quadrant ${request.quadrant}.`
      : "No visible finite tangent contact exists in the graph viewport.");
  }
  return { functionId: candidate.functionId, atX: candidate.x };
};

interface VisibleTangentCandidate {
  readonly functionId: string;
  readonly functionIndex: number;
  readonly x: number;
  readonly score: number;
}

function chooseVisibleTangentCandidate(
  graph: MathGraph,
  quadrant: 1 | 2 | 3 | 4 | undefined,
): VisibleTangentCandidate | undefined {
  const coordinates = graph.coordinateSystem;
  const xSpan = coordinates.xMax - coordinates.xMin;
  const ySpan = coordinates.yMax - coordinates.yMin;
  const sampleCount = 40;
  const inset = 0.12;
  const targetX = quadrant === undefined
    ? (coordinates.xMin + coordinates.xMax) / 2
    : signedAxisMidpoint(
        coordinates.xMin,
        coordinates.xMax,
        quadrant === 1 || quadrant === 4,
      );
  const targetY = quadrant === undefined
    ? (coordinates.yMin + coordinates.yMax) / 2
    : signedAxisMidpoint(
        coordinates.yMin,
        coordinates.yMax,
        quadrant === 1 || quadrant === 2,
      );
  const candidates: VisibleTangentCandidate[] = [];
  graph.functions.forEach((fn, functionIndex) => {
    for (let index = 0; index <= sampleCount; index += 1) {
      const ratio = inset + (1 - inset * 2) * index / sampleCount;
      const x = coordinates.xMin + xSpan * ratio;
      const y = evaluateMathGraphFunction(fn, x);
      const slope = evaluateMathGraphDerivative(fn, x);
      if (y === undefined || slope === undefined || !insideTangentViewport(y, coordinates)) continue;
      if (quadrant !== undefined && !pointIsInQuadrant(x, y, quadrant)) continue;
      if (clipGraphLineToViewport({ x, y }, slope, coordinates) === undefined) continue;
      candidates.push({
        functionId: fn.id,
        functionIndex,
        x,
        score: Math.abs(x - targetX) / xSpan + Math.abs(y - targetY) / ySpan,
      });
    }
  });
  return candidates.sort((left, right) => left.score - right.score
    || left.functionIndex - right.functionIndex
    || left.x - right.x)[0];
}

function signedAxisMidpoint(minimum: number, maximum: number, positive: boolean): number {
  const start = positive ? Math.max(0, minimum) : minimum;
  const end = positive ? maximum : Math.min(0, maximum);
  return start < end ? (start + end) / 2 : (minimum + maximum) / 2;
}

function insideTangentViewport(
  y: number,
  coordinates: MathGraph["coordinateSystem"],
): boolean {
  const inset = (coordinates.yMax - coordinates.yMin) * 0.06;
  return y >= coordinates.yMin + inset && y <= coordinates.yMax - inset;
}

function pointIsInQuadrant(x: number, y: number, quadrant: 1 | 2 | 3 | 4): boolean {
  if (Math.abs(x) <= FUNCTION_EPSILON || Math.abs(y) <= FUNCTION_EPSILON) return false;
  if (quadrant === 1) return x > 0 && y > 0;
  if (quadrant === 2) return x < 0 && y > 0;
  if (quadrant === 3) return x < 0 && y < 0;
  return x > 0 && y < 0;
}

export const addMathGraphHelperLine = (
  graph: MathGraph,
  input: AddMathGraphHelperLineInput,
): MathGraph => {
  assertGraphTarget(graph, input.objectId);
  const line = cloneHelperLine(input.helperLine);
  assertGraphEntityId(graph, line.id);
  assertFinitePoint(line.start, "Helper line start");
  assertFinitePoint(line.end, "Helper line end");
  if (samePoint(line.start, line.end)) {
    throw new RangeError("Helper line endpoints must be distinct.");
  }
  if (line.helperType === "vertical" && line.start.x !== line.end.x) {
    throw new RangeError("A vertical helper line requires equal x coordinates.");
  }
  if (line.helperType === "horizontal" && line.start.y !== line.end.y) {
    throw new RangeError("A horizontal helper line requires equal y coordinates.");
  }
  const helperLines = [...graph.helperLines, line];
  return validateMathObject({
    ...graph,
    helperLines,
    children: graphChildren(graph, { helperLines }),
  });
};

/** Clips an infinite point-slope line to the graph viewport. */
export const clipGraphLineToViewport = (
  point: Point,
  slope: number,
  coordinateSystem: MathCoordinateSystem,
): readonly [Point, Point] | undefined => {
  assertFinitePoint(point, "Line point");
  if (!Number.isFinite(slope)) return undefined;
  const candidates: Point[] = [];
  for (const x of [coordinateSystem.xMin, coordinateSystem.xMax]) {
    const y = point.y + slope * (x - point.x);
    if (insideClosedRange(y, coordinateSystem.yMin, coordinateSystem.yMax)) {
      candidates.push({ x, y });
    }
  }
  if (Math.abs(slope) > FUNCTION_EPSILON) {
    for (const y of [coordinateSystem.yMin, coordinateSystem.yMax]) {
      const x = point.x + (y - point.y) / slope;
      if (insideClosedRange(x, coordinateSystem.xMin, coordinateSystem.xMax)) {
        candidates.push({ x, y });
      }
    }
  }
  const unique = candidates.filter((candidate, index) =>
    candidates.findIndex((other) => nearlySamePoint(candidate, other)) === index);
  if (unique.length < 2) return undefined;
  let farthest: readonly [Point, Point] = [unique[0]!, unique[1]!];
  let farthestDistance = squaredDistance(farthest[0], farthest[1]);
  for (let left = 0; left < unique.length; left += 1) {
    for (let right = left + 1; right < unique.length; right += 1) {
      const distance = squaredDistance(unique[left]!, unique[right]!);
      if (distance > farthestDistance) {
        farthest = [unique[left]!, unique[right]!];
        farthestDistance = distance;
      }
    }
  }
  return comparePoints(farthest[0], farthest[1]) <= 0
    ? farthest
    : [farthest[1], farthest[0]];
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

function assertSupportedFunction(fn: MathGraphFunction): void {
  if (!SUPPORTED_FUNCTION_TYPES.has(fn.functionType)) {
    throw new TypeError(`Phase C does not support ${fn.functionType} graph evaluation.`);
  }
  parameter(fn, "a", 1);
  switch (fn.functionType) {
    case "linear":
      parameter(fn, "b", 0);
      break;
    case "quadratic":
      parameter(fn, "b", 0);
      parameter(fn, "c", 0);
      break;
    case "cubic":
      parameter(fn, "b", 0);
      parameter(fn, "c", 0);
      parameter(fn, "d", 0);
      break;
    case "quartic":
      parameter(fn, "b", 0);
      parameter(fn, "c", 0);
      parameter(fn, "d", 0);
      parameter(fn, "e", 0);
      break;
    case "absolute":
    case "rational":
    case "radical":
      parameter(fn, "h", 0);
      parameter(fn, "k", 0);
      break;
    case "exponential":
    case "logarithmic":
      parameterBase(fn);
      parameter(fn, "h", 0);
      parameter(fn, "k", 0);
      break;
    case "sin":
    case "cos":
    case "tan":
      parameter(fn, "b", 1);
      parameter(fn, "h", 0);
      parameter(fn, "k", 0);
      break;
    case "circle":
    case "ellipse":
    case "hyperbola":
    case "custom":
      break;
  }
  if (fn.domain !== undefined) assertIncreasingRange(fn.domain.min, fn.domain.max, "function domain");
}

function parameterBase(fn: MathGraphFunction): number {
  const base = parameter(fn, "base", 2);
  if (base <= 0 || base === 1) {
    throw new RangeError("Graph base must be positive and different from 1.");
  }
  return base;
}

function parameter(fn: MathGraphFunction, name: string, fallback: number): number {
  const value = fn.parameters[name] ?? fallback;
  if (!Number.isFinite(value)) throw new TypeError(`Graph parameter ${name} must be finite.`);
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

function cloneHelperLine(line: MathGraphHelperLine): MathGraphHelperLine {
  return { ...line, start: { ...line.start }, end: { ...line.end } };
}

function isInsideDomain(x: number, domain: MathInterval | undefined): boolean {
  if (domain === undefined) return true;
  const aboveMin = domain.includeMin ? x >= domain.min : x > domain.min;
  const belowMax = domain.includeMax ? x <= domain.max : x < domain.max;
  return aboveMin && belowMax;
}

function hasDiscontinuityBetween(fn: MathGraphFunction, leftX: number, rightX: number): boolean {
  if (fn.functionType === "rational") {
    return liesStrictlyBetween(parameter(fn, "h", 0), leftX, rightX);
  }
  if (fn.functionType !== "tan") return false;
  const b = parameter(fn, "b", 1);
  if (Math.abs(b) <= FUNCTION_EPSILON) return false;
  const h = parameter(fn, "h", 0);
  const leftAngle = b * (leftX - h);
  const rightAngle = b * (rightX - h);
  const minAngle = Math.min(leftAngle, rightAngle);
  const maxAngle = Math.max(leftAngle, rightAngle);
  const firstIndex = Math.ceil((minAngle - Math.PI / 2) / Math.PI);
  const firstAsymptote = Math.PI / 2 + firstIndex * Math.PI;
  return firstAsymptote > minAngle + FUNCTION_EPSILON
    && firstAsymptote < maxAngle - FUNCTION_EPSILON;
}

function graphChildren(
  graph: MathGraph,
  patch: Partial<Pick<MathGraph, "points" | "tangents" | "helperLines" | "labels">> = {},
): readonly MathObjectChild[] {
  const points = patch.points ?? graph.points;
  const tangents = patch.tangents ?? graph.tangents;
  const helperLines = patch.helperLines ?? graph.helperLines;
  const labels = patch.labels ?? graph.labels;
  return [
    ...graph.functions.map((fn) => ({ id: fn.id, kind: "function" })),
    ...points.map((point) => ({ id: point.id, kind: "graph_point" })),
    ...tangents.map((tangent) => ({ id: tangent.id, kind: "graph_tangent" })),
    ...helperLines.map((line) => ({ id: line.id, kind: "graph_helper_line" })),
    ...labels.map((label) => ({ id: label.id, kind: "graph_label" })),
  ];
}

function graphEntityIds(graph: MathGraph): ReadonlySet<string> {
  return new Set([
    ...graph.functions,
    ...graph.points,
    ...graph.tangents,
    ...graph.helperLines,
    ...graph.labels,
  ].map((entity) => entity.id));
}

function resolveGraphEntityId(
  graph: MathGraph,
  entityKind: "point" | "tangent",
  requestedId: string | undefined,
): string {
  if (requestedId !== undefined) {
    assertGraphEntityId(graph, requestedId);
    return requestedId;
  }
  return nextSubEntityIds(graph.id, entityKind, 1, graphEntityIds(graph))[0]!;
}

function assertGraphEntityId(graph: MathGraph, id: string): void {
  if (id.length === 0) throw new TypeError("Graph sub-entity id must not be empty.");
  if (graphEntityIds(graph).has(id)) throw new TypeError(`Duplicate graph sub-entity id: ${id}`);
}

function requireGraphFunction(graph: MathGraph, functionId: string): MathGraphFunction {
  const fn = graph.functions.find((candidate) => candidate.id === functionId);
  if (fn === undefined) throw new Error(`Math graph function does not exist: ${functionId}`);
  return fn;
}

function assertGraphTarget(graph: MathGraph, objectId: string): void {
  if (graph.id !== objectId) throw new Error(`Math graph target does not exist: ${objectId}`);
}

function assertFinitePoint(point: Point, name: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${name} must contain finite coordinates.`);
  }
}

function assertIncreasingRange(min: number, max: number, name: string): void {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    throw new RangeError(`${name} range must contain finite increasing values.`);
  }
}

function liesStrictlyBetween(value: number, left: number, right: number): boolean {
  return value > Math.min(left, right) + FUNCTION_EPSILON
    && value < Math.max(left, right) - FUNCTION_EPSILON;
}

function insideClosedRange(value: number, min: number, max: number): boolean {
  return value >= min - FUNCTION_EPSILON && value <= max + FUNCTION_EPSILON;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function nearlySamePoint(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) <= FUNCTION_EPSILON
    && Math.abs(left.y - right.y) <= FUNCTION_EPSILON;
}

function squaredDistance(left: Point, right: Point): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function comparePoints(left: Point, right: Point): number {
  return left.x === right.x ? left.y - right.y : left.x - right.x;
}
