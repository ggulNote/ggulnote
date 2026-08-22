import { describe, expect, it } from "vitest";
import type { MeasuredDraft, SpatialSceneSnapshot } from "../../domain";
import { projectCanvasPlacement } from "./placement-engine";

const SNAPSHOT = {
  pageBounds: { x: 0, y: 0, width: 600, height: 800 },
} as SpatialSceneSnapshot;

const DRAFT: MeasuredDraft = {
  draftKey: "draft-1",
  capability: "text",
  kind: "NOTE",
  preferredFootprint: { width: 100, height: 30 },
  compactFootprint: { width: 80, height: 24 },
  measurementSource: "RENDERER",
};

describe("projectCanvasPlacement", () => {
  it("projects model-owned normalized geometry directly into page coordinates", () => {
    expect(projectCanvasPlacement({
      placement: { x: 0.5, y: 0.25, width: 0.2, height: 0.1 },
      snapshot: SNAPSHOT,
      draft: DRAFT,
    })).toEqual({
      status: "RESOLVED",
      bounds: { x: 300, y: 200, width: 120, height: 80 },
    });
  });

  it("uses measured size only when the Decision omits size and clamps structurally", () => {
    expect(projectCanvasPlacement({
      placement: { x: 0.9, y: 0.99, width: null, height: null },
      snapshot: SNAPSHOT,
      draft: DRAFT,
    })).toEqual({
      status: "RESOLVED",
      bounds: { x: 500, y: 770, width: 100, height: 30 },
    });
  });
});
