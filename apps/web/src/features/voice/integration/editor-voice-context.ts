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
import type {
  PageSemanticModel,
  SemanticCandidate,
} from "@ggulnote/document-core";
import type {
  VoiceFocusCandidate,
  VoiceFocusCandidates,
  VoiceTurnContextRead,
} from "../application";

export interface EditorVoiceContextInput {
  documentId: string;
  mode: SceneMode;
  pageId: string;
  pageIndex: number;
  pageSize: Size;
  sceneRevision: number;
  pageSnapshot: PageSceneSnapshot;
  semanticModel?: PageSemanticModel;
  selectedAnnotationId?: string;
  recentSemanticCandidate?: SemanticCandidate;
}

export function buildEditorVoiceContextRead(
  input: EditorVoiceContextInput,
): VoiceTurnContextRead {
  assertPageSize(input.pageSize);
  const canvasObjects = input.pageSnapshot.annotations.map((annotation) =>
    annotationToSceneObject(
      annotation,
      input.pageSize,
      input.pageSnapshot.revision,
    ),
  );
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

function buildFocusCandidates(
  input: EditorVoiceContextInput,
  scene: SceneSnapshot,
  canvasObjects: readonly CanvasSceneObject[],
): VoiceFocusCandidates {
  const selectedAnnotation = input.selectedAnnotationId
    ? input.pageSnapshot.annotations.find(
        (annotation) => annotation.id === input.selectedAnnotationId,
      )
    : undefined;
  const selected = selectedAnnotation
    ? canvasObjects.find(
        (object) => object.id === editorAnnotationSceneId(selectedAnnotation),
      )
    : undefined;
  const selection = selected
    ? toFocusCandidate("selection", selected.id, selected.bounds)
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
): VoiceFocusCandidate {
  return {
    source,
    ...(objectId ? { objectId } : {}),
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
    pageId: annotation.pageId,
    source: "canvas" as const,
    bounds,
    zIndex: annotation.zIndex,
    visible: readBoolean(annotation.properties, "visible", true),
    locked: readBoolean(annotation.properties, "locked", false),
    objectRevision: Math.max(1, Math.floor(pageRevision)),
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
  };

  switch (annotation.type) {
    case "TEXT":
      return {
        ...base,
        kind: "text",
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
        targetObjectIds: [],
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
        targetObjectIds: [],
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
