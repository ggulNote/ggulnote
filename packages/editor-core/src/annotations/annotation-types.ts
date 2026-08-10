import type { NormalizedRect, PageId } from "@ggulnote/shared-types";

export const MAX_ANNOTATION_RECT_COUNT = 256;

export const DEFAULT_ANNOTATION_STYLE = {
  stroke: "#1f2937",
  text: "#111827",
  highlight: "rgba(250, 204, 21, 0.35)",
  selection: "#2563eb",
} as const;

export type AnnotationType = "TEXT" | "UNDERLINE" | "HIGHLIGHT" | "SHAPE" | "LINE" | "TABLE";
export type LineKind = "line" | "arrow";
export type ShapeKind = "rectangle" | "ellipse";
export type TextFontWeight = "normal" | "bold";

export interface AnnotationStyleDefaults {
  strokeColor: string;
  fillColor: string;
  textColor: string;
  textFontFamily: string;
  textFontSize: number;
  textFontWeight: TextFontWeight;
  shapeStrokeWidth: number;
  lineStrokeWidth: number;
  tableStrokeWidth: number;
  underlineThickness: number;
  highlightColor: string;
  highlightOpacity: number;
}

export const DEFAULT_ANNOTATION_STYLE_PROPS: AnnotationStyleDefaults = {
  strokeColor: "#1f2937",
  fillColor: "rgba(250, 204, 21, 0.25)",
  textColor: "#111827",
  textFontFamily: "Arial",
  textFontSize: 14,
  textFontWeight: "normal",
  shapeStrokeWidth: 2,
  lineStrokeWidth: 2,
  tableStrokeWidth: 1,
  underlineThickness: 2,
  highlightColor: "#facc15",
  highlightOpacity: 0.35,
};

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
      textColor?: string;
      textFontFamily?: string;
      textFontSize?: number;
      textFontWeight?: TextFontWeight;
    }
  | {
      type: "UNDERLINE";
      pageId: PageId;
      bounds: NormalizedRect;
      rects?: readonly NormalizedRect[];
      color?: string;
      thickness?: number;
      lineStyle?: "solid" | "double" | "wavy";
    }
  | {
      type: "HIGHLIGHT";
      pageId: PageId;
      bounds: NormalizedRect;
      rects?: readonly NormalizedRect[];
      color?: string;
      opacity?: number;
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
      strokeColor?: string;
      fillColor?: string;
      strokeWidth?: number;
      filled?: boolean;
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
      color?: string;
      strokeWidth?: number;
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
      strokeColor?: string;
      strokeWidth?: number;
    };
