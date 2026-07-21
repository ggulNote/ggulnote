export const A4_PORTRAIT_POINTS = {
  width: 595.28,
  height: 841.89,
} as const;

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

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageTextItem {
  id: string;
  text: string;
  bounds: NormalizedRect;
  fontName?: string;
  direction?: string;
}

export interface PageTextContent {
  pageNumber: number;
  items: PageTextItem[];
}
