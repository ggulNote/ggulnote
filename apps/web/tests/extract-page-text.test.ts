import { describe, expect, it } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type { CanonicalViewportSnapshot } from "../src/features/document/model/document-types";
import {
  computePdfTextItemGeometry,
  createPageScopedTextItemId,
  extractPageTextContent,
  isValidBounds,
  type PdfTextItemGeometryInput,
} from "../src/features/document/text/extract-page-text";

const horizontalItem: PdfTextItemGeometryInput = {
  str: "a long text item",
  transform: [10, 0, 0, 10, 60, 700],
  width: 240,
  height: 10,
  fontName: "Arial",
  dir: "ltr",
  hasEOL: true,
};

const viewport = (scale = 1, rotation = 0): CanonicalViewportSnapshot => ({
  transform: rotation === 90 ? [0, scale, scale, 0, 0, 0] : [scale, 0, 0, -scale, 0, 800 * scale],
  scale,
  rotation,
  width: (rotation === 90 ? 800 : 600) * scale,
  height: (rotation === 90 ? 600 : 800) * scale,
  viewBox: [0, 0, 600, 800],
});

const createPage = ({
  items = [horizontalItem],
  styles = { Arial: { ascent: 0.8, descent: -0.2, vertical: false } },
  pageViewport = viewport(),
  rotate = pageViewport.rotation,
}: {
  items?: PdfTextItemGeometryInput[];
  styles?: Record<string, { ascent?: number; descent?: number; vertical?: boolean }>;
  pageViewport?: CanonicalViewportSnapshot;
  rotate?: number;
} = {}): PDFPageProxy => ({
  rotate,
  userUnit: 1,
  getViewport: ({ scale, rotation }: { scale: number; rotation?: number }) => {
    expect(scale).toBe(1);
    expect(rotation).toBe(rotate);
    return {
      ...pageViewport,
      clone: () => pageViewport,
      convertToViewportPoint: () => [0, 0],
      convertToViewportRectangle: () => [0, 0, 0, 0],
      convertToPdfPoint: () => [0, 0],
      rawDims: {
        pageWidth: pageViewport.width,
        pageHeight: pageViewport.height,
        pageX: 0,
        pageY: 0,
      },
    };
  },
  getTextContent: async () => ({ items, styles, lang: null }),
}) as unknown as PDFPageProxy;

describe("PDF Text Item canonical geometry", () => {
  it("produces identical normalized bounds at viewport scale 1 and 2", () => {
    const atScaleOne = computePdfTextItemGeometry(horizontalItem, { ascent: 0.8 }, viewport(1));
    const atScaleTwo = computePdfTextItemGeometry(horizontalItem, { ascent: 0.8 }, viewport(2));
    expect(atScaleOne?.bounds).toEqual(atScaleTwo?.bounds);
  });

  it("uses each page viewport independently", () => {
    const small = computePdfTextItemGeometry(horizontalItem, { ascent: 0.8 }, viewport());
    const largePage = computePdfTextItemGeometry(horizontalItem, { ascent: 0.8 }, {
      ...viewport(),
      width: 1200,
      height: 1600,
      transform: [1, 0, 0, -1, 0, 1600],
      viewBox: [0, 0, 1200, 1600],
    });
    expect(small?.bounds.width).toBeCloseTo(0.4);
    expect(largePage?.bounds.width).toBeCloseTo(0.2);
  });

  it("matches PDF.js ascent-based top and width calculation", () => {
    const geometry = computePdfTextItemGeometry(horizontalItem, { ascent: 0.9 }, viewport());
    expect(geometry?.pixelBounds.x).toBeCloseTo(60);
    expect(geometry?.pixelBounds.y).toBeCloseTo(91);
    expect(geometry?.pixelBounds.width).toBeCloseTo(240);
    expect(geometry?.pixelBounds.height).toBeCloseTo(10);
    expect(geometry?.bounds.y).toBeCloseTo(91 / 800);
  });

  it("applies page rotation through the canonical viewport transform", () => {
    const geometry = computePdfTextItemGeometry(horizontalItem, { ascent: 0.8 }, viewport(1, 90));
    expect(geometry?.angle).toBeCloseTo(Math.PI / 2);
    expect(geometry?.pixelBounds.width).toBeCloseTo(10);
    expect(geometry?.pixelBounds.height).toBeCloseTo(240);
  });

  it("preserves a rotated Text Item using a quad envelope", () => {
    const rotated = computePdfTextItemGeometry({
      ...horizontalItem,
      str: "arXiv:1234.5678",
      transform: [0, 10, -10, 0, 30, 600],
      width: 200,
    }, { ascent: 0.8 }, viewport());
    expect(rotated?.orientation.writingMode).toBe("rotated");
    expect(rotated?.angle).toBeCloseTo(-Math.PI / 2);
    expect(rotated?.quad.points).toHaveLength(4);
  });

  it("rejects non-finite and zero-size bounds", () => {
    expect(isValidBounds({ x: 0, y: 0, width: 0, height: 1 })).toBe(false);
    expect(isValidBounds({ x: Number.NaN, y: 0, width: 1, height: 1 })).toBe(false);
    expect(isValidBounds({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 })).toBe(false);
  });
});

describe("extractPageTextContent page isolation", () => {
  it("keeps viewport, styles and items in one page-scoped result", async () => {
    const content = await extractPageTextContent(createPage(), {
      documentId: "doc-a",
      pageId: "doc-a-page-2",
      pageNumber: 2,
      requestId: 7,
    });
    const item = content.items[0];
    expect(content.viewport.scale).toBe(1);
    expect(content.summary.pageNumber).toBe(2);
    expect(item?.id).toBe(createPageScopedTextItemId("doc-a", "doc-a-page-2", 0));
    expect(item?.rawPdf.style.ascent).toBe(0.8);
    expect(item?.documentId).toBe("doc-a");
    expect(item?.pageId).toBe("doc-a-page-2");
  });

  it("does not collide when sourceIndex is zero on another page or document", async () => {
    const pageOne = await extractPageTextContent(createPage(), { documentId: "doc-a", pageId: "doc-a-page-1", pageNumber: 1, requestId: 1 });
    const pageTwo = await extractPageTextContent(createPage(), { documentId: "doc-a", pageId: "doc-a-page-2", pageNumber: 2, requestId: 2 });
    const otherDocument = await extractPageTextContent(createPage(), { documentId: "doc-b", pageId: "doc-b-page-1", pageNumber: 1, requestId: 3 });
    expect(new Set([pageOne.items[0]?.id, pageTwo.items[0]?.id, otherDocument.items[0]?.id]).size).toBe(3);
  });

  it("uses only the styles returned with the requested page", async () => {
    const first = await extractPageTextContent(createPage({ styles: { Arial: { ascent: 0.9 } } }), { documentId: "doc", pageId: "doc-page-1", pageNumber: 1, requestId: 1 });
    const second = await extractPageTextContent(createPage({ styles: { Arial: { ascent: 0.5 } } }), { documentId: "doc", pageId: "doc-page-2", pageNumber: 2, requestId: 2 });
    expect(first.items[0]?.bounds.y).toBeCloseTo(91 / 800);
    expect(second.items[0]?.bounds.y).toBeCloseTo(95 / 800);
  });

  it("counts whitespace and invalid items without creating visual Text Items", async () => {
    const content = await extractPageTextContent(createPage({
      items: [
        { ...horizontalItem, str: "   " },
        { ...horizontalItem, str: "invalid", width: 0 },
      ],
    }), { documentId: "doc", pageId: "doc-page-1", pageNumber: 1, requestId: 1 });
    expect(content.items).toEqual([]);
    expect(content.summary.emptyItemCount).toBe(1);
    expect(content.summary.invalidBoundsCount).toBe(1);
  });
});