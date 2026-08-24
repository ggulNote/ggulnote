import type {
  CanvasSceneObject,
  PageSceneSnapshot,
  Point,
  Rect,
  SceneMode,
  SceneObject,
  SceneSnapshot,
  SerializedAnnotation,
  Size,
} from "@ggulnote/editor-core";
import {
  buildPdfSceneObjects,
  buildSceneSnapshot,
  normalizedToCanonicalRect,
} from "@ggulnote/editor-core";
import {
  deserializeMathObject,
  getMathExpressionDisplayText,
  type MathObject,
  type MathObjectKind,
} from "@ggulnote/math-core";
import type {
  PageSemanticModel,
  SemanticCandidate,
} from "@ggulnote/document-core";
import type {
  VoiceFocusCandidate,
  VoiceFocusCandidates,
  VoiceTurnContextRead,
} from "../application";
import type { TldrawObjectProjection } from "../../editor/adapters/tldraw";

export interface EditorVoiceContextInput {
  documentId: string;
  mode: SceneMode;
  pageId: string;
  pageIndex: number;
  pageSize: Size;
  sceneRevision: number;
  pageSnapshot: PageSceneSnapshot;
  tldrawObjects?: readonly TldrawObjectProjection[];
  semanticModel?: PageSemanticModel;
  selectedAnnotationId?: string;
  recentSemanticCandidate?: SemanticCandidate;
}

export interface EditorPageBaseActivationInput {
  readonly documentId: string;
  readonly mode: SceneMode;
  readonly pageId: string;
  readonly pageIndex: number;
  readonly pageSize: Size;
  readonly contextRevision: number;
  readonly persistedAt: number;
  readonly pageSnapshot: PageSceneSnapshot;
  readonly tldrawObjects: readonly TldrawObjectProjection[];
  readonly semanticModel?: PageSemanticModel;
}

export interface EditorPageBaseActivation {
  readonly documentId: string;
  readonly pageId: string;
  readonly contextRevision: number;
  readonly createdAt: number;
  readonly scene: SceneSnapshot;
}

/** Builds the immutable page-activation scene from restored editor state. */
export function buildEditorPageBaseActivation(
  input: EditorPageBaseActivationInput,
): EditorPageBaseActivation {
  const contextRevision = normalizeContextRevision(input.contextRevision);
  const { scene } = buildEditorVoiceContextRead({
    documentId: input.documentId,
    mode: input.mode,
    pageId: input.pageId,
    pageIndex: input.pageIndex,
    pageSize: input.pageSize,
    sceneRevision: contextRevision,
    pageSnapshot: input.pageSnapshot,
    tldrawObjects: input.tldrawObjects,
    ...(input.semanticModel === undefined
      ? {}
      : { semanticModel: input.semanticModel }),
  });
  return Object.freeze({
    documentId: input.documentId,
    pageId: input.pageId,
    contextRevision,
    createdAt: Math.max(0, Math.floor(input.persistedAt)),
    scene,
  });
}

export function buildEditorVoiceContextRead(
  input: EditorVoiceContextInput,
): VoiceTurnContextRead {
  assertPageSize(input.pageSize);
  const canvasObjects = input.tldrawObjects === undefined
    ? input.pageSnapshot.annotations.map((annotation) =>
        annotationToSceneObject(
          annotation,
          input.pageSize,
          input.pageSnapshot.revision,
        ))
    : input.tldrawObjects.flatMap((object, index) => {
        const projected = tldrawProjectionToSceneObject(object, input, index);
        return projected === undefined ? [] : [projected];
      });
  const pdfObjects = input.mode === "pdf" && input.semanticModel
    ? buildPdfSceneObjects({
        documentId: input.documentId,
        pageId: input.pageId,
        pageIndex: input.pageIndex,
        pageWidth: input.pageSize.width,
        pageHeight: input.pageSize.height,
        semanticModel: input.semanticModel,
      }).objects
    : [];
  const scene = buildSceneSnapshot({
    mode: input.mode,
    page: {
      id: input.pageId,
      index: input.pageIndex,
      width: input.pageSize.width,
      height: input.pageSize.height,
    },
    sceneRevision: input.sceneRevision,
    pdfObjects,
    canvasObjects,
  });

  return {
    scene,
    focus: buildFocusCandidates(input, scene, canvasObjects),
  };
}

export function editorAnnotationSceneId(
  annotation: Pick<SerializedAnnotation, "id" | "pageId" | "type">,
): string {
  const kind = annotation.type === "TEXT"
    ? "text"
    : annotation.type === "TABLE"
      ? "table"
      : annotation.type === "UNDERLINE" || annotation.type === "HIGHLIGHT"
        ? "annotation"
        : "shape";
  return `canvas:${sanitizeId(annotation.pageId)}:${kind}:${sanitizeId(annotation.id)}`;
}

export function editorMathSceneId(
  pageId: string,
  logicalObjectId: string,
  kind: MathObjectKind,
): string {
  const sceneKind = kind === "graph" || kind === "shape" || kind === "table"
    ? kind
    : "math";
  return `canvas:${sanitizeId(pageId)}:${sceneKind}:${sanitizeId(logicalObjectId)}`;
}

function buildFocusCandidates(
  input: EditorVoiceContextInput,
  scene: SceneSnapshot,
  canvasObjects: readonly CanvasSceneObject[],
): VoiceFocusCandidates {
  const selected = input.selectedAnnotationId === undefined
    ? undefined
    : canvasObjects.find((object) => object.sourceObjectId === input.selectedAnnotationId);
  const selection = selected
    ? toFocusCandidate(
        "selection",
        selected.id,
        selected.bounds,
        selected.objectRevision,
      )
    : undefined;
  const recentFocus = input.recentSemanticCandidate
    ? semanticCandidateToFocus(input.recentSemanticCandidate, scene, input.pageSize)
    : undefined;
  const page: VoiceFocusCandidate = {
    source: "page",
    capturedAt: 0,
  };

  return {
    ...(selection ? { selection } : {}),
    ...(recentFocus ? { recentFocus } : {}),
    page,
  };
}

function tldrawProjectionToSceneObject(
  projection: TldrawObjectProjection,
  input: EditorVoiceContextInput,
  zIndex: number,
): CanvasSceneObject | undefined {
  if (projection.kind === "math") {
    const snapshot = projection.mathObjectSnapshot;
    if (snapshot === undefined) return undefined;
    let object: MathObject;
    try {
      object = deserializeMathObject(snapshot);
    } catch {
      return undefined;
    }
    return mathObjectToSceneObject(object, projection, input, zIndex);
  }
  const base = {
    id: projection.kind === "text"
      ? editorAnnotationSceneId({ id: projection.objectId, pageId: input.pageId, type: "TEXT" })
      : editorAnnotationSceneId({
          id: projection.objectId,
          pageId: input.pageId,
          type: projection.annotationType === "highlight" ? "HIGHLIGHT" : "UNDERLINE",
        }),
    sourceObjectId: projection.objectId,
    pageId: input.pageId,
    source: "canvas" as const,
    bounds: { ...projection.bounds },
    zIndex,
    visible: true,
    locked: false,
    objectRevision: Math.max(1, Math.floor(input.sceneRevision)),
    renderBounds: { ...projection.bounds },
    ...(projection.createdAt === undefined ? {} : { createdAt: projection.createdAt }),
    ...(projection.updatedAt === undefined ? {} : { updatedAt: projection.updatedAt }),
    ...(projection.createdByTurnId === undefined
      ? {}
      : { createdByTurnId: projection.createdByTurnId }),
    creationOrder: zIndex + 1,
  };
  if (projection.kind === "text") {
    return {
      ...base,
      kind: "text",
      text: projection.text ?? "",
      style: { fontFamily: "Arial", fontSize: 18, fontWeight: "normal" },
    };
  }
  return {
    ...base,
    kind: "annotation",
    annotationType: projection.annotationType ?? "underline",
    targetObjectIds: [...(projection.targetObjectIds ?? [])],
    ...(projection.rects === undefined ? {} : { rects: projection.rects.map((rect) => ({ ...rect })) }),
    style: projection.annotationType === "highlight"
      ? { color: "#facc15", opacity: 0.35 }
      : { color: "#1f2937", thickness: 2 },
  };
}

function mathObjectToSceneObject(
  object: MathObject,
  projection: TldrawObjectProjection,
  input: EditorVoiceContextInput,
  zIndex: number,
): CanvasSceneObject {
  const base = {
    id: editorMathSceneId(input.pageId, object.id, object.kind),
    sourceObjectId: projection.objectId,
    pageId: input.pageId,
    source: "canvas" as const,
    bounds: { ...object.bounds },
    zIndex,
    visible: true,
    locked: false,
    objectRevision: Math.max(1, Math.floor(input.sceneRevision)),
    renderBounds: { ...object.bounds },
    mathObjectSnapshot: projection.mathObjectSnapshot,
    ...(projection.createdAt === undefined ? {} : { createdAt: projection.createdAt }),
    ...(projection.updatedAt === undefined ? {} : { updatedAt: projection.updatedAt }),
    ...(projection.createdByTurnId === undefined
      ? {}
      : { createdByTurnId: projection.createdByTurnId }),
    creationOrder: zIndex + 1,
  };
  switch (object.kind) {
    case "expression":
      return {
        ...base,
        kind: "math",
        latex: getMathExpressionDisplayText(object),
        mathJson: projection.mathObjectSnapshot,
        layout: object.displayMode === "equation_stack" ? "equation-stack" : "display",
      };
    case "arithmetic_layout":
      return {
        ...base,
        kind: "math",
        latex: object.operands.join(object.arithmeticType === "multiply" ? " × " : " "),
        mathJson: projection.mathObjectSnapshot,
        layout: "long-multiplication",
      };
    case "graph":
      return {
        ...base,
        kind: "graph",
        expressions: object.functions.map((fn) => ({ id: fn.id, expression: fn.expression })),
        viewport: {
          xMin: object.coordinateSystem.xMin,
          xMax: object.coordinateSystem.xMax,
          yMin: object.coordinateSystem.yMin,
          yMax: object.coordinateSystem.yMax,
        },
        showAxes: object.coordinateSystem.showAxes,
        showGrid: object.coordinateSystem.showGrid,
      };
    case "table":
      return {
        ...base,
        kind: "table",
        rows: object.rowCount,
        columns: object.columnCount,
        cells: object.cells.flat().map((cell) => ({
          id: cell.id,
          row: cell.row,
          column: cell.column,
          text: cell.value,
        })),
      };
    case "shape":
      return {
        ...base,
        kind: "shape",
        shapeType: "rectangle",
        geometry: {
          kind: "rectangle",
          x: object.bounds.x,
          y: object.bounds.y,
          width: object.bounds.width,
          height: object.bounds.height,
        },
        style: {
          strokeWidth: object.style.strokeWidth,
          stroke: object.style.strokeColor ?? object.style.color,
          fill: object.style.backgroundColor ?? "transparent",
          opacity: object.style.opacity,
        },
      };
  }
}

function semanticCandidateToFocus(
  candidate: SemanticCandidate,
  scene: SceneSnapshot,
  pageSize: Size,
): VoiceFocusCandidate {
  const matchingObject = scene.objects.find((object) =>
    isMatchingSemanticObject(object, candidate),
  );
  return toFocusCandidate(
    "recent-focus",
    matchingObject?.id,
    matchingObject?.bounds
      ?? normalizedToCanonicalRect(candidate.bounds, pageSize),
    matchingObject?.objectRevision,
  );
}

function isMatchingSemanticObject(
  object: SceneObject,
  candidate: SemanticCandidate,
): boolean {
  if (object.source !== "pdf") return false;
  if (object.kind === "pdf-region") {
    return candidate.type === "LAYOUT_REGION" && object.regionId === candidate.id;
  }
  if (
    object.kind === "paragraph"
    || object.kind === "line"
    || object.kind === "word"
  ) {
    return object.sourceObjectId === candidate.id
      && object.kind.toUpperCase() === candidate.type;
  }
  return false;
}

function toFocusCandidate(
  source: "selection" | "recent-focus",
  objectId: string | undefined,
  bounds: Rect,
  objectRevision?: number,
): VoiceFocusCandidate {
  return {
    source,
    ...(objectId ? { objectId } : {}),
    ...(objectRevision !== undefined ? { objectRevision } : {}),
    bounds: { ...bounds },
    capturedAt: 0,
  };
}

function annotationToSceneObject(
  annotation: SerializedAnnotation,
  pageSize: Size,
  pageRevision: number,
): CanvasSceneObject {
  const bounds = normalizedToCanonicalRect(annotation.bounds, pageSize);
  const base = {
    id: editorAnnotationSceneId(annotation),
    sourceObjectId: annotation.id,
    pageId: annotation.pageId,
    source: "canvas" as const,
    bounds,
    zIndex: annotation.zIndex,
    visible: readBoolean(annotation.properties, "visible", true),
    locked: readBoolean(annotation.properties, "locked", false),
    objectRevision: Math.max(1, Math.floor(pageRevision)),
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
    ...(annotation.createdByTurnId === undefined
      ? {}
      : { createdByTurnId: annotation.createdByTurnId }),
    ...(annotation.creationOrder === undefined
      ? {}
      : { creationOrder: annotation.creationOrder }),
    renderBounds: bounds,
  };

  switch (annotation.type) {
    case "TEXT":
      return {
        ...base,
        kind: "text",
        sourceObjectId: annotation.id,
        text: readString(annotation.properties, "text", ""),
        style: {
          fontFamily: readString(
            annotation.properties,
            "textFontFamily",
            "Arial",
          ),
          fontSize: readNumber(annotation.properties, "fontSize", 14),
          fontWeight: readString(
            annotation.properties,
            "textFontWeight",
            "normal",
          ),
          textAlign: readTextAlign(annotation.properties),
        },
      };
    case "UNDERLINE":
      return {
        ...base,
        kind: "annotation",
        annotationType: "underline",
        targetObjectIds: [...(annotation.targetObjectIds ?? [])],
        ...(annotation.rects === undefined
          ? {}
          : {
              rects: annotation.rects.map((rect) =>
                normalizedToCanonicalRect(rect, pageSize)),
            }),
        style: {
          color: readString(annotation.properties, "color", "#1f2937"),
          thickness: readNumber(annotation.properties, "thickness", 2),
        },
      };
    case "HIGHLIGHT":
      return {
        ...base,
        kind: "annotation",
        annotationType: "highlight",
        targetObjectIds: [...(annotation.targetObjectIds ?? [])],
        ...(annotation.rects === undefined
          ? {}
          : {
              rects: annotation.rects.map((rect) =>
                normalizedToCanonicalRect(rect, pageSize)),
            }),
        style: {
          color: readString(annotation.properties, "color", "#facc15"),
          opacity: readNumber(annotation.properties, "opacity", 0.35),
        },
      };
    case "TABLE": {
      const rows = positiveInteger(
        readNumber(annotation.properties, "rows", 1),
      );
      const columns = positiveInteger(
        readNumber(annotation.properties, "columns", 1),
      );
      return {
        ...base,
        kind: "table",
        rows,
        columns,
        cells: Array.from({ length: rows * columns }, (_, index) => ({
          id: `${base.id}:cell:${index}`,
          row: Math.floor(index / columns),
          column: index % columns,
        })),
      };
    }
    case "SHAPE": {
      const shapeType = readString(annotation.properties, "shape", "rectangle")
        === "ellipse"
        ? "ellipse"
        : "rectangle";
      return {
        ...base,
        kind: "shape",
        shapeType,
        geometry: shapeType === "ellipse"
          ? {
              kind: "ellipse",
              centerX: bounds.x + bounds.width / 2,
              centerY: bounds.y + bounds.height / 2,
              radiusX: bounds.width / 2,
              radiusY: bounds.height / 2,
            }
          : {
              kind: "rectangle",
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            },
        style: {
          strokeWidth: readNumber(annotation.properties, "strokeWidth", 2),
          stroke: readString(annotation.properties, "strokeColor", "#1f2937"),
          fill: readBoolean(annotation.properties, "filled", false)
            ? readString(annotation.properties, "fillColor", "transparent")
            : "transparent",
        },
      };
    }
    case "LINE": {
      const start = readCanonicalPoint(
        annotation.properties,
        "start",
        { x: annotation.bounds.x, y: annotation.bounds.y },
        pageSize,
      );
      const end = readCanonicalPoint(
        annotation.properties,
        "end",
        {
          x: annotation.bounds.x + annotation.bounds.width,
          y: annotation.bounds.y + annotation.bounds.height,
        },
        pageSize,
      );
      const shapeType = readString(annotation.properties, "lineKind", "line")
        === "arrow"
        ? "arrow"
        : "line";
      return {
        ...base,
        kind: "shape",
        shapeType,
        geometry: shapeType === "arrow"
          ? { kind: "arrow", start, end, headSize: 8 }
          : { kind: "line", start, end },
        style: {
          strokeWidth: readNumber(annotation.properties, "strokeWidth", 2),
          stroke: readString(annotation.properties, "color", "#1f2937"),
        },
      };
    }
  }
}

function readCanonicalPoint(
  properties: Record<string, unknown>,
  key: string,
  fallback: Point,
  pageSize: Size,
): Point {
  const value = properties[key];
  const point = isPoint(value) ? value : fallback;
  const rect = normalizedToCanonicalRect(
    { x: point.x, y: point.y, width: 0, height: 0 },
    pageSize,
  );
  return { x: rect.x, y: rect.y };
}

function isPoint(value: unknown): value is Point {
  return typeof value === "object"
    && value !== null
    && "x" in value
    && "y" in value
    && typeof value.x === "number"
    && typeof value.y === "number";
}

function readTextAlign(
  properties: Record<string, unknown>,
): "left" | "center" | "right" {
  const value = properties.textAlign;
  return value === "center" || value === "right" ? value : "left";
}

function readString(
  properties: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = properties[key];
  return typeof value === "string" ? value : fallback;
}

function readNumber(
  properties: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = properties[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function readBoolean(
  properties: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = properties[key];
  return typeof value === "boolean" ? value : fallback;
}

function positiveInteger(value: number): number {
  return Math.min(20, Math.max(1, Math.floor(value)));
}

function normalizeContextRevision(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function sanitizeId(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.replace(/[:\s]+/gu, "-") : "item";
}

function assertPageSize(pageSize: Size): void {
  if (
    !Number.isFinite(pageSize.width)
    || !Number.isFinite(pageSize.height)
    || pageSize.width <= 0
    || pageSize.height <= 0
  ) {
    throw new Error("A positive canonical page size is required.");
  }
}
