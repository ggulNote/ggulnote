import type { PageSemanticModelData } from "@ggulnote/document-core";
import { PageSemanticModel } from "@ggulnote/document-core";
import type { Rect } from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import { buildCanonicalTextStream, resolveTextSpanWithCanonicalStream } from "./canonical-text-stream";

const ORIENTATION = { angle: 0, writingMode: "horizontal" } as const;
const AXIS = { advanceX: 8, advanceY: 0, normalX: 0, normalY: 1 } as const;

function buildWord(params: {
  id: string;
  text: string;
  lineId: string;
  readingOrder: number;
  bounds: Rect;
  startOffset: number;
  endOffset: number;
  hasEOL?: boolean;
}): PageSemanticModelData["words"][number] {
  return {
    id: params.id,
    type: "WORD",
    pageId: "page-1",
    text: params.text,
    normalizedText: params.text,
    bounds: {
      x: params.bounds.x,
      y: params.bounds.y,
      width: params.bounds.width,
      height: params.bounds.height,
    },
    readingOrder: params.readingOrder,
    confidence: 1,
    orientation: { ...ORIENTATION },
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    sourceItemIds: [params.id],
    sourceRanges: [{
      sourceTextItemId: params.id,
      startOffset: params.startOffset,
      endOffset: params.endOffset,
    }],
    lineId: params.lineId,
    direction: "ltr",
    startsWithPunctuation: false,
    endsWithPunctuation: false,
    hasEOL: params.hasEOL ?? false,
    axis: { ...AXIS },
    quad: {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    },
  };
}

function buildLine(params: {
  id: string;
  text: string;
  readingOrder: number;
  wordIds: readonly string[];
  bounds: Rect;
  paragraphId: string | null;
  hasEOL?: boolean;
}): PageSemanticModelData["lines"][number] {
  return {
    id: params.id,
    type: "LINE",
    pageId: "page-1",
    text: params.text,
    normalizedText: params.text,
    bounds: {
      x: params.bounds.x,
      y: params.bounds.y,
      width: params.bounds.width,
      height: params.bounds.height,
    },
    readingOrder: params.readingOrder,
    confidence: 1,
    orientation: { ...ORIENTATION },
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    wordIds: [...params.wordIds],
    paragraphId: params.paragraphId,
    baseline: params.hasEOL ? 0 : 0,
    direction: "ltr",
    columnIndex: 0,
    axis: { ...AXIS },
    horizontalGaps: [],
  };
}

function buildSentence(params: {
  id: string;
  text: string;
  readingOrder: number;
  wordIds: readonly string[];
  lineIds: readonly string[];
  paragraphId: string;
  bounds: Rect;
}): PageSemanticModelData["sentences"][number] {
  return {
    id: params.id,
    type: "SENTENCE",
    pageId: "page-1",
    text: params.text,
    normalizedText: params.text,
    bounds: {
      x: params.bounds.x,
      y: params.bounds.y,
      width: params.bounds.width,
      height: params.bounds.height,
    },
    readingOrder: params.readingOrder,
    confidence: 1,
    orientation: { ...ORIENTATION },
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    wordIds: [...params.wordIds],
    lineIds: [...params.lineIds],
    paragraphId: params.paragraphId,
    startWordId: params.wordIds[0] ?? "",
    endWordId: params.wordIds.at(-1) ?? "",
    fragments: [{
      x: params.bounds.x,
      y: params.bounds.y,
      width: params.bounds.width,
      height: params.bounds.height,
    }],
  };
}

function buildParagraph(params: {
  id: string;
  text: string;
  readingOrder: number;
  lineIds: readonly string[];
  sentenceIds: readonly string[];
  bounds: Rect;
}): PageSemanticModelData["paragraphs"][number] {
  return {
    id: params.id,
    type: "PARAGRAPH",
    pageId: "page-1",
    text: params.text,
    normalizedText: params.text,
    bounds: {
      x: params.bounds.x,
      y: params.bounds.y,
      width: params.bounds.width,
      height: params.bounds.height,
    },
    readingOrder: params.readingOrder,
    confidence: 1,
    orientation: { ...ORIENTATION },
    regionId: "region-1",
    blockId: "block-1",
    columnId: "column-1",
    lineIds: [...params.lineIds],
    sentenceIds: [...params.sentenceIds],
    columnIndex: 0,
    averageFontSize: 12,
    fragments: [{
      x: params.bounds.x,
      y: params.bounds.y,
      width: params.bounds.width,
      height: params.bounds.height,
    }],
  };
}

function buildModel(data: Omit<
  PageSemanticModelData,
  "schemaVersion" | "extractorVersion" | "documentId" | "pageId" |
  "pageNumber" | "sourceSignature" | "semanticSource" | "readingOrder" |
  "createdAt" | "sourceItemCount" | "processingDurationMs" | "unassignedWords"
> & {
  unassignedWords?: PageSemanticModelData["unassignedWords"];
}): PageSemanticModel {
  return new PageSemanticModel({
    schemaVersion: 1,
    extractorVersion: "test",
    documentId: "doc-1",
    pageId: "page-1",
    pageNumber: 1,
    sourceSignature: "test-signature",
    semanticSource: "legacy-semantic-fallback",
    readingOrder: [...data.words.map((word) => word.id)],
    createdAt: 1,
    sourceItemCount: 0,
    processingDurationMs: 0,
    ...data,
    unassignedWords: data.unassignedWords ?? [],
  });
}

function unionRectangles(rects: readonly Rect[]): Rect {
  return rects.reduce((acc, rect) => ({
    x: Math.min(acc.x, rect.x),
    y: Math.min(acc.y, rect.y),
    width: Math.max(acc.x + acc.width, rect.x + rect.width) - Math.min(acc.x, rect.x),
    height: Math.max(acc.y + acc.height, rect.y + rect.height) - Math.min(acc.y, rect.y),
  }));
}

describe("canonical-text-stream", () => {
  it("resolves a single-line exact text span with normalization", () => {
    const words = [
      buildWord({
        id: "word-1",
        text: "The",
        lineId: "line-1",
        readingOrder: 1,
        bounds: { x: 0, y: 10, width: 24, height: 20 },
        startOffset: 0,
        endOffset: 3,
      }),
      buildWord({
        id: "word-2",
        text: "entire",
        lineId: "line-1",
        readingOrder: 2,
        bounds: { x: 30, y: 10, width: 46, height: 20 },
        startOffset: 4,
        endOffset: 10,
      }),
      buildWord({
        id: "word-3",
        text: "process",
        lineId: "line-1",
        readingOrder: 3,
        bounds: { x: 80, y: 10, width: 60, height: 20 },
        startOffset: 11,
        endOffset: 18,
      }),
      buildWord({
        id: "word-4",
        text: "is",
        lineId: "line-1",
        readingOrder: 4,
        bounds: { x: 145, y: 10, width: 15, height: 20 },
        startOffset: 19,
        endOffset: 21,
      }),
      buildWord({
        id: "word-5",
        text: "simple.",
        lineId: "line-1",
        readingOrder: 5,
        bounds: { x: 165, y: 10, width: 55, height: 20 },
        startOffset: 22,
        endOffset: 29,
        hasEOL: true,
      }),
    ];
    const model = buildModel({
      words,
      lines: [
        buildLine({
          id: "line-1",
          text: words.map((entry) => entry.text).join(" "),
          readingOrder: 1,
          wordIds: words.map((entry) => entry.id),
          paragraphId: "paragraph-1",
          bounds: { x: 0, y: 10, width: 225, height: 20 },
          hasEOL: true,
        }),
      ],
      layoutRegions: [],
      layoutBlocks: [],
      columns: [],
      sentences: [
        buildSentence({
          id: "sentence-1",
          text: words.map((entry) => entry.text).join(" "),
          readingOrder: 1,
          wordIds: words.map((entry) => entry.id),
          lineIds: ["line-1"],
          paragraphId: "paragraph-1",
          bounds: { x: 0, y: 10, width: 225, height: 20 },
        }),
      ],
      paragraphs: [
        buildParagraph({
          id: "paragraph-1",
          text: words.map((entry) => entry.text).join(" "),
          readingOrder: 1,
          lineIds: ["line-1"],
          sentenceIds: ["sentence-1"],
          bounds: { x: 0, y: 10, width: 225, height: 20 },
        }),
      ],
    });
    const stream = buildCanonicalTextStream({
      semanticModel: model,
      pageId: "page-1",
      boundsBySourceObjectId: new Map(
        words.map((word) => [word.id, { ...word.bounds }] as const),
      ),
    });
    const resolution = resolveTextSpanWithCanonicalStream(stream, {
      kind: "text_span",
      startAnchor: "EntIRe",
      endAnchor: "simple",
    });

    expect(resolution).toMatchObject({ status: "RESOLVED" });
    if (resolution.status !== "RESOLVED") throw new Error("Expected resolved.");
    expect(resolution.text).toBe("entire process is simple.");
    expect(resolution.bounds).toHaveLength(1);
    expect(resolution.bounds[0]).toEqual(unionRectangles(words.slice(1).map((word) => word.bounds)));
  });

  it("materializes multi-line span as per-line unioned bounds", () => {
    const words = [
      buildWord({
        id: "line1-word-1",
        text: "Moreover",
        lineId: "line-1",
        readingOrder: 1,
        bounds: { x: 0, y: 0, width: 56, height: 18 },
        startOffset: 0,
        endOffset: 8,
      }),
      buildWord({
        id: "line1-word-2",
        text: "from",
        lineId: "line-1",
        readingOrder: 2,
        bounds: { x: 62, y: 0, width: 34, height: 18 },
        startOffset: 9,
        endOffset: 13,
      }),
      buildWord({
        id: "line1-word-3",
        text: "modern",
        lineId: "line-1",
        readingOrder: 3,
        bounds: { x: 100, y: 0, width: 48, height: 18 },
        startOffset: 14,
        endOffset: 20,
      }),
      buildWord({
        id: "line1-word-4",
        text: "neural",
        lineId: "line-1",
        readingOrder: 4,
        bounds: { x: 152, y: 0, width: 46, height: 18 },
        startOffset: 21,
        endOffset: 27,
      }),
      buildWord({
        id: "line2-word-1",
        text: "for",
        lineId: "line-2",
        readingOrder: 5,
        bounds: { x: 0, y: 24, width: 25, height: 18 },
        startOffset: 28,
        endOffset: 31,
      }),
      buildWord({
        id: "line2-word-2",
        text: "instance",
        lineId: "line-2",
        readingOrder: 6,
        bounds: { x: 32, y: 24, width: 62, height: 18 },
        startOffset: 32,
        endOffset: 40,
      }),
      buildWord({
        id: "line2-word-3",
        text: "model",
        lineId: "line-2",
        readingOrder: 7,
        bounds: { x: 98, y: 24, width: 45, height: 18 },
        startOffset: 41,
        endOffset: 46,
      }),
    ];
    const line1 = [
      words[0],
      words[1],
      words[2],
      words[3],
    ];
    const line2 = [
      words[4],
      words[5],
      words[6],
    ];
    const model = buildModel({
      words,
      lines: [
        buildLine({
          id: "line-1",
          text: line1.map((entry) => entry.text).join(" "),
          readingOrder: 1,
          wordIds: line1.map((entry) => entry.id),
          paragraphId: "paragraph-1",
          bounds: { x: 0, y: 0, width: 198, height: 18 },
        }),
        buildLine({
          id: "line-2",
          text: line2.map((entry) => entry.text).join(" "),
          readingOrder: 2,
          wordIds: line2.map((entry) => entry.id),
          paragraphId: "paragraph-2",
          bounds: { x: 0, y: 24, width: 143, height: 18 },
        }),
      ],
      layoutRegions: [],
      layoutBlocks: [],
      columns: [],
      sentences: [
        buildSentence({
          id: "sentence-1",
          text: line1.map((entry) => entry.text).join(" "),
          readingOrder: 1,
          wordIds: line1.map((entry) => entry.id),
          lineIds: ["line-1"],
          paragraphId: "paragraph-1",
          bounds: { x: 0, y: 0, width: 198, height: 18 },
        }),
        buildSentence({
          id: "sentence-2",
          text: line2.map((entry) => entry.text).join(" "),
          readingOrder: 2,
          wordIds: line2.map((entry) => entry.id),
          lineIds: ["line-2"],
          paragraphId: "paragraph-2",
          bounds: { x: 0, y: 24, width: 143, height: 18 },
        }),
      ],
      paragraphs: [
        buildParagraph({
          id: "paragraph-1",
          text: line1.map((entry) => entry.text).join(" "),
          readingOrder: 1,
          lineIds: ["line-1"],
          sentenceIds: ["sentence-1"],
          bounds: { x: 0, y: 0, width: 198, height: 18 },
        }),
        buildParagraph({
          id: "paragraph-2",
          text: line2.map((entry) => entry.text).join(" "),
          readingOrder: 2,
          lineIds: ["line-2"],
          sentenceIds: ["sentence-2"],
          bounds: { x: 0, y: 24, width: 143, height: 18 },
        }),
      ],
    });
    const stream = buildCanonicalTextStream({
      semanticModel: model,
      pageId: "page-1",
      boundsBySourceObjectId: new Map(
        words.map((word) => [word.id, { ...word.bounds }] as const),
      ),
    });
    const resolution = resolveTextSpanWithCanonicalStream(stream, {
      kind: "text_span",
      startAnchor: "Moreover",
      endAnchor: "instance",
    });

    expect(resolution).toMatchObject({ status: "RESOLVED" });
    if (resolution.status !== "RESOLVED") throw new Error("Expected resolved.");
    expect(resolution.bounds).toHaveLength(2);
    expect(resolution.bounds[0]).toEqual(unionRectangles(line1.map((entry) => entry.bounds)));
    expect(resolution.bounds[1]).toEqual(unionRectangles(line2.slice(0, 2).map((entry) => entry.bounds)));
  });

  it("returns AMBIGUOUS when duplicate anchors produce multiple candidate ranges", () => {
    const words = [
      buildWord({
        id: "word-1",
        text: "instance",
        lineId: "line-1",
        readingOrder: 1,
        bounds: { x: 10, y: 0, width: 50, height: 20 },
        startOffset: 0,
        endOffset: 8,
      }),
      buildWord({
        id: "word-2",
        text: "is",
        lineId: "line-1",
        readingOrder: 2,
        bounds: { x: 66, y: 0, width: 20, height: 20 },
        startOffset: 9,
        endOffset: 11,
      }),
      buildWord({
        id: "word-3",
        text: "instance",
        lineId: "line-1",
        readingOrder: 3,
        bounds: { x: 90, y: 0, width: 50, height: 20 },
        startOffset: 12,
        endOffset: 20,
      }),
      buildWord({
        id: "word-4",
        text: "only",
        lineId: "line-1",
        readingOrder: 4,
        bounds: { x: 146, y: 0, width: 40, height: 20 },
        startOffset: 21,
        endOffset: 25,
        hasEOL: true,
      }),
    ];
    const model = buildModel({
      words,
      lines: [
        buildLine({
          id: "line-1",
          text: words.map((entry) => entry.text).join(" "),
          readingOrder: 1,
          wordIds: words.map((entry) => entry.id),
          paragraphId: null,
          bounds: { x: 10, y: 0, width: 176, height: 20 },
        }),
      ],
      layoutRegions: [],
      layoutBlocks: [],
      columns: [],
      sentences: [],
      paragraphs: [],
    });
    const stream = buildCanonicalTextStream({
      semanticModel: model,
      pageId: "page-1",
      boundsBySourceObjectId: new Map(
        words.map((word) => [word.id, { ...word.bounds }] as const),
      ),
    });
    const resolution = resolveTextSpanWithCanonicalStream(stream, {
      kind: "text_span",
      startAnchor: "instance",
      endAnchor: "instance",
    });

    expect(resolution).toMatchObject({ status: "AMBIGUOUS" });
    if (resolution.status !== "AMBIGUOUS") throw new Error("Expected ambiguous.");
    expect(resolution.candidates).toEqual(expect.arrayContaining([
      { startIndex: 0, endIndex: 0 },
      { startIndex: 0, endIndex: 2 },
      { startIndex: 2, endIndex: 2 },
    ]));
    expect(resolution.candidates).toHaveLength(3);
  });

  it("returns NOT_FOUND when anchors are missing or reversed", () => {
    const words = [
      buildWord({
        id: "word-1",
        text: "AI",
        lineId: "line-1",
        readingOrder: 1,
        bounds: { x: 0, y: 0, width: 16, height: 20 },
        startOffset: 0,
        endOffset: 2,
      }),
      buildWord({
        id: "word-2",
        text: "instance",
        lineId: "line-1",
        readingOrder: 2,
        bounds: { x: 20, y: 0, width: 56, height: 20 },
        startOffset: 3,
        endOffset: 11,
      }),
    ];
    const model = buildModel({
      words,
      lines: [
        buildLine({
          id: "line-1",
          text: words.map((entry) => entry.text).join(" "),
          readingOrder: 1,
          wordIds: words.map((entry) => entry.id),
          paragraphId: null,
          bounds: { x: 0, y: 0, width: 76, height: 20 },
        }),
      ],
      layoutRegions: [],
      layoutBlocks: [],
      columns: [],
      sentences: [],
      paragraphs: [],
    });
    const stream = buildCanonicalTextStream({
      semanticModel: model,
      pageId: "page-1",
      boundsBySourceObjectId: new Map(
        words.map((entry) => [entry.id, { ...entry.bounds }] as const),
      ),
    });

    expect(resolveTextSpanWithCanonicalStream(stream, {
      kind: "text_span",
      startAnchor: "missing",
      endAnchor: "instance",
    })).toMatchObject({
      status: "NOT_FOUND",
      reason: "START_ANCHOR_NOT_FOUND",
    });

    expect(resolveTextSpanWithCanonicalStream(stream, {
      kind: "text_span",
      startAnchor: "instance",
      endAnchor: "AI",
    })).toMatchObject({
      status: "NOT_FOUND",
      reason: "NO_FORWARD_SPAN",
    });
  });

  it("keeps normalization stable across punctuation and whitespace", () => {
    const words = [
      buildWord({
        id: "word-1",
        text: "Moreover,",
        lineId: "line-1",
        readingOrder: 1,
        bounds: { x: 10, y: 0, width: 70, height: 20 },
        startOffset: 0,
        endOffset: 8,
      }),
      buildWord({
        id: "word-2",
        text: "is",
        lineId: "line-1",
        readingOrder: 2,
        bounds: { x: 84, y: 0, width: 16, height: 20 },
        startOffset: 9,
        endOffset: 11,
      }),
      buildWord({
        id: "word-3",
        text: "instance.",
        lineId: "line-1",
        readingOrder: 3,
        bounds: { x: 104, y: 0, width: 64, height: 20 },
        startOffset: 12,
        endOffset: 21,
      }),
    ];
    const model = buildModel({
      words,
      lines: [
        buildLine({
          id: "line-1",
          text: words.map((entry) => entry.text).join(" "),
          readingOrder: 1,
          wordIds: words.map((entry) => entry.id),
          paragraphId: null,
          bounds: { x: 10, y: 0, width: 158, height: 20 },
        }),
      ],
      layoutRegions: [],
      layoutBlocks: [],
      columns: [],
      sentences: [],
      paragraphs: [],
    });
    const stream = buildCanonicalTextStream({
      semanticModel: model,
      pageId: "page-1",
      boundsBySourceObjectId: new Map(
        words.map((entry) => [entry.id, { ...entry.bounds }] as const),
      ),
    });

    const resolution = resolveTextSpanWithCanonicalStream(stream, {
      kind: "text_span",
      startAnchor: "moreover",
      endAnchor: " instance ",
    });
    expect(resolution).toMatchObject({ status: "RESOLVED" });
    if (resolution.status !== "RESOLVED") throw new Error("Expected resolved.");
    expect(resolution.text).toBe("Moreover, is instance.");
  });
});

describe("canonical-stream fallback", () => {
  it("falls back to line-level tokens when no word bounds exist", () => {
    const line = buildLine({
      id: "line-1",
      text: "The entire process is simple.",
      readingOrder: 1,
      wordIds: [],
      paragraphId: null,
      bounds: { x: 0, y: 10, width: 180, height: 20 },
      hasEOL: true,
    });
    const model = buildModel({
      words: [],
      lines: [line],
      layoutRegions: [],
      layoutBlocks: [],
      columns: [],
      sentences: [],
      paragraphs: [],
    });
    const stream = buildCanonicalTextStream({
      semanticModel: model,
      pageId: "page-1",
      boundsBySourceObjectId: new Map([["line-1", { x: 0, y: 10, width: 180, height: 20 }]]),
    });

    const resolution = resolveTextSpanWithCanonicalStream(stream, {
      kind: "text_span",
      quote: "The entire process is simple.",
    });

    expect(resolution).toMatchObject({
      status: "RESOLVED",
      bounds: [{ x: 0, y: 10, width: 180, height: 20 }],
    });
  });
});
