import type { Rect } from "@ggulnote/editor-core";
import type {
  MeasuredDraft,
  PlacementCandidate,
  SpatialSceneSnapshot,
} from "./spatial-placement-types";

export type SpatialPlacementSelectionSource = "DETERMINISTIC" | "MULTIMODAL";

export interface SelectedSpatialPlacement {
  readonly snapshotId: SpatialSceneSnapshot["snapshotId"];
  readonly pageId: SpatialSceneSnapshot["pageId"];
  readonly sceneRevision: SpatialSceneSnapshot["sceneRevision"];
  readonly candidate: PlacementCandidate;
  readonly source: SpatialPlacementSelectionSource;
}

export type SpatialPreviewValidationFailureReason =
  | "INVALID_RENDER_GEOMETRY"
  | "OUT_OF_BOUNDS"
  | "FOOTPRINT_OVERFLOW"
  | "MINIMUM_SIZE"
  | "HARD_COLLISION"
  | "RELATION_VIOLATION"
  | "ALIGNMENT_VIOLATION"
  | "OVERLAY_POLICY"
  | "DRAFT_IDENTITY_MISMATCH"
  | "CANDIDATE_IDENTITY_MISMATCH"
  | "SCENE_REVISION_MISMATCH";

export interface SpatialPreviewValidationEvidence {
  readonly finiteGeometry: boolean;
  readonly insideEditableBounds: boolean;
  readonly footprintFits: boolean;
  readonly minimumSizeSatisfied: boolean;
  readonly hardOverlapArea: number;
  readonly hardCollisionFree: boolean;
  readonly clearanceSatisfied: boolean;
  readonly softOverlapArea: number;
  readonly softOverlapObjectCount: number;
  readonly relationSatisfied: boolean;
  readonly alignmentSatisfied: boolean;
  readonly overlayPolicySatisfied: boolean;
  readonly sceneRevisionMatched: boolean;
  readonly draftIdentityMatched: boolean;
  readonly candidateIdentityMatched: boolean;
}

export type SpatialPreviewValidationResult =
  | {
      readonly status: "VALID";
      readonly actualRenderBounds: Rect;
      readonly evidence: SpatialPreviewValidationEvidence;
    }
  | {
      readonly status: "INVALID";
      readonly reason: SpatialPreviewValidationFailureReason;
      readonly actualRenderBounds: Rect;
      readonly evidence: SpatialPreviewValidationEvidence;
    };

export interface ValidatedSpatialPlacement {
  readonly snapshotId: SpatialSceneSnapshot["snapshotId"];
  readonly pageId: SpatialSceneSnapshot["pageId"];
  readonly sceneRevision: SpatialSceneSnapshot["sceneRevision"];
  readonly candidate: PlacementCandidate;
  readonly candidateInternalId: PlacementCandidate["internalId"];
  readonly draftKey: MeasuredDraft["draftKey"];
  readonly requestedBounds: Rect;
  readonly actualRenderBounds: Rect;
  readonly selectionSource:
    | SpatialPlacementSelectionSource
    | "VALIDATION_FALLBACK";
  readonly previewAttemptCount: 1 | 2;
  readonly validationEvidence: SpatialPreviewValidationEvidence;
}

export type SpatialPreviewResolutionFailureStatus =
  | "VALIDATION_FAILED"
  | "PREVIEW_UNAVAILABLE"
  | "PREVIEW_RENDER_FAILED"
  | "STALE_SCENE"
  | "ABORTED";
