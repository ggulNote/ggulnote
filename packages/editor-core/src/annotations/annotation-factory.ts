import { LineKind, ShapeKind, type CreateAnnotationInput, DEFAULT_ANNOTATION_STYLE_PROPS, TextFontWeight } from "./annotation-types";
import { LineAnnotation } from "./line-annotation";
import { HighlightAnnotation } from "./highlight-annotation";
import { ShapeAnnotation } from "./shape-annotation";
import { TableAnnotation } from "./table-annotation";
import { TextAnnotation } from "./text-annotation";
import { UnderlineAnnotation } from "./underline-annotation";
import { clampPoint, clampRectToBounds } from "../geometry/geometry-utils";
import { normalizeAnnotationRects, unionAnnotationRects } from "../geometry/multi-rect-geometry";
import type { AnnotationId, PageId, NormalizedPoint, NormalizedRect } from "@ggulnote/shared-types";
import type { Annotation } from "./annotation";

const ensureNumber = (value: unknown, name: string): number => {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`Invalid ${name}`);
  }

  return value;
};

const ensureBounds = (bounds: NormalizedRect): NormalizedRect => ({
  x: clampPoint({ x: ensureNumber(bounds.x, "bounds.x"), y: 0 }).x,
  y: clampPoint({ x: 0, y: ensureNumber(bounds.y, "bounds.y") }).y,
  width: ensureNumber(bounds.width, "bounds.width"),
  height: ensureNumber(bounds.height, "bounds.height"),
});

const ensurePoint = (point: NormalizedPoint): NormalizedPoint => {
  return {
    x: ensureNumber(point.x, "point.x"),
    y: ensureNumber(point.y, "point.y"),
  };
};

const normalizeLinePoint = (point: { x: number; y: number }): NormalizedPoint => ({
  x: clampPoint(ensurePoint(point)).x,
  y: clampPoint({ x: 0, y: ensurePoint(point).y }).y,
});

const ensureRowsColumns = (value: number, label: string): number => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error(`Invalid ${label}`);
  }

  return value;
};

const ensureTextColor = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
};

const ensureFontFamily = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
};

const ensureFontWeight = (value: unknown, fallback: TextFontWeight): TextFontWeight => {
  return value === "bold" || value === "normal" ? value : fallback;
};

const ensureOpacity = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, value));
};

const ensureLineStyle = (value: unknown): "solid" | "double" | "wavy" => {
  return value === "double" || value === "wavy" ? value : "solid";
};

const normalizeColorWithAlpha = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
};

export interface AnnotationFactoryOptions {
  idGenerator?: () => AnnotationId;
  now?: () => number;
}

export class AnnotationFactory {
  private readonly idGenerator: () => AnnotationId;
  private readonly now: () => number;

  public constructor(options: AnnotationFactoryOptions = {}) {
    this.idGenerator = options.idGenerator ?? makeId;
    this.now = options.now ?? (() => Date.now());
  }

  public create(input: CreateAnnotationInput): Annotation {
    const timestamp = this.now();
    if (!Number.isFinite(timestamp)) {
      throw new Error("Invalid timestamp");
    }

    const id = this.idGenerator();
    const base = {
      id,
      pageId: input.pageId,
      createdAt: timestamp,
      updatedAt: timestamp,
      zIndex: timestamp,
    };

    switch (input.type) {
      case "TEXT": {
        const bounds = ensureBounds(input.bounds);

        return new TextAnnotation(
          base.id,
          base.pageId,
          clampRectToBounds({ ...bounds }),
          base.zIndex,
          base.createdAt,
          base.updatedAt,
          input.text?.trim() === "" ? "memo" : input.text,
          ensureNumber(input.textFontSize ?? DEFAULT_ANNOTATION_STYLE_PROPS.textFontSize, "textFontSize"),
          "left",
          ensureTextColor(input.textColor, DEFAULT_ANNOTATION_STYLE_PROPS.textColor),
          ensureFontFamily(input.textFontFamily, DEFAULT_ANNOTATION_STYLE_PROPS.textFontFamily),
          ensureFontWeight(input.textFontWeight, DEFAULT_ANNOTATION_STYLE_PROPS.textFontWeight),
        );
      }

      case "UNDERLINE": {
        const rects = input.rects === undefined
          ? undefined
          : normalizeAnnotationRects(input.rects);
        const bounds = rects === undefined
          ? clampRectToBounds({ ...ensureBounds(input.bounds) })
          : unionAnnotationRects(rects);

        return new UnderlineAnnotation(
          base.id,
          base.pageId,
          bounds,
          base.zIndex,
          base.createdAt,
          base.updatedAt,
          Math.round(ensureNumber(input.thickness ?? DEFAULT_ANNOTATION_STYLE_PROPS.underlineThickness, "underline.thickness")),
          ensureLineStyle(input.lineStyle),
          normalizeColorWithAlpha(input.color, DEFAULT_ANNOTATION_STYLE_PROPS.strokeColor),
          rects,
        );
      }

      case "HIGHLIGHT": {
        const rects = input.rects === undefined
          ? undefined
          : normalizeAnnotationRects(input.rects);
        const bounds = rects === undefined
          ? clampRectToBounds({ ...ensureBounds(input.bounds) })
          : unionAnnotationRects(rects);

        return new HighlightAnnotation(
          base.id,
          base.pageId,
          bounds,
          base.zIndex,
          base.createdAt,
          base.updatedAt,
          ensureOpacity(input.opacity, DEFAULT_ANNOTATION_STYLE_PROPS.highlightOpacity),
          normalizeColorWithAlpha(input.color, DEFAULT_ANNOTATION_STYLE_PROPS.highlightColor),
          rects,
        );
      }

      case "SHAPE": {
        const bounds = ensureBounds(input.bounds);

        if (input.shape !== "rectangle" && input.shape !== "ellipse") {
          throw new Error("Invalid shape");
        }

        return new ShapeAnnotation(
          base.id,
          base.pageId,
          clampRectToBounds({ ...bounds }),
          base.zIndex,
          base.createdAt,
          base.updatedAt,
          input.shape,
          Math.max(1, Math.round(ensureNumber(input.strokeWidth ?? DEFAULT_ANNOTATION_STYLE_PROPS.shapeStrokeWidth, "shape.strokeWidth"))),
          input.filled ?? false,
          normalizeColorWithAlpha(input.strokeColor, DEFAULT_ANNOTATION_STYLE_PROPS.strokeColor),
          normalizeColorWithAlpha(input.fillColor, DEFAULT_ANNOTATION_STYLE_PROPS.fillColor),
        );
      }

      case "LINE": {
        const start = normalizeLinePoint(input.start);
        const end = normalizeLinePoint(input.end);

        return new LineAnnotation(
          base.id,
          base.pageId,
          start,
          end,
          base.zIndex,
          base.createdAt,
          base.updatedAt,
          input.lineKind === "arrow" ? "arrow" : "line",
          Math.max(1, Math.round(ensureNumber(input.strokeWidth ?? DEFAULT_ANNOTATION_STYLE_PROPS.lineStrokeWidth, "line.strokeWidth"))),
          normalizeColorWithAlpha(input.color, DEFAULT_ANNOTATION_STYLE_PROPS.strokeColor),
        );
      }

      case "TABLE": {
        const bounds = ensureBounds(input.bounds);

        return new TableAnnotation(
          base.id,
          base.pageId,
          clampRectToBounds({ ...bounds }),
          base.zIndex,
          base.createdAt,
          base.updatedAt,
          ensureRowsColumns(input.rows, "rows"),
          ensureRowsColumns(input.columns, "columns"),
          normalizeColorWithAlpha(input.strokeColor, DEFAULT_ANNOTATION_STYLE_PROPS.strokeColor),
          Math.max(1, Math.round(ensureNumber(input.strokeWidth ?? DEFAULT_ANNOTATION_STYLE_PROPS.tableStrokeWidth, "table.strokeWidth"))),
        );
      }

      default: {
        const never: never = input;
        throw new Error(`Unsupported annotation type: ${(never as { type?: string }).type}`);
      }
    }
  }
}

export const createAnnotationDefaultStyle = {
  text: "#111827",
  stroke: "#1f2937",
};

function makeId(): AnnotationId {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
