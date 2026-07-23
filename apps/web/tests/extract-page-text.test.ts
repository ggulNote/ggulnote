import { describe, expect, it } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { extractPageTextContent } from "../src/features/document/text/extract-page-text";

describe("extractPageTextContent", () => {
  it("uses PDF.js TextItem width instead of the transform font scale", async () => {
    const page = {
      getTextContent: async () => ({
        items: [{
          str: "a long text item",
          transform: [10, 0, 0, 10, 60, 700],
          width: 240,
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
    expect(item?.bounds.x).toBeCloseTo(0.1);
    expect(item?.bounds.y).toBeCloseTo(0.1125);
    expect(item?.bounds.width).toBeCloseTo(0.4);
    expect(item?.bounds.height).toBeCloseTo(0.0125);
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
