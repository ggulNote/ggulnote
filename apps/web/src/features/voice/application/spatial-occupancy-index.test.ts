import type { Rect } from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import type {
  SpatialProtection,
  SpatialSceneObject,
  SpatialSceneSnapshot,
} from "../domain";
import {
  RectSpatialOccupancyIndex,
  isRectInside,
  rectDistance,
  rectIntersectionArea,
} from "./spatial-occupancy-index";

function object(
  id: string,
  bounds: Rect,
  protection: SpatialProtection,
): SpatialSceneObject {
  return {
    id,
    kind: "text",
    bounds,
    renderBounds: bounds,
    sourceLayer: "CANVAS",
    semanticRole: "TEXT",
    protection,
    visible: protection !== "IGNORE",
    locked: false,
  };
}

function snapshot(objects: readonly SpatialSceneObject[]): SpatialSceneSnapshot {
  return {
    snapshotId: "spatial:page-1:7:100",
    pageId: "page-1",
    sceneRevision: 7,
    mode: "BLANK",
    coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
    pageBounds: { x: 0, y: 0, width: 400, height: 300 },
    editableBounds: { x: 10, y: 10, width: 380, height: 280 },
    viewportBounds: { x: 10, y: 10, width: 380, height: 280 },
    objects,
    capturedAt: 100,
  };
}

describe("RectSpatialOccupancyIndex", () => {
  it("uses HARD, SOFT, and IGNORE protection in separate calculations", () => {
    const index = new RectSpatialOccupancyIndex({
      snapshot: snapshot([
        object("hard", { x: 100, y: 100, width: 50, height: 50 }, "HARD"),
        object("soft", { x: 160, y: 100, width: 50, height: 50 }, "SOFT"),
        object("ignored", { x: 220, y: 100, width: 50, height: 50 }, "IGNORE"),
      ]),
      minimumClearance: 10,
    });

    expect(index.intersectsHard({ x: 120, y: 120, width: 20, height: 20 })).toBe(true);
    expect(index.hardOverlapArea({ x: 120, y: 120, width: 20, height: 20 })).toBe(400);
    expect(index.softOverlapArea({ x: 170, y: 110, width: 20, height: 20 })).toBe(400);
    expect(index.hardOverlapArea({ x: 230, y: 110, width: 20, height: 20 })).toBe(0);
    expect(index.softObjects.map((entry) => entry.id)).toEqual(["soft"]);
  });

  it("enforces profile clearance without inventing an actual overlap", () => {
    const index = new RectSpatialOccupancyIndex({
      snapshot: snapshot([
        object("hard", { x: 100, y: 100, width: 50, height: 50 }, "HARD"),
      ]),
      minimumClearance: 12,
    });
    const candidate = { x: 80, y: 110, width: 10, height: 10 };

    expect(index.hardOverlapArea(candidate)).toBe(0);
    expect(index.clearance(candidate)).toBe(10);
    expect(index.violatesHardClearance(candidate)).toBe(true);
  });

  it("reports editable containment, nearby ordering, and exclusions deterministically", () => {
    const index = new RectSpatialOccupancyIndex({
      snapshot: snapshot([
        object("far", { x: 300, y: 200, width: 20, height: 20 }, "HARD"),
        object("near", { x: 60, y: 60, width: 20, height: 20 }, "HARD"),
      ]),
      minimumClearance: 4,
      excludedObjectIds: ["near"],
    });

    expect(index.isInsideEditableBounds({ x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(index.isInsideEditableBounds({ x: 0, y: 0, width: 20, height: 20 })).toBe(false);
    expect(index.hardObjects.map((entry) => entry.id)).toEqual(["far"]);
    expect(index.nearby({ x: 250, y: 200, width: 20, height: 20 }, 1)[0]?.id).toBe("far");
  });
});

describe("canonical rect geometry", () => {
  it("rejects invalid geometry instead of clamping it", () => {
    expect(isRectInside(
      { x: -1, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 100, height: 100 },
    )).toBe(false);
    expect(isRectInside(
      { x: 0, y: 0, width: Number.NaN, height: 10 },
      { x: 0, y: 0, width: 100, height: 100 },
    )).toBe(false);
  });

  it("calculates exact canonical overlap and edge distance", () => {
    expect(rectIntersectionArea(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 10, y: 10, width: 20, height: 20 },
    )).toBe(100);
    expect(rectDistance(
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 30, y: 0, width: 20, height: 20 },
    )).toBe(10);
  });
});
