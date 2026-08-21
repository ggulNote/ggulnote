import type { SpatialSceneObject } from "../domain";
import { describe, expect, it } from "vitest";
import {
  needsCatalogVisualContext,
  needsVisualContext,
} from "./scene-visual-context-policy";

const editableBounds = { x: 24, y: 24, width: 552, height: 752 };

describe("scene visual context policy", () => {
  it("keeps blank and sparse notebook scenes on deterministic catalog geometry", () => {
    expect(needsVisualContext({ editableBounds, objects: [] })).toBe(false);
    expect(needsVisualContext({
      editableBounds,
      objects: [
        object("O1", { x: 24, y: 24, width: 120, height: 40 }),
        object("O2", { x: 24, y: 96, width: 160, height: 40 }),
      ],
    })).toBe(false);
  });

  it("uses the same deterministic threshold for page-normalized Object Catalog bounds", () => {
    expect(needsCatalogVisualContext([])).toBe(false);
    expect(needsCatalogVisualContext([
      { bounds: { x: 0.04, y: 0.04, width: 0.2, height: 0.05 } },
      { bounds: { x: 0.04, y: 0.12, width: 0.25, height: 0.05 } },
    ])).toBe(false);
    expect(needsCatalogVisualContext(Array.from({ length: 5 }, (_, index) => ({
      bounds: { x: index * 0.15, y: 0.04, width: 0.1, height: 0.05 },
    })))).toBe(true);
    expect(needsCatalogVisualContext([
      { bounds: { x: 0.05, y: 0.05, width: 0.9, height: 0.4 } },
    ])).toBe(true);
  });

  it("requests visual context for crowded, highly occupied, or overlapping scenes", () => {
    const crowded = Array.from({ length: 5 }, (_, index) =>
      object(`O${index + 1}`, { x: 24 + index * 80, y: 24, width: 60, height: 30 }));
    expect(needsVisualContext({ editableBounds, objects: crowded })).toBe(true);
    expect(needsVisualContext({
      editableBounds,
      objects: [object("large", { x: 24, y: 24, width: 552, height: 240 })],
    })).toBe(true);
    expect(needsVisualContext({
      editableBounds,
      objects: [
        object("A", { x: 24, y: 24, width: 100, height: 100 }),
        object("B", { x: 30, y: 30, width: 100, height: 100 }),
        object("C", { x: 36, y: 36, width: 100, height: 100 }),
      ],
    })).toBe(true);
  });
});

function object(id: string, renderBounds: SpatialSceneObject["renderBounds"]): SpatialSceneObject {
  return {
    id,
    kind: "text",
    bounds: renderBounds,
    renderBounds,
    sourceLayer: "CANVAS",
    protection: "HARD",
    visible: true,
    locked: false,
  };
}
