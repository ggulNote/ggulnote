import type { Point } from "@ggulnote/shared-types";
import type {
  CreateMathShapeInput,
  LabelMathShapeVertexInput,
  MarkMathShapeInput,
} from "../actions/math-action";
import type {
  MathObjectChild,
  MathShape,
  MathShapeGeometry,
  MathShapeMark,
  MathShapeType,
} from "../domain/math-object";
import {
  createBaseMathObject,
  nextSubEntityIds,
  validateMathObject,
} from "../handlers/math-handler-support";

export const createMathShape = (
  input: CreateMathShapeInput,
  objectId: string,
): MathShape => {
  assertShapeGeometry(input.shapeType, input.geometry);
  return validateMathObject({
    ...createBaseMathObject("shape", objectId, input),
    kind: "shape",
    shapeType: input.shapeType,
    ...(input.preset === undefined ? {} : { preset: input.preset }),
    geometry: cloneGeometry(input.geometry),
    labels: [],
    marks: [],
  });
};

export const labelMathShapeVertex = (
  shape: MathShape,
  input: LabelMathShapeVertexInput,
): MathShape => {
  assertTarget(shape, input.objectId);
  const vertices = getMathShapeVertices(shape);
  if (!Number.isInteger(input.vertexIndex)
    || input.vertexIndex < 0
    || input.vertexIndex >= vertices.length) {
    throw new RangeError("vertexIndex is outside the shape.");
  }
  const existing = shape.labels.find((label) =>
    label.target === "vertex" && label.targetIndex === input.vertexIndex);
  const labels = existing === undefined
    ? [...shape.labels, {
        id: nextSubEntityIds(shape.id, "label", 1, entityIds(shape))[0]!,
        text: input.label,
        target: "vertex" as const,
        targetIndex: input.vertexIndex,
      }]
    : shape.labels.map((label) => label.id === existing.id
      ? { ...label, text: input.label }
      : label);
  return validateMathObject({
    ...shape,
    labels,
    children: shapeChildren(labels, shape.marks),
  });
};

export const markMathShape = (
  shape: MathShape,
  markType: MathShapeMark["markType"],
  input: MarkMathShapeInput,
): MathShape => {
  assertTarget(shape, input.objectId);
  if (input.targetIndices.length === 0
    || input.targetIndices.some((index) => !Number.isInteger(index) || index < 0)) {
    throw new RangeError("A shape mark requires non-negative target indices.");
  }
  const targetCount = markTargetCount(shape);
  if (targetCount === 0 || input.targetIndices.some((index) => index >= targetCount)) {
    throw new RangeError("Shape mark target is outside the available geometry.");
  }
  const mark: MathShapeMark = {
    id: nextSubEntityIds(shape.id, "mark", 1, entityIds(shape))[0]!,
    markType,
    targetIndices: [...input.targetIndices],
    ...(input.value === undefined ? {} : { value: input.value }),
  };
  const marks = [...shape.marks, mark];
  return validateMathObject({
    ...shape,
    marks,
    children: shapeChildren(shape.labels, marks),
  });
};

export const getMathShapeVertices = (shape: MathShape): readonly Point[] => {
  switch (shape.geometry.kind) {
    case "point":
      return [shape.geometry.point];
    case "linear":
      return [shape.geometry.start, shape.geometry.end];
    case "angle":
      return [
        shape.geometry.vertex,
        shape.geometry.firstRayPoint,
        shape.geometry.secondRayPoint,
      ];
    case "polygon":
      return shape.geometry.vertices;
    case "circle":
    case "arc":
      return [];
  }
};

function assertShapeGeometry(shapeType: MathShapeType, geometry: MathShapeGeometry): void {
  if (shapeType === "point" && geometry.kind === "point") return;
  if ((shapeType === "segment" || shapeType === "line" || shapeType === "ray")
    && geometry.kind === "linear") {
    if (samePoint(geometry.start, geometry.end)) {
      throw new RangeError("Linear shape endpoints must be distinct.");
    }
    return;
  }
  if (shapeType === "angle" && geometry.kind === "angle") return;
  if (shapeType === "circle" && geometry.kind === "circle") return;
  if ((shapeType === "arc" || shapeType === "sector") && geometry.kind === "arc") return;
  if (geometry.kind === "polygon") {
    const required = polygonVertexCount(shapeType);
    if (required !== undefined && geometry.vertices.length !== required) {
      throw new RangeError(`${shapeType} requires ${required} vertices.`);
    }
    if (shapeType === "polygon" && geometry.vertices.length < 3) {
      throw new RangeError("A polygon requires at least three vertices.");
    }
    if (required !== undefined || shapeType === "polygon") return;
  }
  throw new TypeError(`${shapeType} is incompatible with ${geometry.kind} geometry.`);
}

function polygonVertexCount(shapeType: MathShapeType): number | undefined {
  if (shapeType === "triangle") return 3;
  if ([
    "quadrilateral",
    "rectangle",
    "square",
    "parallelogram",
    "rhombus",
    "trapezoid",
  ].includes(shapeType)) return 4;
  return undefined;
}

function markTargetCount(shape: MathShape): number {
  if (shape.geometry.kind === "polygon") return shape.geometry.vertices.length;
  if (shape.geometry.kind === "angle") return 2;
  if (shape.geometry.kind === "linear") return 1;
  return 0;
}

function cloneGeometry(geometry: MathShapeGeometry): MathShapeGeometry {
  return JSON.parse(JSON.stringify(geometry)) as MathShapeGeometry;
}

function shapeChildren(
  labels: MathShape["labels"],
  marks: MathShape["marks"],
): readonly MathObjectChild[] {
  return [
    ...labels.map((label) => ({ id: label.id, kind: "shape_label" })),
    ...marks.map((mark) => ({ id: mark.id, kind: "shape_mark" })),
  ];
}

function entityIds(shape: MathShape): ReadonlySet<string> {
  return new Set([...shape.labels, ...shape.marks].map((entity) => entity.id));
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function assertTarget(shape: MathShape, objectId: string): void {
  if (shape.id !== objectId) throw new Error(`Math shape target does not exist: ${objectId}`);
}
