import type { PageId } from "@ggulnote/shared-types";

export const DEFAULT_ANNOTATION_STYLE = {
  stroke: "#1f2937",
  text: "#111827",
  highlight: "rgba(250, 204, 21, 0.35)",
  selection: "#2563eb",
} as const;

export type AnnotationType = "TEXT" | "UNDERLINE" | "HIGHLIGHT" | "SHAPE" | "LINE" | "TABLE";
export type LineKind = "line" | "arrow";
export type ShapeKind = "rectangle" | "ellipse";

export type CreateAnnotationInput =
  | {
      type: "TEXT";
      pageId: PageId;
      bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      text: string;
    }
  | {
      type: "UNDERLINE";
      pageId: PageId;
      bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    }
  | {
      type: "HIGHLIGHT";
      pageId: PageId;
      bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    }
  | {
      type: "SHAPE";
      pageId: PageId;
      bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      shape: ShapeKind;
    }
  | {
      type: "LINE";
      pageId: PageId;
      start: {
        x: number;
        y: number;
      };
      end: {
        x: number;
        y: number;
      };
      lineKind: LineKind;
    }
  | {
      type: "TABLE";
      pageId: PageId;
      bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      rows: number;
      columns: number;
    };
