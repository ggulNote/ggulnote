import { ShapeKind } from "../annotations/annotation-types";
import type { Annotation } from "../annotations/annotation";
import { TextAnnotation } from "../annotations/text-annotation";
import { UnderlineAnnotation } from "../annotations/underline-annotation";
import { HighlightAnnotation } from "../annotations/highlight-annotation";
import { ShapeAnnotation } from "../annotations/shape-annotation";
import { LineAnnotation } from "../annotations/line-annotation";
import { TableAnnotation } from "../annotations/table-annotation";
import type { SerializedAnnotation } from "./serialized-annotation";

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

const ensureNumber = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Invalid number");
  }

  return value;
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

const ensureObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object") {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
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
        ensureNumber(base.properties.fontSize ?? 14),
        base.properties.textAlign === "center" || base.properties.textAlign === "right"
          ? (base.properties.textAlign as "center" | "right")
          : "left",
      );

    case "UNDERLINE":
      return new UnderlineAnnotation(
        base.id,
        base.pageId,
        ensureRect(raw.bounds),
        base.zIndex,
        base.createdAt,
        base.updatedAt,
        ensureNumber(base.properties.thickness ?? 1),
        base.properties.lineStyle === "double" || base.properties.lineStyle === "wavy" ? (base.properties.lineStyle as "double" | "wavy") : "solid",
      );

    case "HIGHLIGHT":
      return new HighlightAnnotation(
        base.id,
        base.pageId,
        ensureRect(raw.bounds),
        base.zIndex,
        base.createdAt,
        base.updatedAt,
        ensureNumber(base.properties.opacity ?? 0.35),
      );

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
        ensureNumber(base.properties.strokeWidth ?? 2),
        base.properties.filled === true,
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
        ensureNumber(base.properties.strokeWidth ?? 2),
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
      );

    default:
      throw new Error(`Unsupported annotation type: ${raw.type}`);
  }
}
