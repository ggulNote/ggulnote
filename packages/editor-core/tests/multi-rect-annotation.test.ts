import { describe, expect, it } from "vitest";
import {
  EditorEngine,
  MAX_ANNOTATION_RECT_COUNT,
  deserializeAnnotation,
  type SerializedAnnotation,
} from "../src";

const PAGE_ID = "doc-1-page-1";
const RECTS = [
  { x: 0.1, y: 0.2, width: 0.3, height: 0.02 },
  { x: 0.1, y: 0.24, width: 0.24, height: 0.02 },
  { x: 0.1, y: 0.28, width: 0.18, height: 0.02 },
] as const;

function createEngine(id = "multi-rect-1"): EditorEngine {
  const engine = new EditorEngine({ idGenerator: () => id });
  engine.setDocument("doc-1");
  engine.setActivePage(PAGE_ID, { width: 600, height: 800 });
  return engine;
}

describe("multi-rect annotations", () => {
  it.each(["UNDERLINE", "HIGHLIGHT"] as const)(
    "creates one %s annotation and preserves ordered rects",
    (type) => {
      const engine = createEngine();
      engine.createAnnotation({
        type,
        pageId: PAGE_ID,
        bounds: RECTS[0],
        rects: RECTS,
      });

      const snapshot = engine.exportPageSnapshot(PAGE_ID);
      expect(snapshot.annotations).toHaveLength(1);
      expect(snapshot.annotations[0]).toMatchObject({ type, rects: RECTS });
      expect(snapshot.annotations[0]?.bounds.x).toBeCloseTo(0.1);
      expect(snapshot.annotations[0]?.bounds.y).toBeCloseTo(0.2);
      expect(snapshot.annotations[0]?.bounds.width).toBeCloseTo(0.3);
      expect(snapshot.annotations[0]?.bounds.height).toBeCloseTo(0.1);
      expect(engine.getUndoStackSize()).toBe(1);

      engine.undo();
      expect(engine.exportPageSnapshot(PAGE_ID).annotations).toEqual([]);
      engine.redo();
      expect(engine.exportPageSnapshot(PAGE_ID).annotations[0]?.rects).toEqual(RECTS);
    },
  );

  it("serializes, hydrates, updates, deletes, and restores one logical annotation", () => {
    const source = createEngine();
    source.createAnnotation({
      type: "HIGHLIGHT",
      pageId: PAGE_ID,
      bounds: RECTS[0],
      rects: RECTS,
      color: "#facc15",
    });
    const persisted = source.exportPageSnapshot(PAGE_ID);

    const hydrated = createEngine("unused");
    hydrated.hydratePage(persisted);
    expect(hydrated.exportPageSnapshot(PAGE_ID).annotations[0]?.rects).toEqual(RECTS);

    const before = hydrated.exportPageSnapshot(PAGE_ID).annotations[0];
    if (before === undefined) throw new Error("Expected hydrated annotation.");
    hydrated.select(before.id);
    hydrated.updateSelected({
      ...before,
      properties: { ...before.properties, color: "#22c55e" },
      updatedAt: before.updatedAt + 1,
    });
    expect(hydrated.exportPageSnapshot(PAGE_ID).annotations[0]?.rects).toEqual(RECTS);
    hydrated.undo();
    expect(hydrated.exportPageSnapshot(PAGE_ID).annotations[0]?.properties.color).toBe("#facc15");

    hydrated.select(before.id);
    hydrated.deleteSelected();
    expect(hydrated.exportPageSnapshot(PAGE_ID).annotations).toEqual([]);
    hydrated.undo();
    expect(hydrated.exportPageSnapshot(PAGE_ID).annotations[0]?.rects).toEqual(RECTS);
  });

  it("hydrates legacy single-rect schema without synthetic rects", () => {
    const legacy: SerializedAnnotation = {
      schemaVersion: 1,
      id: "legacy-1",
      pageId: PAGE_ID,
      type: "UNDERLINE",
      bounds: { x: 0.2, y: 0.3, width: 0.2, height: 0.02 },
      zIndex: 1,
      properties: { thickness: 2, lineStyle: "solid", color: "#111827" },
      createdAt: 1,
      updatedAt: 1,
    };
    expect(deserializeAnnotation(legacy).serialize()).toEqual(legacy);
  });

  it("rejects invalid geometry and enforces the centralized rect bound", () => {
    const engine = createEngine();
    expect(() => engine.createAnnotation({
      type: "UNDERLINE",
      pageId: PAGE_ID,
      bounds: RECTS[0],
      rects: [{ x: 0, y: 0, width: Number.NaN, height: 0.1 }],
    })).toThrow("Invalid annotation rect");
    expect(() => engine.createAnnotation({
      type: "HIGHLIGHT",
      pageId: PAGE_ID,
      bounds: RECTS[0],
      rects: Array.from({ length: MAX_ANNOTATION_RECT_COUNT + 1 }, () => RECTS[0]),
    })).toThrow("Invalid annotation rect count");
    expect(engine.exportPageSnapshot(PAGE_ID).annotations).toEqual([]);
  });
});
