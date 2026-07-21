import { LineKind, ShapeKind, type CreateAnnotationInput } from "./annotation-types";
import { LineAnnotation } from "./line-annotation";
import { HighlightAnnotation } from "./highlight-annotation";
import { ShapeAnnotation } from "./shape-annotation";
import { TableAnnotation } from "./table-annotation";
import { TextAnnotation } from "./text-annotation";
import { UnderlineAnnotation } from "./underline-annotation";
import { clampPoint, clampRectToBounds } from "../geometry/geometry-utils";
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

const makeId = (): AnnotationId => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
          14,
          "left",
        );
      }

      case "UNDERLINE": {
        const bounds = ensureBounds(input.bounds);

        return new UnderlineAnnotation(
          base.id,
          base.pageId,
          clampRectToBounds({ ...bounds }),
          base.zIndex,
          base.createdAt,
          base.updatedAt,
          2,
          "solid",
        );
      }

      case "HIGHLIGHT": {
        const bounds = ensureBounds(input.bounds);

        return new HighlightAnnotation(
          base.id,
          base.pageId,
          clampRectToBounds({ ...bounds }),
          base.zIndex,
          base.createdAt,
          base.updatedAt,
          0.35,
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
          2,
          false,
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
          2,
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
