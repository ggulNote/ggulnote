import { describe, expect, it } from "vitest";
import type {
  SpatialPlacementQuery,
  SpatialSceneSnapshot,
  TargetResolutionResult,
} from "../domain";
import { resolveSpatialAnchor } from "./spatial-anchor-resolver";

const SNAPSHOT: SpatialSceneSnapshot = {
  snapshotId: "spatial:page-1:7:100",
  pageId: "page-1",
  sceneRevision: 7,
  mode: "PDF",
  coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
  pageBounds: { x: 0, y: 0, width: 600, height: 800 },
  editableBounds: { x: 20, y: 20, width: 560, height: 760 },
  viewportBounds: { x: 50, y: 80, width: 500, height: 600 },
  focus: {
    source: "VOICE_FROZEN_CONTEXT",
    objectId: "figure-1",
  },
  objects: [{
    id: "figure-1",
    kind: "image",
    bounds: { x: 100, y: 120, width: 200, height: 140 },
    renderBounds: { x: 100, y: 120, width: 200, height: 140 },
    sourceLayer: "PDF_BASE",
    semanticRole: "FIGURE",
    protection: "HARD",
    visible: true,
    locked: true,
  }],
  capturedAt: 100,
};

function query(
  reference: SpatialPlacementQuery["reference"],
): SpatialPlacementQuery {
  return { reference, relation: "BELOW" };
}

function targetResolution(
  revision = 7,
): TargetResolutionResult {
  return {
    status: "RESOLVED",
    confidence: 1,
    evidence: {
      typeMatch: 1,
      lexicalMatch: 1,
      fuzzyMatch: null,
      semanticMatch: null,
      mathMatch: null,
      temporalMatch: null,
      structuralMatch: null,
      focusMatch: null,
    },
    target: {
      kind: "object",
      candidateId: "candidate-figure-1",
      pageId: "page-1",
      sceneRevision: revision,
      source: "pdf",
      type: "image",
      editable: false,
      annotatable: true,
      objectId: "figure-1",
      bounds: { x: 100, y: 120, width: 200, height: 140 },
    },
  };
}

describe("resolveSpatialAnchor", () => {
  it("adapts an existing Stage 3.5 resolved target without grounding it again", () => {
    expect(resolveSpatialAnchor({
      snapshot: SNAPSHOT,
      query: query({
        kind: "TARGET",
        query: { kind: "object", objectType: "image", query: "이 그림" },
      }),
      targetResolution: targetResolution(),
    })).toMatchObject({
      status: "RESOLVED",
      anchor: {
        kind: "OBJECT",
        objectId: "figure-1",
        semanticRole: "FIGURE",
        bounds: { x: 100, y: 120, width: 200, height: 140 },
      },
    });
  });

  it("resolves frozen focus, page, and viewport references from one snapshot", () => {
    expect(resolveSpatialAnchor({
      snapshot: SNAPSHOT,
      query: query({ kind: "FOCUS" }),
    })).toMatchObject({ status: "RESOLVED", anchor: { objectId: "figure-1" } });
    expect(resolveSpatialAnchor({
      snapshot: SNAPSHOT,
      query: query({ kind: "PAGE" }),
    })).toMatchObject({ status: "RESOLVED", anchor: { bounds: SNAPSHOT.editableBounds } });
    expect(resolveSpatialAnchor({
      snapshot: SNAPSHOT,
      query: query({ kind: "VIEWPORT" }),
    })).toMatchObject({ status: "RESOLVED", anchor: { bounds: SNAPSHOT.viewportBounds } });
  });

  it("rejects stale or missing target/focus anchors", () => {
    expect(resolveSpatialAnchor({
      snapshot: SNAPSHOT,
      query: query({
        kind: "TARGET",
        query: { kind: "object", objectType: "image" },
      }),
      targetResolution: targetResolution(8),
    })).toEqual({ status: "STALE_SCENE" });
    expect(resolveSpatialAnchor({
      snapshot: { ...SNAPSHOT, focus: undefined },
      query: query({ kind: "FOCUS" }),
    })).toEqual({ status: "ANCHOR_NOT_FOUND" });
  });
});
