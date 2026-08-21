import type { Rect } from "@ggulnote/editor-core";
import { describe, expect, it, vi } from "vitest";
import type {
  MeasuredDraft,
  PlacementCandidate,
  PlacementProfile,
  ResolvedSpatialAnchor,
  SpatialPlacementQuery,
  SpatialSceneSnapshot,
} from "../domain";
import {
  MultimodalPlacementObservationBuilder,
  buildMultimodalPlacementRenderPlan,
  canonicalRectToScreenshotPixels,
  type SpatialObservationImageProcessor,
} from "./multimodal-placement-observation";
import type { SpatialScreenshotSource } from "./spatial-screenshot-source";

const IMAGE = "data:image/png;base64,AA==";

function snapshot(): SpatialSceneSnapshot {
  return {
    snapshotId: "snapshot-internal-1",
    pageId: "page-1",
    sceneRevision: 7,
    mode: "PDF",
    coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
    pageBounds: { x: 0, y: 0, width: 1_000, height: 1_400 },
    editableBounds: { x: 0, y: 0, width: 1_000, height: 1_400 },
    viewportBounds: { x: 0, y: 0, width: 1_000, height: 1_400 },
    objects: [],
    capturedAt: 1,
  };
}

function candidate(
  internalId: string,
  alias: `S${number}`,
  bounds: Rect,
  alignment: PlacementCandidate["alignment"],
): PlacementCandidate {
  return {
    internalId,
    alias,
    snapshotId: "snapshot-internal-1",
    sceneRevision: 7,
    bounds,
    strategy: "ANCHOR_RELATIVE",
    relation: "BELOW",
    alignment,
    sizeVariant: "PREFERRED",
    evidence: {
      hardOverlapArea: 0,
      softOverlapArea: 0,
      clearance: 40,
      anchorDistance: 20,
      relationSatisfied: true,
      alignmentSatisfied: true,
      preferredSizePreserved: true,
      insideEditableBounds: true,
      regionMatch: true,
      nearbyObjectIds: ["secret-neighbor-id"],
    },
  };
}

const QUERY: SpatialPlacementQuery = {
  reference: { kind: "TARGET", query: { kind: "object", objectType: "image" } },
  relation: "BELOW",
  alignment: "AUTO",
};
const PROFILE: PlacementProfile = {
  capability: "text",
  preferredSize: { width: 200, height: 100 },
  minSize: { width: 100, height: 50 },
  resizePolicy: "FIXED",
  minClearance: 20,
  allowedRelations: ["BELOW"],
  overlayPolicy: "NEVER",
  overflowPolicy: "FAIL",
};
const DRAFT: MeasuredDraft = {
  draftKey: "draft-secret-key",
  capability: "text",
  kind: "NOTE",
  preferredFootprint: { width: 200, height: 100 },
  contentSummary: "diagram explanation",
  measurementSource: "RENDERER",
};
const ANCHOR: ResolvedSpatialAnchor = {
  kind: "OBJECT",
  objectId: "secret-object-id",
  bounds: { x: 300, y: 200, width: 300, height: 200 },
  semanticRole: "FIGURE",
  textPreview: "Transformer architecture diagram",
};

describe("multimodal placement observation", () => {
  it("maps PAGE_CANONICAL geometry to screenshot pixels without zoom or DPR", () => {
    expect(canonicalRectToScreenshotPixels(
      { x: 100, y: 280, width: 200, height: 140 },
      snapshot().pageBounds,
      500,
      700,
    )).toEqual({ x: 50, y: 140, width: 100, height: 70 });
  });

  it("builds a bounded global overview and anchor/candidate local crop", () => {
    const plan = buildMultimodalPlacementRenderPlan({
      screenshot: {
        pageId: "page-1",
        sceneRevision: 7,
        canonicalPageBounds: snapshot().pageBounds,
        pixelWidth: 2_000,
        pixelHeight: 2_800,
        imageDataUrl: IMAGE,
        byteLength: 1,
        capturedAt: 2,
        markers: [],
      },
      anchor: ANCHOR,
      candidates: [
        candidate("internal-a", "S6", { x: 300, y: 440, width: 200, height: 100 }, "START"),
        candidate("internal-b", "S5", { x: 400, y: 440, width: 200, height: 100 }, "CENTER"),
      ],
    });
    expect(plan.globalOverview.outputSize).toEqual({ width: 914, height: 1_280 });
    expect(plan.localCandidateCrop.sourcePixels).toEqual({
      x: 552,
      y: 352,
      width: 696,
      height: 776,
    });
    expect(plan.localCandidateCrop.marks.map((mark) => mark.alias)).toEqual(["S1", "S2"]);
    expect(plan.localCandidateCrop.marks[0]?.footprint.width).toBeGreaterThan(0);
  });

  it("uses candidate union when a FREE_SPACE request has no anchor", () => {
    const plan = buildMultimodalPlacementRenderPlan({
      screenshot: {
        pageId: "page-1",
        sceneRevision: 7,
        canonicalPageBounds: snapshot().pageBounds,
        pixelWidth: 500,
        pixelHeight: 700,
        imageDataUrl: IMAGE,
        byteLength: 1,
        capturedAt: 2,
        markers: [],
      },
      candidates: [
        candidate("a", "S1", { x: 100, y: 200, width: 200, height: 100 }, "START"),
        candidate("b", "S2", { x: 500, y: 600, width: 200, height: 100 }, "END"),
      ],
    });
    expect(plan.localCandidateCrop.sourcePixels).toEqual({
      x: 38,
      y: 88,
      width: 324,
      height: 274,
    });
  });

  it("places adjacent alias badges deterministically without overlap", () => {
    const input = {
      screenshot: {
        pageId: "page-1",
        sceneRevision: 7,
        canonicalPageBounds: snapshot().pageBounds,
        pixelWidth: 500,
        pixelHeight: 700,
        imageDataUrl: IMAGE,
        byteLength: 1,
        capturedAt: 2,
        markers: [],
      },
      anchor: ANCHOR,
      candidates: [
        candidate("a", "S1", { x: 300, y: 440, width: 200, height: 100 }, "START"),
        candidate("b", "S2", { x: 310, y: 440, width: 200, height: 100 }, "CENTER"),
        candidate("c", "S3", { x: 320, y: 440, width: 200, height: 100 }, "END"),
      ],
    } as const;
    const first = buildMultimodalPlacementRenderPlan(input);
    const second = buildMultimodalPlacementRenderPlan(input);
    expect(second).toEqual(first);
    const badges = first.localCandidateCrop.marks.map((mark) => mark.badge);
    for (let index = 0; index < badges.length; index += 1) {
      for (let other = index + 1; other < badges.length; other += 1) {
        expect(intersects(badges[index]!, badges[other]!)).toBe(false);
      }
    }
  });

  it("builds request-scoped aliases and redacted compact metadata", async () => {
    const capture = vi.fn<SpatialScreenshotSource["capture"]>().mockResolvedValue({
      status: "READY",
      screenshot: {
        pageId: "page-1",
        sceneRevision: 7,
        canonicalPageBounds: snapshot().pageBounds,
        pixelWidth: 500,
        pixelHeight: 700,
        imageDataUrl: IMAGE,
        byteLength: 1,
        capturedAt: 2,
        markers: [],
      },
    });
    const render = vi.fn<SpatialObservationImageProcessor["render"]>().mockResolvedValue({
      globalOverview: { dataUrl: IMAGE, pixelWidth: 500, pixelHeight: 700, byteLength: 1 },
      localCandidateCrop: { dataUrl: IMAGE, pixelWidth: 300, pixelHeight: 220, byteLength: 1 },
    });
    const builder = new MultimodalPlacementObservationBuilder({
      screenshotSource: { capture },
      imageProcessor: { render },
      now: () => 10,
      createObservationId: () => "request-scoped-observation",
    });
    const result = await builder.build({
      snapshot: snapshot(),
      query: QUERY,
      profile: PROFILE,
      draft: DRAFT,
      anchor: ANCHOR,
      instruction: "  이 그림 아래에   메모 추가  ",
      candidates: [
        candidate("secret-internal-a", "S6", { x: 300, y: 440, width: 200, height: 100 }, "START"),
        candidate("secret-internal-b", "S4", { x: 400, y: 440, width: 200, height: 100 }, "CENTER"),
      ],
    });
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(capture).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(result.observation.request.candidates.map((item) => item.alias))
      .toEqual(["S1", "S2"]);
    expect(result.observation.aliasMap.get("S1")?.internalId).toBe("secret-internal-a");
    expect(result.observation.request.instruction).toBe("이 그림 아래에 메모 추가");
    const serialized = JSON.stringify(result.observation.request);
    expect(serialized).not.toContain("secret-internal");
    expect(serialized).not.toContain("secret-object-id");
    expect(serialized).not.toContain("secret-neighbor-id");
    expect(serialized).not.toContain("draft-secret-key");
    expect(collectKeys(result.observation.request)).not.toEqual(
      expect.arrayContaining(["x", "y", "width", "height", "bounds", "rect", "objectId", "candidateId"]),
    );
  });

  it("rejects stale candidate/screenshot identity before provider metadata exists", async () => {
    const capture = vi.fn<SpatialScreenshotSource["capture"]>();
    const render = vi.fn<SpatialObservationImageProcessor["render"]>();
    const builder = new MultimodalPlacementObservationBuilder({
      screenshotSource: { capture },
      imageProcessor: { render },
    });
    const stale = candidate("a", "S1", { x: 300, y: 440, width: 200, height: 100 }, "START");
    const result = await builder.build({
      snapshot: snapshot(),
      query: QUERY,
      profile: PROFILE,
      draft: DRAFT,
      instruction: "memo",
      candidates: [{ ...stale, sceneRevision: 6 }, candidate("b", "S2", { x: 500, y: 440, width: 200, height: 100 }, "END")],
    });
    expect(result.status).toBe("STALE_SCENE");
    expect(capture).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});

function intersects(left: Rect, right: Rect): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}
