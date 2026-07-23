import { describe, expect, it } from "vitest";
import {
  PageSemanticModel,
  buildPageSemanticModel,
  unionBounds,
  type PageTextItemInput,
  type SemanticLine,
  type SemanticParagraph,
  type SemanticSentence,
  type SemanticWord,
} from "../src";

const horizontalItem = (
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  sourceIndex: number,
  fontSize = 12,
  hasEOL = true,
): PageTextItemInput => ({
  id,
  text,
  bounds: { x, y, width, height },
  sourceIndex,
  fontName: "TestFont",
  fontSize,
  direction: "ltr",
  hasEOL,
  orientation: { angle: 0, writingMode: "horizontal" },
  axis: { advanceX: 1, advanceY: 0, normalX: 0, normalY: 1 },
});

const rotatedItem = (
  id: string,
  text: string,
  sourceIndex: number,
): PageTextItemInput => ({
  id,
  text,
  bounds: { x: 0.025, y: 0.2, width: 0.025, height: 0.42 },
  sourceIndex,
  fontName: "TestFont",
  fontSize: 10,
  direction: "ltr",
  hasEOL: true,
  orientation: { angle: Math.PI / 2, writingMode: "rotated" },
  axis: { advanceX: 0, advanceY: -1, normalX: 1, normalY: 0 },
});

const build = (textItems: PageTextItemInput[]) => buildPageSemanticModel({
  documentId: "layout-doc",
  pageId: "layout-doc-page-1",
  pageNumber: 1,
  textItems,
});

const objectsOfType = <T extends SemanticWord | SemanticLine | SemanticSentence | SemanticParagraph>(
  model: ReturnType<typeof build>,
  type: T["type"],
): T[] => model.getAllByReadingOrder()
  .filter((item): item is T => item.type === type);

describe("semantic geometry and layout", () => {
  it("prevents transitive baseline chain merging from growing a multi-row line", () => {
    const model = build([
      horizontalItem("chain-a", "alpha", 0.1, 0.1, 0.2, 0.02, 0),
      horizontalItem("chain-b", "beta", 0.1, 0.112, 0.2, 0.02, 1),
      horizontalItem("chain-c", "gamma", 0.1, 0.124, 0.2, 0.02, 2),
    ]);
    const lines = objectsOfType<SemanticLine>(model, "LINE");

    expect(lines).toHaveLength(2);
    expect(Math.max(...lines.map((line) => line.bounds.height))).toBeLessThanOrEqual(0.032);
  });

  it("separates overlapping x intervals that belong to distinct visual rows", () => {
    const model = build(Array.from({ length: 6 }, (_, index) =>
      horizontalItem(
        `stack-${index}`,
        `row ${index}`,
        0.15,
        0.1 + index * 0.012,
        0.24,
        0.02,
        index,
      )));
    const lines = objectsOfType<SemanticLine>(model, "LINE");

    expect(lines.length).toBeGreaterThan(1);
    expect(Math.max(...lines.map((line) => line.bounds.height))).toBeLessThan(0.05);
  });

  it("infers repeated columns across a long band with offset and missing partner rows", () => {
    const items: PageTextItemInput[] = [];
    let sourceIndex = 0;
    for (let row = 0; row < 20; row += 1) {
      const y = 0.12 + row * 0.028;
      items.push(horizontalItem(
        `left-${row}`,
        `Left ${row}.`,
        0.08,
        y,
        0.36,
        0.012,
        sourceIndex++,
      ));
      if (row % 5 !== 2) {
        items.push(horizontalItem(
          `right-${row}`,
          `Right ${row}.`,
          0.56,
          y + 0.01,
          0.36,
          0.012,
          sourceIndex++,
        ));
      }
    }

    const model = build(items);
    const columns = model.getColumns();
    const lines = objectsOfType<SemanticLine>(model, "LINE");
    const leftOrders = lines
      .filter((line) => line.text.startsWith("Left"))
      .map((line) => line.readingOrder);
    const rightOrders = lines
      .filter((line) => line.text.startsWith("Right"))
      .map((line) => line.readingOrder);

    expect(columns).toHaveLength(2);
    expect(Math.max(...leftOrders)).toBeLessThan(Math.min(...rightOrders));
  });

  it("keeps full-width bands separate from repeated body columns", () => {
    const items: PageTextItemInput[] = [
      horizontalItem("title", "Full width title", 0.08, 0.04, 0.84, 0.035, 0, 24),
      horizontalItem("authors", "Authors and affiliations", 0.18, 0.1, 0.64, 0.022, 1),
    ];
    let sourceIndex = 2;
    for (let row = 0; row < 8; row += 1) {
      const y = 0.2 + row * 0.035;
      items.push(horizontalItem(
        `left-body-${row}`,
        `Left body ${row}.`,
        0.08,
        y,
        0.36,
        0.018,
        sourceIndex++,
      ));
      items.push(horizontalItem(
        `right-body-${row}`,
        `Right body ${row}.`,
        0.56,
        y,
        0.36,
        0.018,
        sourceIndex++,
      ));
    }

    const model = build(items);
    const lines = objectsOfType<SemanticLine>(model, "LINE");
    const bodyColumns = model.getColumns().filter((column) => column.bounds.y >= 0.18);

    expect(lines.slice(0, 2).map((line) => line.text)).toEqual([
      "Full width title",
      "Authors and affiliations",
    ]);
    expect(bodyColumns).toHaveLength(2);
  });

  it("does not split a regular single-column page into false columns", () => {
    const model = build(Array.from({ length: 12 }, (_, index) =>
      horizontalItem(
        `single-${index}`,
        `A regular prose line number ${index}.`,
        0.12 + (index % 3) * 0.01,
        0.08 + index * 0.045,
        0.68 - (index % 4) * 0.04,
        0.02,
        index,
      )));

    expect(model.getColumns()).toHaveLength(1);
  });

  it("uses line-level sentence candidates for a directory tree containing dotted filenames", () => {
    const texts = [
      "apps/",
      "├── web/",
      "│   ├── page.tsx",
      "│   ├── builder.ts",
      "│   └── geometry.ts",
    ];
    const model = build(texts.map((text, index) =>
      horizontalItem(
        `tree-${index}`,
        text,
        0.1 + index * 0.015,
        0.1 + index * 0.035,
        0.35,
        0.02,
        index,
      )));
    const sentences = objectsOfType<SemanticSentence>(model, "SENTENCE");

    expect(sentences).toHaveLength(texts.length);
    expect(Math.max(...sentences.map((sentence) => sentence.lineIds.length))).toBe(1);
  });

  it("uses line-level sentence candidates for preformatted code", () => {
    const texts = [
      "const value = createValue();",
      "if (value) {",
      "return value;",
      "}",
    ];
    const model = build(texts.map((text, index) =>
      horizontalItem(
        `code-${index}`,
        text,
        0.12 + (index > 0 ? 0.02 : 0),
        0.1 + index * 0.035,
        0.42,
        0.02,
        index,
      )));
    const sentences = objectsOfType<SemanticSentence>(model, "SENTENCE");

    expect(sentences).toHaveLength(texts.length);
    expect(sentences.every((sentence) => sentence.lineIds.length === 1)).toBe(true);
  });

  it("creates one sentence candidate per bullet item and keeps continuation lines", () => {
    const model = build([
      horizontalItem("bullet-1", "• First item", 0.1, 0.1, 0.3, 0.02, 0),
      horizontalItem("bullet-1-cont", "continues here", 0.13, 0.13, 0.3, 0.02, 1),
      horizontalItem("bullet-2", "• Second item", 0.1, 0.18, 0.3, 0.02, 2),
      horizontalItem("bullet-2-cont", "continues too", 0.13, 0.21, 0.3, 0.02, 3),
    ]);
    const sentences = objectsOfType<SemanticSentence>(model, "SENTENCE");

    expect(sentences).toHaveLength(2);
    expect(sentences.map((sentence) => sentence.lineIds.length)).toEqual([2, 2]);
  });

  it("keeps long natural prose multiline instead of applying structural line fallback", () => {
    const model = build([
      horizontalItem("prose-1", "This natural sentence continues over", 0.1, 0.1, 0.45, 0.02, 0),
      horizontalItem("prose-2", "several visual lines without becoming", 0.1, 0.13, 0.45, 0.02, 1),
      horizontalItem("prose-3", "a preformatted block.", 0.1, 0.16, 0.3, 0.02, 2),
    ]);
    const sentences = objectsOfType<SemanticSentence>(model, "SENTENCE");

    expect(sentences).toHaveLength(1);
    expect(sentences[0]?.fragments).toHaveLength(3);
  });
  it("rejects invalid bounds before creating semantic objects", () => {
    const model = build([
      { ...horizontalItem("nan", "invalid", 0.1, 0.1, 0.2, 0.02, 0), bounds: { x: Number.NaN, y: 0.1, width: 0.2, height: 0.02 } },
      horizontalItem("zero", "invalid", 0.1, 0.1, 0, 0.02, 1),
      horizontalItem("valid", "valid", 0.1, 0.2, 0.2, 0.02, 2),
    ]);

    expect(model.getSummary()).toMatchObject({
      sourceItemCount: 1,
      wordCount: 1,
      lineCount: 1,
    });
  });

  it("places horizontal words by weighted local advance with independent bounds", () => {
    const source = horizontalItem(
      "source",
      "illuminate wide words",
      0.1,
      0.2,
      0.6,
      0.03,
      0,
    );
    const model = build([source]);
    const words = objectsOfType<SemanticWord>(model, "WORD");

    expect(words.map((word) => word.text)).toEqual(["illuminate", "wide", "words"]);
    expect(new Set(words.map((word) => word.bounds)).size).toBe(words.length);
    expect(words[1]?.bounds.x).toBeGreaterThan((words[0]?.bounds.x ?? 0) + (words[0]?.bounds.width ?? 0));
    expect(words[2]?.bounds.x).toBeGreaterThan((words[1]?.bounds.x ?? 0) + (words[1]?.bounds.width ?? 0));

    for (const word of words) {
      expect(word.bounds.width).toBeGreaterThan(0);
      expect(word.bounds.height).toBeGreaterThan(0);
      expect(word.bounds.x).toBeGreaterThanOrEqual(source.bounds.x);
      expect(word.bounds.x + word.bounds.width).toBeLessThanOrEqual(source.bounds.x + source.bounds.width);
      expect(word.sourceRanges[0]?.sourceTextItemId).toBe("source");
    }
  });

  it("places rotated words on the local baseline and excludes them from horizontal lines", () => {
    const model = build([
      horizontalItem("body", "horizontal body", 0.15, 0.25, 0.35, 0.025, 0),
      rotatedItem("sidebar", "rotated words", 1),
    ]);
    const words = objectsOfType<SemanticWord>(model, "WORD");
    const rotatedWords = words.filter((word) => word.orientation.writingMode === "rotated");
    const lines = objectsOfType<SemanticLine>(model, "LINE");

    expect(rotatedWords).toHaveLength(2);
    expect(rotatedWords[1]?.bounds.y).toBeLessThan(rotatedWords[0]?.bounds.y ?? 0);
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((line) => line.orientation.writingMode))).toEqual(
      new Set(["horizontal", "rotated"]),
    );
    expect(new Set(lines.map((line) => line.blockId)).size).toBe(2);
  });

  it("does not create whitespace words and preserves URL, email, and citation runs", () => {
    const model = build([
      horizontalItem(
        "tokens",
        "https://example.com user@example.com [12]",
        0.1,
        0.2,
        0.75,
        0.03,
        0,
      ),
      horizontalItem("spaces", "   ", 0.1, 0.25, 0.1, 0.03, 1),
    ]);
    const words = objectsOfType<SemanticWord>(model, "WORD");

    expect(words.map((word) => word.text)).toEqual([
      "https://example.com",
      "user@example.com",
      "[12]",
    ]);
  });

  it("splits same-baseline columns while joining small Text Item gaps", () => {
    const model = build([
      horizontalItem("left-a", "left", 0.1, 0.2, 0.1, 0.025, 0, 12, false),
      horizontalItem("left-b", "continues", 0.22, 0.2, 0.16, 0.025, 1),
      horizontalItem("right", "right column", 0.58, 0.2, 0.3, 0.025, 2),
    ]);
    const lines = objectsOfType<SemanticLine>(model, "LINE");

    expect(lines).toHaveLength(2);
    expect(lines[0]?.text).toBe("left continues");
    expect(lines[0]?.bounds.x + (lines[0]?.bounds.width ?? 0)).toBeLessThan(0.5);
    expect(lines[1]?.bounds.x).toBeGreaterThan(0.5);
    for (const line of lines) {
      const wordBounds = line.wordIds
        .map((id) => model.getWord(id)?.bounds)
        .filter((bounds): bounds is NonNullable<typeof bounds> => bounds !== undefined);
      expect(line.bounds).toEqual(unionBounds(wordBounds));
    }
  });

  it("builds full-width and local two-column regions with block reading order", () => {
    const model = build([
      horizontalItem("title", "A Full Width Title", 0.1, 0.05, 0.8, 0.04, 0, 24),
      horizontalItem("authors", "Author One and Author Two", 0.2, 0.12, 0.6, 0.025, 1, 12),
      horizontalItem("left-1", "Left column first.", 0.1, 0.24, 0.34, 0.025, 2),
      horizontalItem("right-1", "Right column first.", 0.56, 0.24, 0.34, 0.025, 3),
      horizontalItem("left-2", "Left column second.", 0.1, 0.28, 0.34, 0.025, 4),
      horizontalItem("right-2", "Right column second.", 0.56, 0.28, 0.34, 0.025, 5),
      horizontalItem("left-3", "Left column third.", 0.1, 0.32, 0.34, 0.025, 6),
      horizontalItem("right-3", "Right column third.", 0.56, 0.32, 0.34, 0.025, 7),
      rotatedItem("sidebar", "arXiv:1234.5678", 8),
    ]);

    const lines = objectsOfType<SemanticLine>(model, "LINE");
    const texts = lines.map((line) => line.text);
    const leftOrders = lines.filter((line) => line.text.startsWith("Left")).map((line) => line.readingOrder);
    const rightOrders = lines.filter((line) => line.text.startsWith("Right")).map((line) => line.readingOrder);
    const bodyColumns = model.getColumns().filter((column) =>
      column.bounds.y >= 0.2 && column.orientation.writingMode === "horizontal");

    expect(texts.slice(0, 2)).toEqual(["A Full Width Title", "Author One and Author Two"]);
    expect(Math.max(...leftOrders)).toBeLessThan(Math.min(...rightOrders));
    expect(bodyColumns).toHaveLength(2);
    expect(new Set(bodyColumns.map((column) => column.regionId)).size).toBe(1);
    expect(model.getLayoutBlocks().some((block) => block.type === "heading")).toBe(true);
    expect(model.getLayoutBlocks().some((block) => block.type === "sidebar")).toBe(true);

    const bodyParagraphs = objectsOfType<SemanticParagraph>(model, "PARAGRAPH")
      .filter((paragraph) => paragraph.bounds.y >= 0.2);
    expect(bodyParagraphs.every((paragraph) =>
      paragraph.lineIds.every((lineId) =>
        model.getLine(lineId)?.columnId === paragraph.columnId
        && model.getLine(lineId)?.blockId === paragraph.blockId))).toBe(true);
  });

  it("creates paragraph-local sentences and line fragments", () => {
    const model = build([
      horizontalItem("line-1", "This sentence wraps across", 0.1, 0.1, 0.36, 0.03, 0),
      horizontalItem("line-2", "two visual lines.", 0.1, 0.15, 0.22, 0.03, 1),
    ]);
    const sentences = objectsOfType<SemanticSentence>(model, "SENTENCE");
    const paragraphs = objectsOfType<SemanticParagraph>(model, "PARAGRAPH");

    expect(sentences).toHaveLength(1);
    expect(sentences[0]?.fragments).toHaveLength(2);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.fragments).toHaveLength(2);
    expect(sentences[0]?.paragraphId).toBe(paragraphs[0]?.id);
    expect(sentences[0]?.blockId).toBe(paragraphs[0]?.blockId);
    expect(sentences[0]?.columnId).toBe(paragraphs[0]?.columnId);
  });

  it("uses fragments for direct hit and distinguishes nearest results", () => {
    const model = build([
      horizontalItem("line-1", "This sentence wraps across", 0.1, 0.1, 0.36, 0.03, 0),
      horizontalItem("line-2", "two visual lines.", 0.1, 0.15, 0.22, 0.03, 1),
    ]);

    const emptyEnvelopeHit = model.findAtPoint(
      { x: 0.2, y: 0.14 },
      { types: ["SENTENCE", "PARAGRAPH"] },
    );
    const textHit = model.findAtPoint(
      { x: 0.2, y: 0.11 },
      { types: ["SENTENCE", "PARAGRAPH"] },
    );
    const nearest = model.findNearest(
      { x: 0.2, y: 0.14 },
      { types: ["SENTENCE"], limit: 1 },
    );

    expect(emptyEnvelopeHit).toEqual([]);
    expect(textHit[0]).toMatchObject({ type: "SENTENCE", directHit: true, distance: 0 });
    expect(nearest[0]).toMatchObject({ type: "SENTENCE", directHit: false });
    expect(nearest[0]?.distance).toBeGreaterThan(0);
  });

  it("restores orientation, layout IDs, fragments, and reading order after serialization", () => {
    const model = build([
      horizontalItem("body-1", "First sentence.", 0.1, 0.1, 0.3, 0.03, 0),
      horizontalItem("body-2", "Second sentence.", 0.1, 0.15, 0.3, 0.03, 1),
      rotatedItem("sidebar", "arXiv", 2),
    ]);
    const serialized = model.toSerialized();
    const restored = PageSemanticModel.fromSerialized(serialized);

    expect(serialized.extractorVersion).toBe("5");
    expect(restored.toSerialized()).toEqual(serialized);
    expect(restored.getLayoutBlocks()[0]?.id).toBe(serialized.layoutBlocks[0]?.id);
    expect(restored.getAllByReadingOrder().find((item) => item.type === "SENTENCE"))
      .toEqual(expect.objectContaining({
        fragments: expect.any(Array),
        blockId: expect.any(String),
        columnId: expect.any(String),
      }));

    expect(() => PageSemanticModel.fromSerialized({
      ...serialized,
      extractorVersion: "4",
    })).toThrow("Unsupported or invalid semantic model cache");
  });

  it("computes union bounds from right and bottom edges", () => {
    expect(unionBounds([
      { x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
      { x: 0.4, y: 0.1, width: 0.3, height: 0.4 },
    ])).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.6,
      height: 0.4,
    });
  });
});
