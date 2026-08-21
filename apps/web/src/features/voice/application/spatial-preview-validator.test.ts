import type { Rect } from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import type {
  MeasuredDraft,
  PlacementCandidate,
  PlacementProfile,
  ResolvedSpatialAnchor,
  SpatialPlacementQuery,
  SpatialSceneObject,
  SpatialSceneSnapshot,
} from "../domain";
import type { SpatialPreviewSession } from "./spatial-preview-renderer";
import { validateSpatialPreview } from "./spatial-preview-validator";

const CANDIDATE_BOUNDS = { x: 100, y: 160, width: 200, height: 80 };
const ANCHOR: ResolvedSpatialAnchor = {
  kind: "OBJECT",
  objectId: "anchor-1",
  bounds: { x: 100, y: 50, width: 200, height: 100 },
  semanticRole: "FIGURE",
};
const QUERY: SpatialPlacementQuery = {
  reference: { kind: "TARGET", query: { kind: "object", objectType: "image" } },
  relation: "BELOW",
  alignment: "START",
  overlayIntent: "NONE",
};
const PROFILE: PlacementProfile = {
  capability: "text",
  preferredSize: { width: 200, height: 80 },
  minSize: { width: 100, height: 40 },
  resizePolicy: "FIXED",
  minClearance: 10,
  allowedRelations: ["BELOW", "INSIDE"],
  overlayPolicy: "EXPLICIT_ONLY",
  overflowPolicy: "FAIL",
};
const DRAFT: MeasuredDraft = {
  draftKey: "draft-1",
  capability: "text",
  kind: "NOTE",
  preferredFootprint: { width: 200, height: 80 },
  measurementSource: "RENDERER",
};

function scene(objects: readonly SpatialSceneObject[] = [
  object("anchor-1", ANCHOR.bounds, "HARD"),
]): SpatialSceneSnapshot {
  return {
    snapshotId: "snapshot-1",
    pageId: "page-1",
    sceneRevision: 7,
    mode: "PDF",
    coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
    pageBounds: { x: 0, y: 0, width: 600, height: 800 },
    editableBounds: { x: 0, y: 0, width: 600, height: 800 },
    viewportBounds: { x: 0, y: 0, width: 600, height: 800 },
    objects,
    capturedAt: 1,
  };
}

function object(
  id: string,
  bounds: Rect,
  protection: SpatialSceneObject["protection"],
): SpatialSceneObject {
  return {
    id,
    kind: "annotation",
    bounds,
    renderBounds: bounds,
    sourceLayer: id === "anchor-1" ? "PDF_BASE" : "ANNOTATION",
    semanticRole: id === "anchor-1" ? "FIGURE" : "OTHER",
    protection,
    visible: true,
    locked: protection === "HARD",
  };
}

function candidate(bounds: Rect = CANDIDATE_BOUNDS): PlacementCandidate {
  return {
    internalId: "candidate-a",
    alias: "S1",
    snapshotId: "snapshot-1",
    sceneRevision: 7,
    bounds,
    strategy: "ANCHOR_RELATIVE",
    relation: "BELOW",
    alignment: "START",
    sizeVariant: "PREFERRED",
    evidence: {
      hardOverlapArea: 0,
      softOverlapArea: 0,
      clearance: 10,
      anchorDistance: 10,
      relationSatisfied: true,
      alignmentSatisfied: true,
      preferredSizePreserved: true,
      insideEditableBounds: true,
      regionMatch: true,
      nearbyObjectIds: [],
    },
  };
}

function preview(
  actualRenderBounds: Rect,
  overrides: Partial<SpatialPreviewSession> = {},
): SpatialPreviewSession {
  return {
    rendererId: "fake-renderer",
    snapshotId: "snapshot-1",
    pageId: "page-1",
    sceneRevision: 7,
    candidateInternalId: "candidate-a",
    draftKey: "draft-1",
    actualRenderBounds,
    dispose: () => undefined,
    ...overrides,
  };
}

function validate(
  actual: Rect,
  overrides: Partial<Parameters<typeof validateSpatialPreview>[0]> = {},
) {
  const selected = overrides.candidate ?? candidate();
  return validateSpatialPreview({
    scene: scene(),
    query: QUERY,
    profile: PROFILE,
    draft: DRAFT,
    candidate: selected,
    preview: preview(actual, {
      candidateInternalId: selected.internalId,
    }),
    anchor: ANCHOR,
    sceneRevisionMatched: true,
    ...overrides,
  });
}

describe("validateSpatialPreview", () => {
  it("validates a smaller actual render in the selected footprint", () => {
    const result = validate({ x: 100, y: 160, width: 198, height: 78 });
    expect(result.status).toBe("VALID");
    expect(result.evidence).toMatchObject({
      finiteGeometry: true,
      insideEditableBounds: true,
      footprintFits: true,
      hardCollisionFree: true,
      clearanceSatisfied: true,
      relationSatisfied: true,
      alignmentSatisfied: true,
      sceneRevisionMatched: true,
    });
  });

  it("allows one-pixel canvas stroke and A4 raster rounding", () => {
    const a4ScaleX = 595.28 / 595;
    const a4ScaleY = 841.89 / 842;
    const selected: PlacementCandidate = {
      ...candidate({ x: 0, y: 0, width: 240, height: 96 }),
      strategy: "FREE_SPACE",
      relation: "FREE_SPACE",
    };
    const actual = {
      x: 0,
      y: 0,
      width: 241 * a4ScaleX,
      height: 97 * a4ScaleY,
    };
    const result = validate(actual, {
      scene: {
        ...scene([]),
        pageBounds: { x: 0, y: 0, width: 595.28, height: 841.89 },
        editableBounds: { x: 0, y: 0, width: 595.28, height: 841.89 },
        viewportBounds: { x: 0, y: 0, width: 595.28, height: 841.89 },
      },
      query: {
        reference: { kind: "PAGE" },
        relation: "FREE_SPACE",
        regionHint: "TOP",
        alignment: "START",
        overlayIntent: "NONE",
      },
      candidate: selected,
      preview: preview(actual, { candidateInternalId: selected.internalId }),
      anchor: undefined,
    });

    expect(result).toMatchObject({
      status: "VALID",
      evidence: {
        insideEditableBounds: true,
        footprintFits: true,
        alignmentSatisfied: true,
      },
    });
  });

  it("rejects text-wrap footprint overflow without clamping", () => {
    const actual = { x: 100, y: 160, width: 240, height: 110 };
    const result = validate(actual);
    expect(result).toMatchObject({
      status: "INVALID",
      reason: "FOOTPRINT_OVERFLOW",
      actualRenderBounds: actual,
    });
  });

  it("rejects table placeholder size drift through the same generic contract", () => {
    const tableProfile: PlacementProfile = {
      ...PROFILE,
      capability: "table",
    };
    const tableDraft: MeasuredDraft = {
      ...DRAFT,
      capability: "table",
      kind: "TABLE",
    };
    const actual = { x: 100, y: 160, width: 240, height: 110 };
    const result = validateSpatialPreview({
      scene: scene(),
      query: QUERY,
      profile: tableProfile,
      draft: tableDraft,
      candidate: candidate(),
      preview: preview(actual),
      anchor: ANCHOR,
      sceneRevisionMatched: true,
    });
    expect(result).toMatchObject({
      status: "INVALID",
      reason: "FOOTPRINT_OVERFLOW",
      actualRenderBounds: actual,
    });
  });

  it("rejects a hard collision using actual bounds and minimum clearance", () => {
    const blocker = object(
      "pdf-text",
      { x: 250, y: 180, width: 80, height: 40 },
      "HARD",
    );
    const result = validate(CANDIDATE_BOUNDS, {
      scene: scene([object("anchor-1", ANCHOR.bounds, "HARD"), blocker]),
    });
    expect(result).toMatchObject({
      status: "INVALID",
      reason: "HARD_COLLISION",
      evidence: { hardCollisionFree: false },
    });
  });

  it("keeps soft overlap valid and records overlap evidence", () => {
    const highlight = object(
      "highlight-1",
      { x: 120, y: 170, width: 60, height: 10 },
      "SOFT",
    );
    const result = validate(CANDIDATE_BOUNDS, {
      scene: scene([object("anchor-1", ANCHOR.bounds, "HARD"), highlight]),
    });
    expect(result.status).toBe("VALID");
    expect(result.evidence.softOverlapArea).toBe(600);
    expect(result.evidence.softOverlapObjectCount).toBe(1);
  });

  it("rejects out-of-bounds actual geometry without moving it", () => {
    const actual = { x: 500, y: 760, width: 120, height: 60 };
    const result = validate(actual, {
      candidate: candidate({ x: 500, y: 720, width: 100, height: 80 }),
      anchor: {
        ...ANCHOR,
        bounds: { x: 500, y: 600, width: 100, height: 100 },
      },
    });
    expect(result).toMatchObject({
      status: "INVALID",
      reason: "OUT_OF_BOUNDS",
      actualRenderBounds: actual,
    });
  });

  it("rejects a BELOW render that bleeds into the anchor clearance", () => {
    const result = validate({ x: 100, y: 154, width: 198, height: 78 });
    expect(result).toMatchObject({
      status: "INVALID",
      reason: "FOOTPRINT_OVERFLOW",
      evidence: { relationSatisfied: false },
    });
  });

  it("rejects actual render bounds below the profile minimum size", () => {
    const result = validate({ x: 100, y: 160, width: 80, height: 30 });
    expect(result).toMatchObject({
      status: "INVALID",
      reason: "MINIMUM_SIZE",
      evidence: { minimumSizeSatisfied: false },
    });
  });

  it("reports relation violation from actual bounds independently of candidate estimates", () => {
    const relationCandidate = candidate({ x: 100, y: 150, width: 200, height: 80 });
    const actual = { x: 100, y: 150, width: 198, height: 78 };
    const result = validate(actual, {
      scene: scene([]),
      candidate: relationCandidate,
      preview: preview(actual, {
        candidateInternalId: relationCandidate.internalId,
      }),
    });
    expect(result).toMatchObject({
      status: "INVALID",
      reason: "RELATION_VIOLATION",
      evidence: { relationSatisfied: false },
    });
  });

  it("rejects explicit alignment drift while AUTO accepts selected geometry", () => {
    const centeredCandidate = candidate({ x: 100, y: 160, width: 200, height: 80 });
    const actual = { x: 100, y: 160, width: 150, height: 70 };
    const explicit = validate(actual, {
      candidate: centeredCandidate,
      query: { ...QUERY, alignment: "CENTER" },
      preview: preview(actual, { candidateInternalId: centeredCandidate.internalId }),
    });
    const automatic = validate(actual, {
      candidate: centeredCandidate,
      query: { ...QUERY, alignment: "AUTO" },
      preview: preview(actual, { candidateInternalId: centeredCandidate.internalId }),
    });
    expect(explicit).toMatchObject({
      status: "INVALID",
      reason: "ALIGNMENT_VIOLATION",
    });
    expect(automatic.status).toBe("VALID");
  });

  it.each([
    { x: Number.NaN, y: 160, width: 200, height: 80 },
    { x: 100, y: 160, width: Number.POSITIVE_INFINITY, height: 80 },
    { x: 100, y: 160, width: -1, height: 80 },
    { x: 100, y: 160, width: 200, height: 0 },
  ])("rejects invalid renderer geometry", (actual) => {
    const result = validate(actual);
    expect(result).toMatchObject({
      status: "INVALID",
      reason: "INVALID_RENDER_GEOMETRY",
    });
  });

  it("requires request-scoped draft, candidate, and scene identities", () => {
    expect(validate(CANDIDATE_BOUNDS, {
      preview: preview(CANDIDATE_BOUNDS, { draftKey: "other-draft" }),
    })).toMatchObject({ status: "INVALID", reason: "DRAFT_IDENTITY_MISMATCH" });
    expect(validate(CANDIDATE_BOUNDS, {
      preview: preview(CANDIDATE_BOUNDS, { candidateInternalId: "other" }),
    })).toMatchObject({ status: "INVALID", reason: "CANDIDATE_IDENTITY_MISMATCH" });
    expect(validate(CANDIDATE_BOUNDS, {
      sceneRevisionMatched: false,
    })).toMatchObject({ status: "INVALID", reason: "SCENE_REVISION_MISMATCH" });
  });

  it("allows INSIDE only with explicit overlay and profile permission", () => {
    const insideBounds = { x: 120, y: 70, width: 100, height: 50 };
    const insideCandidate = {
      ...candidate(insideBounds),
      relation: "INSIDE" as const,
    };
    const explicit = validateSpatialPreview({
      scene: scene(),
      query: {
        ...QUERY,
        relation: "INSIDE",
        alignment: "AUTO",
        overlayIntent: "EXPLICIT",
      },
      profile: PROFILE,
      draft: DRAFT,
      candidate: insideCandidate,
      preview: preview(insideBounds, {
        candidateInternalId: insideCandidate.internalId,
      }),
      anchor: ANCHOR,
      sceneRevisionMatched: true,
    });
    const implicit = validateSpatialPreview({
      scene: scene(),
      query: {
        ...QUERY,
        relation: "INSIDE",
        alignment: "AUTO",
        overlayIntent: "NONE",
      },
      profile: PROFILE,
      draft: DRAFT,
      candidate: insideCandidate,
      preview: preview(insideBounds, {
        candidateInternalId: insideCandidate.internalId,
      }),
      anchor: ANCHOR,
      sceneRevisionMatched: true,
    });
    expect(explicit.status).toBe("VALID");
    expect(implicit).toMatchObject({
      status: "INVALID",
      reason: "OVERLAY_POLICY",
      evidence: { overlayPolicySatisfied: false },
    });
  });
});
