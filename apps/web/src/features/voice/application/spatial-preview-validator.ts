import type { Rect } from "@ggulnote/editor-core";
import type {
  MeasuredDraft,
  PlacementCandidate,
  PlacementProfile,
  ResolvedSpatialAnchor,
  SpatialAlignment,
  SpatialPlacementQuery,
  SpatialPreviewValidationEvidence,
  SpatialPreviewValidationFailureReason,
  SpatialPreviewValidationResult,
  SpatialSceneSnapshot,
} from "../domain";
import { satisfiesSpatialPlacementRelation } from "./placement-candidate-engine";
import type { SpatialPreviewSession } from "./spatial-preview-renderer";
import {
  RectSpatialOccupancyIndex,
  SPATIAL_GEOMETRY_EPSILON,
  isFinitePositiveRect,
  rectBottom,
  rectIntersectionArea,
  rectRight,
} from "./spatial-occupancy-index";

// NativeCanvasRenderer centers its one-pixel outline on the assigned bounds.
// Converting integer raster pixels back to fractional PAGE_CANONICAL A4
// geometry can add slightly more than one canonical pixel at an edge.
export const SPATIAL_PREVIEW_RENDER_TOLERANCE = 2;

export interface SpatialPreviewValidationInput {
  readonly scene: SpatialSceneSnapshot;
  readonly query: SpatialPlacementQuery;
  readonly profile: PlacementProfile;
  readonly draft: MeasuredDraft;
  readonly candidate: PlacementCandidate;
  readonly preview: SpatialPreviewSession;
  readonly anchor?: ResolvedSpatialAnchor;
  readonly sceneRevisionMatched: boolean;
  readonly renderTolerance?: number;
}

export function validateSpatialPreview(
  input: SpatialPreviewValidationInput,
): SpatialPreviewValidationResult {
  const actual = input.preview.actualRenderBounds;
  const tolerance = validTolerance(input.renderTolerance)
    ? input.renderTolerance
    : SPATIAL_PREVIEW_RENDER_TOLERANCE;
  const finiteGeometry = isFinitePositiveRect(actual);
  const sceneRevisionMatched = input.sceneRevisionMatched
    && input.preview.snapshotId === input.scene.snapshotId
    && input.preview.pageId === input.scene.pageId
    && input.preview.sceneRevision === input.scene.sceneRevision;
  const draftIdentityMatched = input.profile.capability === input.draft.capability
    && input.preview.draftKey === input.draft.draftKey;
  const candidateIdentityMatched = input.candidate.snapshotId === input.scene.snapshotId
    && input.candidate.sceneRevision === input.scene.sceneRevision
    && input.candidate.relation === input.query.relation
    && input.preview.candidateInternalId === input.candidate.internalId;

  if (!finiteGeometry) {
    return invalid(
      "INVALID_RENDER_GEOMETRY",
      actual,
      emptyEvidence({
        finiteGeometry,
        sceneRevisionMatched,
        draftIdentityMatched,
        candidateIdentityMatched,
      }),
    );
  }
  if (!sceneRevisionMatched) {
    return invalid(
      "SCENE_REVISION_MISMATCH",
      actual,
      emptyEvidence({
        finiteGeometry,
        sceneRevisionMatched,
        draftIdentityMatched,
        candidateIdentityMatched,
      }),
    );
  }
  if (!draftIdentityMatched) {
    return invalid(
      "DRAFT_IDENTITY_MISMATCH",
      actual,
      emptyEvidence({
        finiteGeometry,
        sceneRevisionMatched,
        draftIdentityMatched,
        candidateIdentityMatched,
      }),
    );
  }
  if (!candidateIdentityMatched) {
    return invalid(
      "CANDIDATE_IDENTITY_MISMATCH",
      actual,
      emptyEvidence({
        finiteGeometry,
        sceneRevisionMatched,
        draftIdentityMatched,
        candidateIdentityMatched,
      }),
    );
  }

  const excludedObjectIds = overlayAnchorExclusion(input);
  const occupancy = new RectSpatialOccupancyIndex({
    snapshot: input.scene,
    minimumClearance: input.profile.minClearance,
    excludedObjectIds,
  });
  const insideEditableBounds = occupancy.isInsideEditableBounds(actual);
  const footprintFits = isInsideWithTolerance(
    actual,
    input.candidate.bounds,
    tolerance,
  );
  const minimumSizeSatisfied = actual.width + SPATIAL_GEOMETRY_EPSILON
      >= input.profile.minSize.width
    && actual.height + SPATIAL_GEOMETRY_EPSILON
      >= input.profile.minSize.height;
  const hardOverlapArea = occupancy.hardOverlapArea(actual);
  const hardCollisionFree = hardOverlapArea <= SPATIAL_GEOMETRY_EPSILON;
  const clearanceSatisfied = !occupancy.violatesHardClearance(actual);
  const softOverlapArea = occupancy.softOverlapArea(actual);
  const softOverlapObjectCount = occupancy.softObjects.filter(
    (object) => rectIntersectionArea(actual, object.renderBounds) > 0,
  ).length;
  const relationSatisfied = satisfiesSpatialPlacementRelation(
    actual,
    input.anchor?.bounds,
    input.query.relation,
    input.profile.minClearance,
    tolerance,
  );
  const alignmentSatisfied = satisfiesExplicitAlignment(
    actual,
    input.anchor?.bounds,
    input.candidate.bounds,
    input.query.alignment,
    input.query.relation,
    tolerance,
  );
  const overlayPolicySatisfied = satisfiesOverlayPolicy(input, actual);
  const evidence: SpatialPreviewValidationEvidence = Object.freeze({
    finiteGeometry,
    insideEditableBounds,
    footprintFits,
    minimumSizeSatisfied,
    hardOverlapArea,
    hardCollisionFree,
    clearanceSatisfied,
    softOverlapArea,
    softOverlapObjectCount,
    relationSatisfied,
    alignmentSatisfied,
    overlayPolicySatisfied,
    sceneRevisionMatched,
    draftIdentityMatched,
    candidateIdentityMatched,
  });

  const reason = firstFailure(evidence);
  return reason === undefined
    ? {
        status: "VALID",
        actualRenderBounds: freezeRect(actual),
        evidence,
      }
    : invalid(reason, actual, evidence);
}

function firstFailure(
  evidence: SpatialPreviewValidationEvidence,
): SpatialPreviewValidationFailureReason | undefined {
  if (!evidence.insideEditableBounds) return "OUT_OF_BOUNDS";
  if (!evidence.footprintFits) return "FOOTPRINT_OVERFLOW";
  if (!evidence.minimumSizeSatisfied) return "MINIMUM_SIZE";
  if (!evidence.overlayPolicySatisfied) return "OVERLAY_POLICY";
  if (!evidence.hardCollisionFree || !evidence.clearanceSatisfied) {
    return "HARD_COLLISION";
  }
  if (!evidence.relationSatisfied) return "RELATION_VIOLATION";
  if (!evidence.alignmentSatisfied) return "ALIGNMENT_VIOLATION";
  return undefined;
}

function satisfiesExplicitAlignment(
  actual: Rect,
  anchor: Rect | undefined,
  candidate: Rect,
  requested: SpatialAlignment | undefined,
  relation: SpatialPlacementQuery["relation"],
  tolerance: number,
): boolean {
  if (requested === undefined || requested === "AUTO") return true;
  if (anchor === undefined) {
    return relation === "FREE_SPACE"
      || alignedOnBothAxes(actual, candidate, requested, tolerance);
  }
  if (relation === "ABOVE" || relation === "BELOW") {
    return alignedOnAxis(
      actual.x,
      actual.width,
      anchor.x,
      anchor.width,
      requested,
      tolerance,
    );
  }
  if (relation === "LEFT_OF" || relation === "RIGHT_OF") {
    return alignedOnAxis(
      actual.y,
      actual.height,
      anchor.y,
      anchor.height,
      requested,
      tolerance,
    );
  }
  if (relation === "INSIDE" || relation === "AT") {
    return alignedOnBothAxes(actual, anchor, requested, tolerance);
  }
  return alignedOnBothAxes(actual, candidate, requested, tolerance);
}

function alignedOnBothAxes(
  actual: Rect,
  reference: Rect,
  alignment: Exclude<SpatialAlignment, "AUTO">,
  tolerance: number,
): boolean {
  return alignedOnAxis(
    actual.x,
    actual.width,
    reference.x,
    reference.width,
    alignment,
    tolerance,
  ) && alignedOnAxis(
    actual.y,
    actual.height,
    reference.y,
    reference.height,
    alignment,
    tolerance,
  );
}

function alignedOnAxis(
  actualStart: number,
  actualSpan: number,
  referenceStart: number,
  referenceSpan: number,
  alignment: Exclude<SpatialAlignment, "AUTO">,
  tolerance: number,
): boolean {
  switch (alignment) {
    case "START":
      return approximately(actualStart, referenceStart, tolerance);
    case "CENTER":
      return approximately(
        actualStart + actualSpan / 2,
        referenceStart + referenceSpan / 2,
        tolerance,
      );
    case "END":
      return approximately(
        actualStart + actualSpan,
        referenceStart + referenceSpan,
        tolerance,
      );
  }
}

function satisfiesOverlayPolicy(
  input: SpatialPreviewValidationInput,
  actual: Rect,
): boolean {
  if (input.anchor?.kind !== "OBJECT") return true;
  const overlapsAnchor = rectIntersectionArea(actual, input.anchor.bounds) > 0;
  if (!overlapsAnchor) return true;
  return input.query.overlayIntent === "EXPLICIT"
    && input.profile.overlayPolicy !== "NEVER";
}

function overlayAnchorExclusion(
  input: SpatialPreviewValidationInput,
): readonly string[] {
  return (input.query.relation === "AT" || input.query.relation === "INSIDE")
    && input.query.overlayIntent === "EXPLICIT"
    && input.profile.overlayPolicy !== "NEVER"
    && input.anchor?.objectId !== undefined
    ? [input.anchor.objectId]
    : [];
}

function isInsideWithTolerance(
  inner: Rect,
  outer: Rect,
  tolerance: number,
): boolean {
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && rectRight(inner) <= rectRight(outer) + tolerance
    && rectBottom(inner) <= rectBottom(outer) + tolerance;
}

function approximately(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

function validTolerance(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function invalid(
  reason: SpatialPreviewValidationFailureReason,
  actual: Rect,
  evidence: SpatialPreviewValidationEvidence,
): SpatialPreviewValidationResult {
  return {
    status: "INVALID",
    reason,
    actualRenderBounds: freezeRect(actual),
    evidence,
  };
}

function emptyEvidence(
  overrides: Partial<SpatialPreviewValidationEvidence>,
): SpatialPreviewValidationEvidence {
  return Object.freeze({
    finiteGeometry: false,
    insideEditableBounds: false,
    footprintFits: false,
    minimumSizeSatisfied: false,
    hardOverlapArea: 0,
    hardCollisionFree: false,
    clearanceSatisfied: false,
    softOverlapArea: 0,
    softOverlapObjectCount: 0,
    relationSatisfied: false,
    alignmentSatisfied: false,
    overlayPolicySatisfied: false,
    sceneRevisionMatched: false,
    draftIdentityMatched: false,
    candidateIdentityMatched: false,
    ...overrides,
  });
}

function freezeRect(rect: Rect): Rect {
  return Object.freeze({ ...rect });
}
