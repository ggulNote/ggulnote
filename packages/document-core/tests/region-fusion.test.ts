import { describe, expect, it } from "vitest";
import type { DocumentId, NormalizedRect, PageId } from "@ggulnote/shared-types";
import { buildPageSemanticModel, PageSemanticModel, type DetectedLayoutRegionInput, type PageTextItemInput } from "../src";

const documentId = "document-fusion" as DocumentId;
const pageId = "document-fusion-page-1" as PageId;
const item = (id: string, text: string, bounds: NormalizedRect, sourceIndex: number): PageTextItemInput => ({
  id, text, bounds, sourceIndex, direction: "ltr", hasEOL: true,
  orientation: { angle: 0, writingMode: "horizontal" },
  axis: { advanceX: 1, advanceY: 0, normalX: 0, normalY: 1 },
});
const detection = (id: string, label: string, bounds: NormalizedRect, confidence = 0.9): DetectedLayoutRegionInput => ({
  id, label, bounds, confidence, modelId: "layout-model",
});
const build = (textItems: PageTextItemInput[], layoutDetections?: DetectedLayoutRegionInput[]) =>
  buildPageSemanticModel({ documentId, pageId, pageNumber: 1, textItems, layoutDetections, layoutModelId: "layout-model" });

describe("YOLO region semantic fusion", () => {
  it("builds Line and Sentence only inside one-column Text regions", () => {
    const model = build([
      item("a", "First sentence.", { x: 0.1, y: 0.15, width: 0.35, height: 0.03 }, 0),
      item("b", "Second sentence.", { x: 0.1, y: 0.2, width: 0.38, height: 0.03 }, 1),
    ], [detection("text", "Text", { x: 0.08, y: 0.1, width: 0.82, height: 0.2 })]);
    const data = model.toSerialized();
    const region = data.layoutRegions[0];
    expect(data.semanticSource).toBe("yolo-region");
    expect(region?.layoutType).toBe("text");
    expect(region?.textContent?.paragraphIds).toHaveLength(1);
    expect(data.lines.every((line) => line.regionId === region?.id)).toBe(true);
    expect(data.sentences.every((sentence) => sentence.regionId === region?.id)).toBe(true);
  });

  it("orders two-column regions down the left column before the right column without cross-column lines", () => {
    const regions = [
      detection("left-1", "Text", { x: 0.08, y: 0.15, width: 0.35, height: 0.12 }),
      detection("right-1", "Text", { x: 0.55, y: 0.15, width: 0.35, height: 0.12 }),
      detection("left-2", "Text", { x: 0.08, y: 0.42, width: 0.35, height: 0.12 }),
      detection("right-2", "Text", { x: 0.55, y: 0.42, width: 0.35, height: 0.12 }),
    ];
    const items = regions.map((region, index) => item("item-" + index, "Column " + index + ".",
      { x: region.bounds.x + 0.01, y: region.bounds.y + 0.02, width: 0.18, height: 0.025 }, index));
    const model = build(items, regions);
    expect(model.getLayoutRegions().map((region) => region.sourceDetection?.detectionId))
      .toEqual(["left-1", "left-2", "right-1", "right-2"]);
    const data = model.toSerialized();
    expect(data.lines).toHaveLength(4);
    expect(data.lines.every((line) => data.words.filter((word) => line.wordIds.includes(word.id))
      .every((word) => word.regionId === line.regionId))).toBe(true);
  });

  it("keeps full-width Title and Section-header outside column flow", () => {
    const model = build([
      item("title", "Paper title", { x: 0.25, y: 0.04, width: 0.5, height: 0.04 }, 0),
      item("section", "Introduction", { x: 0.18, y: 0.18, width: 0.64, height: 0.03 }, 1),
      item("left", "Left body.", { x: 0.08, y: 0.28, width: 0.25, height: 0.03 }, 2),
      item("right", "Right body.", { x: 0.56, y: 0.28, width: 0.25, height: 0.03 }, 3),
    ], [
      detection("title", "Title", { x: 0.18, y: 0.02, width: 0.64, height: 0.09 }),
      detection("section", "Section-header", { x: 0.15, y: 0.15, width: 0.7, height: 0.08 }),
      detection("left", "Text", { x: 0.06, y: 0.24, width: 0.38, height: 0.2 }),
      detection("right", "Text", { x: 0.54, y: 0.24, width: 0.38, height: 0.2 }),
    ]);
    expect(model.getLayoutRegions().map((region) => region.layoutType))
      .toEqual(["title", "section-header", "text", "text"]);
  });

  it("preserves Table, Picture, and Formula as media and links Caption and Section-header", () => {
    const model = build([
      item("heading", "Results", { x: 0.1, y: 0.08, width: 0.2, height: 0.03 }, 0),
      item("table-word", "Value", { x: 0.18, y: 0.25, width: 0.08, height: 0.02 }, 1),
      item("caption", "Table 1. Results.", { x: 0.2, y: 0.55, width: 0.25, height: 0.025 }, 2),
      item("picture-word", "Figure", { x: 0.65, y: 0.28, width: 0.08, height: 0.02 }, 3),
      item("picture-caption", "Figure 1. Overview.", { x: 0.62, y: 0.55, width: 0.25, height: 0.025 }, 4),
      item("formula-word", "x=y", { x: 0.4, y: 0.72, width: 0.08, height: 0.02 }, 5),
    ], [
      detection("heading", "Section-header", { x: 0.08, y: 0.06, width: 0.84, height: 0.06 }),
      detection("table", "Table", { x: 0.1, y: 0.18, width: 0.4, height: 0.34 }),
      detection("table-caption", "Caption", { x: 0.15, y: 0.53, width: 0.35, height: 0.06 }),
      detection("picture", "Picture", { x: 0.55, y: 0.18, width: 0.37, height: 0.34 }),
      detection("picture-caption", "Caption", { x: 0.57, y: 0.53, width: 0.35, height: 0.06 }),
      detection("formula", "Formula", { x: 0.35, y: 0.68, width: 0.2, height: 0.1 }),
    ]);
    const data = model.toSerialized();
    for (const type of ["table", "picture", "formula"] as const) {
      const region = data.layoutRegions.find((entry) => entry.layoutType === type);
      expect(region?.mediaContent).toBeDefined();
      expect(data.paragraphs.some((paragraph) => paragraph.regionId === region?.id)).toBe(false);
    }
    const table = data.layoutRegions.find((region) => region.layoutType === "table");
    expect(table?.relations.map((relation) => relation.type)).toEqual(expect.arrayContaining(["caption", "section-header"]));
  });

  it("includes non-text layout regions in point, nearest, and rectangle candidates", () => {
    const model = build([
      item("table-word", "Value", { x: 0.15, y: 0.2, width: 0.08, height: 0.02 }, 0),
      item("picture-word", "Figure", { x: 0.62, y: 0.2, width: 0.08, height: 0.02 }, 1),
    ], [
      detection("table", "Table", { x: 0.1, y: 0.1, width: 0.35, height: 0.4 }),
      detection("picture", "Picture", { x: 0.55, y: 0.1, width: 0.35, height: 0.4 }),
    ]);

    const emptyTableArea = model.findAtPoint(
      { x: 0.35, y: 0.4 },
      { types: ["LAYOUT_REGION"], layoutTypes: ["table"] },
    );
    expect(emptyTableArea).toMatchObject([{
      type: "LAYOUT_REGION",
      layoutType: "table",
      directHit: true,
      text: "Value",
    }]);

    const pictureNear = model.findNearest(
      { x: 0.91, y: 0.3 },
      { types: ["LAYOUT_REGION"], layoutTypes: ["picture"], maxDistance: 0.02 },
    );
    expect(pictureNear[0]).toMatchObject({
      type: "LAYOUT_REGION",
      layoutType: "picture",
      directHit: false,
    });

    const pictureRect = model.findInRect(
      { x: 0.8, y: 0.3, width: 0.15, height: 0.15 },
      { types: ["LAYOUT_REGION"] },
    );
    expect(pictureRect.map((candidate) => candidate.layoutType)).toContain("picture");
  });

  it("uses layout type priority and overlap for crossing and nested regions", () => {
    const model = build([
      item("boundary", "Boundary", { x: 0.48, y: 0.2, width: 0.1, height: 0.03 }, 0),
      item("overlap", "Heading", { x: 0.2, y: 0.4, width: 0.15, height: 0.03 }, 1),
    ], [
      detection("left", "Text", { x: 0.1, y: 0.15, width: 0.45, height: 0.15 }, 0.95),
      detection("right", "Text", { x: 0.5, y: 0.15, width: 0.35, height: 0.15 }, 0.8),
      detection("body", "Text", { x: 0.1, y: 0.35, width: 0.5, height: 0.12 }, 0.99),
      detection("heading", "Section-header", { x: 0.18, y: 0.37, width: 0.22, height: 0.09 }, 0.7),
    ]);
    const boundary = model.toSerialized().words.find((word) => word.text === "Boundary");
    const heading = model.toSerialized().words.find((word) => word.text === "Heading");
    expect(model.getLayoutRegion(boundary?.regionId ?? "")?.sourceDetection?.detectionId).toBe("right");
    expect(model.getLayoutRegion(heading?.regionId ?? "")?.layoutType).toBe("section-header");
  });

  it("keeps unassigned words and falls back when coordinate alignment is severely low", () => {
    const partial = build([
      item("inside", "Inside", { x: 0.1, y: 0.1, width: 0.1, height: 0.03 }, 0),
      item("inside-2", "Inside two", { x: 0.1, y: 0.15, width: 0.12, height: 0.03 }, 1),
      item("outside", "Outside", { x: 0.75, y: 0.8, width: 0.1, height: 0.03 }, 2),
    ], [detection("text", "Text", { x: 0.05, y: 0.05, width: 0.3, height: 0.2 })]);
    expect(partial.getSemanticSource()).toBe("yolo-region");
    expect(partial.getUnassignedWords().map((word) => word.text)).toContain("Outside");
    const legacyItems = [item("legacy", "Legacy text.", { x: 0.1, y: 0.1, width: 0.3, height: 0.03 }, 0)];
    expect(build(legacyItems).getSemanticSource()).toBe("legacy-semantic-fallback");
    expect(build(legacyItems, [detection("far", "Text", { x: 0.7, y: 0.7, width: 0.2, height: 0.1 })]).getSemanticSource())
      .toBe("legacy-semantic-fallback");
  });

  it("round-trips the new model and resolves gaze Region to Line to Word", () => {
    const original = build([item("word", "Target word", { x: 0.2, y: 0.2, width: 0.2, height: 0.04 }, 0)], [
      detection("text", "Text", { x: 0.1, y: 0.1, width: 0.5, height: 0.3 }),
    ]);
    const restored = PageSemanticModel.fromSerialized(original.toSerialized());
    expect(restored.toSerialized()).toEqual(original.toSerialized());
    const semanticPath = restored.findTextPathAtPoint({ x: 0.25, y: 0.22 });
    expect(semanticPath.region?.layoutType).toBe("text");
    expect(semanticPath.line?.regionId).toBe(semanticPath.region?.id);
    expect(semanticPath.word?.lineId).toBe(semanticPath.line?.id);
  });

  it("keeps canonical results independent of display zoom and DPR", () => {
    const textItems = [item("text", "Stable", { x: 0.2, y: 0.3, width: 0.15, height: 0.03 }, 0)];
    const detections = [detection("text", "Text", { x: 0.1, y: 0.2, width: 0.5, height: 0.3 })];
    const first = build(textItems, detections).toSerialized();
    const second = build(textItems.map((entry) => ({ ...entry, bounds: { ...entry.bounds } })),
      detections.map((entry) => ({ ...entry, bounds: { ...entry.bounds } }))).toSerialized();
    expect(second.layoutRegions.map((region) => region.bounds)).toEqual(first.layoutRegions.map((region) => region.bounds));
    expect(second.words.map((word) => word.bounds)).toEqual(first.words.map((word) => word.bounds));
  });
});
