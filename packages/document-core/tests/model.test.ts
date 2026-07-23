import { describe, it, expect } from "vitest";
import { buildPageSemanticModel, type SemanticWord } from "../src";

describe("document-core semantic model", () => {
  const makeInput = () => ({
    documentId: "doc-1",
    pageId: "doc-1-page-1",
    pageNumber: 1,
    textItems: [
      {
        id: "item-1",
        text: "Hello",
        bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
        sourceIndex: 0,
        fontName: "Arial",
        fontSize: 16,
      },
      {
        id: "item-2",
        text: "world",
        bounds: { x: 0.33, y: 0.1, width: 0.2, height: 0.05 },
        sourceIndex: 1,
        fontName: "Arial",
        fontSize: 16,
      },
    ],
  } as const);

  it("builds a deterministic model for same input", () => {
    const first = buildPageSemanticModel(makeInput());
    const second = buildPageSemanticModel(makeInput());

    expect(first.toSerialized()).toMatchObject(second.toSerialized());
    expect(first.getSummary()).toMatchObject({
      wordCount: 2,
      lineCount: 1,
      sentenceCount: 1,
      paragraphCount: 1,
      sourceItemCount: 2,
    });
  });

  it("returns candidates near a point", () => {
    const model = buildPageSemanticModel(makeInput());
    const candidates = model.findNearest({ x: 0.2, y: 0.12 }, { limit: 5 });

    expect(candidates.length).toBeGreaterThan(0);
    expect(["PARAGRAPH", "SENTENCE"]).toContain(candidates[0]!.type);
  });

  it("tokenizes mixed text into multiple words", () => {
    const model = buildPageSemanticModel({
      documentId: "doc-1",
      pageId: "doc-1-page-1",
      pageNumber: 1,
      textItems: [
        {
          id: "item-3",
          text: "이번 작업에서는 PDF/백지 위에 Annotation을 렌더링하는 Canvas Editor Core를 구현한다",
          bounds: { x: 0.1, y: 0.1, width: 0.78, height: 0.06 },
          sourceIndex: 0,
          fontName: "Arial",
          fontSize: 16,
        },
      ],
    } as const);

    const summary = model.getSummary();
    expect(summary.wordCount).toBeGreaterThan(5);
    expect(summary.lineCount).toBe(1);
    expect(summary.sentenceCount).toBe(1);
    expect(summary.paragraphCount).toBe(1);
  });

  it("assigns independent, increasing bounds to words split from one text item", () => {
    const sourceBounds = { x: 0.1, y: 0.2, width: 0.4, height: 0.03 };
    const model = buildPageSemanticModel({
      documentId: "doc-bounds",
      pageId: "doc-bounds-page-1",
      pageNumber: 1,
      textItems: [{
        id: "item-code",
        text: "public readonly id: AnnotationId,",
        bounds: sourceBounds,
        sourceIndex: 0,
        fontName: "Arial",
        fontSize: 16,
      }],
    });
    const words = model
      .getAllByReadingOrder()
      .filter((item): item is SemanticWord => item.type === "WORD");

    expect(words.map((word) => word.text)).toEqual(["public", "readonly", "id:", "AnnotationId,"]);
    expect(new Set(words.map((word) => word.bounds)).size).toBe(words.length);
    expect(new Set(words.map((word) => word.bounds.x)).size).toBeGreaterThan(1);

    for (let index = 0; index < words.length; index += 1) {
      const word = words[index]!;
      const previous = words[index - 1];
      const right = word.bounds.x + word.bounds.width;

      expect(word.sourceItemIds).toEqual(["item-code"]);
      expect(word.bounds.width).toBeGreaterThan(0);
      expect(word.bounds.height).toBeGreaterThan(0);
      expect(word.bounds.x).toBeGreaterThanOrEqual(sourceBounds.x - Number.EPSILON);
      expect(right).toBeLessThanOrEqual(sourceBounds.x + sourceBounds.width + Number.EPSILON);
      if (previous) {
        expect(word.bounds.x).toBeGreaterThanOrEqual(previous.bounds.x + previous.bounds.width - Number.EPSILON);
        expect(word.bounds).not.toBe(previous.bounds);
      }
    }
  });

  it("groups same-row items into one line and keeps the next visual row separate", () => {
    const model = buildPageSemanticModel({
      documentId: "doc-lines",
      pageId: "doc-lines-page-1",
      pageNumber: 1,
      textItems: [
        { id: "line-1-a", text: "same row", bounds: { x: 0.1, y: 0.1, width: 0.16, height: 0.03 }, sourceIndex: 0 },
        { id: "line-1-b", text: "continues", bounds: { x: 0.3, y: 0.101, width: 0.14, height: 0.03 }, sourceIndex: 1 },
        { id: "line-2", text: "next row", bounds: { x: 0.1, y: 0.145, width: 0.16, height: 0.03 }, sourceIndex: 2 },
      ],
    });

    expect(model.getSummary().lineCount).toBe(2);
  });

  it("separates sentence offsets and paragraph gaps without page-wide accumulation", () => {
    const model = buildPageSemanticModel({
      documentId: "doc-segments",
      pageId: "doc-segments-page-1",
      pageNumber: 1,
      textItems: [
        { id: "sentence-1", text: "첫 번째 문장입니다.", bounds: { x: 0.1, y: 0.1, width: 0.28, height: 0.03 }, sourceIndex: 0 },
        { id: "sentence-2", text: "두 번째 문장입니다.", bounds: { x: 0.1, y: 0.14, width: 0.3, height: 0.03 }, sourceIndex: 1 },
        { id: "sentence-3", text: "새 문단의 문장입니다.", bounds: { x: 0.1, y: 0.3, width: 0.32, height: 0.03 }, sourceIndex: 2 },
        { id: "sentence-4", text: "마지막 문장입니다.", bounds: { x: 0.1, y: 0.34, width: 0.28, height: 0.03 }, sourceIndex: 3 },
      ],
    });
    const summary = model.getSummary();

    expect(summary.lineCount).toBe(4);
    expect(summary.sentenceCount).toBe(4);
    expect(summary.paragraphCount).toBe(2);
  });
});
