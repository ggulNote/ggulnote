import { ShapeKind } from "../annotations/annotation-types";
import type { Annotation } from "../annotations/annotation";
import { TextAnnotation } from "../annotations/text-annotation";
import { UnderlineAnnotation } from "../annotations/underline-annotation";
import { HighlightAnnotation } from "../annotations/highlight-annotation";
import { ShapeAnnotation } from "../annotations/shape-annotation";
import { LineAnnotation } from "../annotations/line-annotation";
import { TableAnnotation } from "../annotations/table-annotation";
import type { SerializedAnnotation } from "./serialized-annotation";
import { MAX_ANNOTATION_RECT_COUNT } from "../annotations/annotation-types";
import { unionAnnotationRects } from "../geometry/multi-rect-geometry";
import type { AnnotationObjectMetadata } from "../annotations/annotation-types";

export const serializeAnnotation = (annotation: Annotation): SerializedAnnotation => annotation.serialize();

const ensureRect = (value: unknown): SerializedAnnotation["bounds"] => {
  if (!value || typeof value !== "object") {
    throw new Error("bounds is required");
  }

  const candidate = value as {
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
  };

  if (
    typeof candidate.x !== "number" ||
    typeof candidate.y !== "number" ||
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number"
  ) {
    throw new Error("Invalid bounds");
  }

  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  };
};

const ensureRects = (value: unknown): SerializedAnnotation["rects"] => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ANNOTATION_RECT_COUNT) {
    throw new Error("Invalid annotation rects");
  }
  return value.map((rect, index) => {
    const normalized = ensureRect(rect);
    if (
      !Number.isFinite(normalized.x)
      || !Number.isFinite(normalized.y)
      || !Number.isFinite(normalized.width)
      || !Number.isFinite(normalized.height)
      || normalized.width <= 0
      || normalized.height <= 0
    ) {
      throw new Error(`Invalid annotation rect at index ${index}`);
    }
    return normalized;
  });
};

const ensureNumber = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Invalid number");
  }

  return value;
};

const ensureOpacity = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.35;
  }

  return Math.min(1, Math.max(0, value));
};

const ensureString = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new Error("Invalid string");
  }

  return value;
};

const ensureIntRange = (value: unknown, min: number, max: number): number => {
  if (!Number.isInteger(value as number) || (value as number) < min || (value as number) > max) {
    throw new Error("Invalid integer");
  }

  return value as number;
};

const ensureColor = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.length > 0 ? value : fallback;
};

const ensureObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object") {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
};

const ensureObjectMetadata = (
  raw: SerializedAnnotation,
): AnnotationObjectMetadata => {
  if (
    raw.createdByTurnId !== undefined
    && (typeof raw.createdByTurnId !== "string" || raw.createdByTurnId.trim().length === 0)
  ) {
    throw new Error("Invalid createdByTurnId");
  }
  if (
    raw.creationOrder !== undefined
    && (!Number.isFinite(raw.creationOrder) || raw.creationOrder < 0)
  ) {
    throw new Error("Invalid creationOrder");
  }
  if (
    raw.targetObjectIds !== undefined
    && (
      !Array.isArray(raw.targetObjectIds)
      || raw.targetObjectIds.some(
        (value) => typeof value !== "string" || value.trim().length === 0,
      )
    )
  ) {
    throw new Error("Invalid targetObjectIds");
  }
  return {
    ...(raw.createdByTurnId === undefined
      ? {}
      : { createdByTurnId: raw.createdByTurnId }),
    ...(raw.creationOrder === undefined
      ? {}
      : { creationOrder: raw.creationOrder }),
    ...(raw.targetObjectIds === undefined
      ? {}
      : { targetObjectIds: [...raw.targetObjectIds] }),
  };
};

const ensurePoint = (value: unknown): { x: number; y: number } => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid point");
  }

  const point = value as { x?: unknown; y?: unknown };
  return {
    x: ensureNumber(point.x),
    y: ensureNumber(point.y),
  };
};

const ensureFontWeight = (value: unknown): "normal" | "bold" => {
  return value === "bold" ? "bold" : "normal";
};

const ensureLineStyle = (value: unknown): "solid" | "double" | "wavy" => {
  return value === "double" || value === "wavy" ? value : "solid";
};

export const deserializeAnnotation = (raw: SerializedAnnotation): Annotation => {
  if (!raw || raw.schemaVersion !== 1) {
    throw new Error("Invalid serialized annotation");
  }

  const base = {
    id: ensureString(raw.id),
    pageId: ensureString(raw.pageId),
    zIndex: ensureNumber(raw.zIndex),
    createdAt: ensureNumber(raw.createdAt),
    updatedAt: ensureNumber(raw.updatedAt),
    properties: ensureObject(raw.properties),
    objectMetadata: ensureObjectMetadata(raw),
  };

  switch (raw.type) {
    case "TEXT":
      return new TextAnnotation(
        base.id,
        base.pageId,
        ensureRect(raw.bounds),
        base.zIndex,
        base.createdAt,
        base.updatedAt,
        ensureString(base.properties.text ?? ""),
        Math.max(8, Math.round(ensureNumber(base.properties.fontSize ?? 14))),
        base.properties.textAlign === "center" || base.properties.textAlign === "right"
          ? (base.properties.textAlign as "center" | "right")
          : "left",
        ensureColor(base.properties.textColor, "#111827"),
        ensureString(base.properties.textFontFamily ?? "Arial"),
        ensureFontWeight(base.properties.textFontWeight),
        base.objectMetadata,
      );

    case "UNDERLINE": {
      const rects = ensureRects(raw.rects);
      return new UnderlineAnnotation(
        base.id,
        base.pageId,
        rects === undefined ? ensureRect(raw.bounds) : unionAnnotationRects(rects),
        base.zIndex,
        base.createdAt,
        base.updatedAt,
        Math.max(1, Math.round(ensureNumber(base.properties.thickness ?? 1))),
        ensureLineStyle(base.properties.lineStyle),
        ensureColor(base.properties.color, "#1f2937"),
        rects,
        base.objectMetadata,
      );
    }

    case "HIGHLIGHT": {
      const rects = ensureRects(raw.rects);
      return new HighlightAnnotation(
        base.id,
        base.pageId,
        rects === undefined ? ensureRect(raw.bounds) : unionAnnotationRects(rects),
        base.zIndex,
        base.createdAt,
        base.updatedAt,
        ensureOpacity(base.properties.opacity ?? 0.35),
        ensureColor(base.properties.color, "#facc15"),
        rects,
        base.objectMetadata,
      );
    }

    case "SHAPE": {
      const shape =
        base.properties.shape === "ellipse" || base.properties.shape === "rectangle"
          ? (base.properties.shape as ShapeKind)
          : "rectangle";

      return new ShapeAnnotation(
        base.id,
        base.pageId,
        ensureRect(raw.bounds),
        base.zIndex,
        base.createdAt,
        base.updatedAt,
        shape,
        Math.max(1, Math.round(ensureNumber(base.properties.strokeWidth ?? 2))),
        base.properties.filled === true,
        ensureColor(base.properties.strokeColor, "#1f2937"),
        ensureColor(base.properties.fillColor, "rgba(250, 204, 21, 0.25)"),
        base.objectMetadata,
      );
    }

    case "LINE": {
      const start = ensurePoint(base.properties.start);
      const end = ensurePoint(base.properties.end);

      return new LineAnnotation(
        base.id,
        base.pageId,
        start,
        end,
        base.zIndex,
        base.createdAt,
        base.updatedAt,
        base.properties.lineKind === "arrow" ? "arrow" : "line",
        Math.max(1, Math.round(ensureNumber(base.properties.strokeWidth ?? 2))),
        ensureColor(base.properties.color, "#1f2937"),
        base.objectMetadata,
      );
    }

    case "TABLE":
      return new TableAnnotation(
        base.id,
        base.pageId,
        ensureRect(raw.bounds),
        base.zIndex,
        base.createdAt,
        base.updatedAt,
        ensureIntRange(base.properties.rows, 1, 20),
        ensureIntRange(base.properties.columns, 1, 20),
        ensureColor(base.properties.strokeColor, "#1f2937"),
        Math.max(1, Math.round(ensureNumber(base.properties.strokeWidth ?? 1))),
        base.objectMetadata,
      );

    default:
      throw new Error(`Unsupported annotation type: ${raw.type}`);
  }
}
