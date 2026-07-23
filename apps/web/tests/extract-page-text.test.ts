import { describe, expect, it } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { extractPageTextContent } from "../src/features/document/text/extract-page-text";

describe("extractPageTextContent", () => {
  it("uses PDF.js TextItem width and preserves source geometry", async () => {
    const page = {
      getTextContent: async () => ({
        items: [{
          str: "a long text item",
          transform: [10, 0, 0, 10, 60, 700],
          width: 240,
          height: 10,
          fontName: "Arial",
          dir: "ltr",
          hasEOL: true,
        }],
        styles: {},
        lang: null,
      }),
    } as unknown as PDFPageProxy;

    const content = await extractPageTextContent(page, 1, { width: 600, height: 800 });
    const item = content.items[0];

    expect(item?.bounds).toEqual(expect.objectContaining({
      x: expect.closeTo(0.1),
      y: expect.closeTo(0.1125),
      width: expect.closeTo(0.4),
      height: expect.closeTo(0.0125),
    }));
    expect(item?.pdfWidth).toBe(240);
    expect(item?.pdfHeight).toBe(10);
    expect(item?.transform).toEqual([10, 0, 0, 10, 60, 700]);
    expect(item?.orientation.writingMode).toBe("horizontal");
    expect(item?.axis.advanceX).toBeCloseTo(1);
    expect(item?.axis.advanceY).toBeCloseTo(0);
    expect(item?.hasEOL).toBe(true);
  });

  it("preserves a 90 degree Text Item and its local baseline", async () => {
    const page = {
      getTextContent: async () => ({
        items: [{
          str: "arXiv:1234.5678",
          transform: [0, 10, -10, 0, 30, 600],
          width: 200,
          height: 10,
          fontName: "Arial",
          dir: "ltr",
          hasEOL: false,
        }],
        styles: {},
        lang: null,
      }),
    } as unknown as PDFPageProxy;

    const content = await extractPageTextContent(page, 1, { width: 600, height: 800 });
    const item = content.items[0];

    expect(item).toBeDefined();
    expect(item?.orientation.writingMode).toBe("rotated");
    expect(item?.orientation.angle).toBeCloseTo(Math.PI / 2);
    expect(item?.axis.advanceX).toBeCloseTo(0);
    expect(item?.axis.advanceY).toBeLessThan(-0.99);
    expect(item?.bounds.height).toBeCloseTo(0.25);
    expect(item?.quad.points).toHaveLength(4);
  });

  it("ignores whitespace-only and zero-size text items", async () => {
    const page = {
      getTextContent: async () => ({
        items: [
          { str: "   ", transform: [10, 0, 0, 10, 0, 0], width: 20, height: 10 },
          { str: "ghost", transform: [0, 0, 0, 0, 0, 0], width: 0, height: 0 },
        ],
        styles: {},
        lang: null,
      }),
    } as unknown as PDFPageProxy;

    const content = await extractPageTextContent(page, 1, { width: 600, height: 800 });
    expect(content.items).toEqual([]);
  });
});
