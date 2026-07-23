import type { NormalizedPoint, NormalizedRect } from "@ggulnote/shared-types";
import type { LocalTextAxis, TextOrientation, TextQuad } from "@ggulnote/document-core";

export type { LocalTextAxis, NormalizedPoint, NormalizedRect, TextOrientation, TextQuad };

export const A4_PORTRAIT_POINTS = { width: 595.28, height: 841.89 } as const;
export type DocumentKind = "none" | "pdf" | "blank";

export interface DocumentDescriptor {
  id: string;
  kind: Exclude<DocumentKind, "none">;
  name: string;
  pageCount: number;
}

export interface PageDescriptor {
  id: string;
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PdfDocumentDescriptor extends DocumentDescriptor {
  kind: "pdf";
  fileSize: number;
}

export interface BlankDocumentDescriptor extends DocumentDescriptor {
  kind: "blank";
}

export type LoadedDocumentDescriptor = PdfDocumentDescriptor | BlankDocumentDescriptor;
export type TextDirection = "ltr" | "rtl" | "ttb";

export interface CanonicalViewportSnapshot {
  transform: [number, number, number, number, number, number];
  scale: number;
  rotation: number;
  width: number;
  height: number;
  viewBox: number[];
  userUnit?: number;
}

export interface RawPdfTextItemDebug {
  documentId: string;
  pageId: string;
  pageNumber: number;
  requestId: number;
  sourceIndex: number;
  str: string;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
  fontName: string;
  dir: string;
  hasEOL: boolean;
  style: {
    ascent: number | null;
    descent: number | null;
    vertical: boolean;
  };
  viewport: CanonicalViewportSnapshot;
  computed: {
    angle: number;
    fontHeight: number;
    fontAscent: number;
    x: number;
    y: number;
    width: number;
    height: number;
    normalizedBounds: NormalizedRect;
  };
}

export interface PageTextDebugSummary {
  documentId: string;
  pageId: string;
  pageNumber: number;
  requestId: number;
  viewportWidth: number;
  viewportHeight: number;
  viewportScale: number;
  viewportRotation: number;
  itemCount: number;
  emptyItemCount: number;
  invalidBoundsCount: number;
  rotatedItemCount: number;
  outOfPageBoundsCount: number;
  minX: number;
  minY: number;
  maxRight: number;
  maxBottom: number;
}

export interface PageTextItem {
  id: string;
  documentId: string;
  pageId: string;
  pageNumber: number;
  requestId: number;
  text: string;
  bounds: NormalizedRect;
  fontName?: string;
  fontSize?: number;
  direction?: TextDirection;
  sourceIndex: number;
  hasEOL: boolean;
  transform: [number, number, number, number, number, number];
  pdfWidth: number;
  pdfHeight: number;
  orientation: TextOrientation;
  axis: LocalTextAxis;
  quad: TextQuad;
  rawPdf: RawPdfTextItemDebug;
}

export interface PageTextContent {
  documentId: string;
  pageId: string;
  pageNumber: number;
  requestId: number;
  source: "extracted" | "memory-cache";
  viewport: CanonicalViewportSnapshot;
  items: PageTextItem[];
  rawItems: RawPdfTextItemDebug[];
  summary: PageTextDebugSummary;
}