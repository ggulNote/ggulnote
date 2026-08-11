import type {
  CapabilityId,
  Point,
  Rect,
  SceneObject,
  SceneSnapshot,
  Size,
} from "@ggulnote/editor-core";
import type {
  SpatialAlignment,
  SpatialPlacementQuery,
  SpatialPlacementRelation,
} from "./spatial-placement-query";
import type { ResolvedTarget, TargetResolutionResult } from "./target-grounding-types";

export type SpatialSceneMode = "PDF" | "BLANK";
export type SpatialProtection = "HARD" | "SOFT" | "IGNORE";
export type SpatialSourceLayer = "PDF_BASE" | "ANNOTATION" | "CANVAS";

export type SpatialSemanticRole =
  | "TEXT"
  | "FIGURE"
  | "TABLE"
  | "FORMULA"
  | "HANDWRITING"
  | "GRAPH"
  | "NOTE"
  | "OTHER";

export interface ProtectionPolicy {
  classify(object: SceneObject): SpatialProtection;
}

export interface SpatialSceneObject {
  readonly id: SceneObject["id"];
  readonly kind: SceneObject["kind"];
  readonly bounds: Rect;
  readonly renderBounds: Rect;
  readonly sourceLayer: SpatialSourceLayer;
  readonly semanticRole?: SpatialSemanticRole;
  readonly protection: SpatialProtection;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly readingOrder?: number;
  readonly zIndex?: number;
  readonly textPreview?: string;
}

export interface FrozenSpatialFocus {
  readonly source:
    | "SELECTION"
    | "POINTER"
    | "VOICE_FROZEN_CONTEXT"
    | "HISTORY";
  readonly objectId?: string;
  readonly bounds?: Rect;
  readonly point?: Point;
}

export interface FrozenSpatialSelection {
  readonly objectIds: readonly string[];
  readonly bounds?: Rect;
}

export interface SpatialSceneSnapshot {
  readonly snapshotId: string;
  readonly pageId: SceneSnapshot["page"]["id"];
  readonly sceneRevision: SceneSnapshot["sceneRevision"];
  readonly mode: SpatialSceneMode;
  readonly coordinateSpace: {
    readonly kind: "PAGE_CANONICAL";
    readonly rotation: number;
  };
  readonly pageBounds: Rect;
  readonly editableBounds: Rect;
  readonly viewportBounds: Rect;
  readonly focus?: FrozenSpatialFocus;
  readonly selection?: FrozenSpatialSelection;
  readonly objects: readonly SpatialSceneObject[];
  readonly capturedAt: number;
}

export type PlacementResizePolicy =
  | "FIXED"
  | "COMPACT_ONCE"
  | "FLEX_WITHIN_BOUNDS";

export type PlacementOverlayPolicy = "NEVER" | "EXPLICIT_ONLY" | "ALLOWED";

export type PlacementOverflowPolicy =
  | "FAIL"
  | "EXPAND_CANVAS_IF_SUPPORTED"
  | "NEW_PAGE_IF_SUPPORTED";

export interface PlacementProfile {
  readonly capability: CapabilityId;
  readonly preferredSize: Size;
  readonly minSize: Size;
  readonly compactSize?: Size;
  readonly maxSize?: Size;
  readonly aspectRatio?: number;
  readonly resizePolicy: PlacementResizePolicy;
  readonly minClearance: number;
  readonly allowedRelations: readonly SpatialPlacementRelation[];
  readonly overlayPolicy: PlacementOverlayPolicy;
  readonly overflowPolicy: PlacementOverflowPolicy;
}

export interface MeasuredDraft {
  readonly draftKey: string;
  readonly capability: CapabilityId;
  readonly kind: string;
  readonly preferredFootprint: Size;
  readonly compactFootprint?: Size;
  readonly contentSummary?: string;
  readonly measurementSource:
    | "RENDERER"
    | "EXISTING_OBJECT"
    | "PROFILE_FALLBACK";
}

export interface ResolvedSpatialAnchor {
  readonly kind: "OBJECT" | "FOCUS" | "PAGE" | "VIEWPORT";
  readonly bounds: Rect;
  readonly semanticRole?: SpatialSemanticRole;
  readonly textPreview?: string;
  readonly sourceTarget?: Extract<TargetResolutionResult, { status: "RESOLVED" }>["target"];
}

export interface PlacementCandidate {
  readonly internalId: string;
  readonly alias: `S${number}`;
  readonly snapshotId: SpatialSceneSnapshot["snapshotId"];
  readonly sceneRevision: SpatialSceneSnapshot["sceneRevision"];
  readonly bounds: Rect;
  readonly strategy:
    | "ANCHOR_RELATIVE"
    | "REGION_SLOT"
    | "FREE_SPACE"
    | "OVERFLOW";
  readonly relation: SpatialPlacementRelation;
  readonly alignment: SpatialAlignment;
  readonly sizeVariant: "PREFERRED" | "COMPACT";
  readonly evidence: {
    readonly hardOverlapArea: number;
    readonly softOverlapArea: number;
    readonly clearance: number;
    readonly anchorDistance: number;
    readonly relationSatisfied: boolean;
    readonly alignmentSatisfied: boolean;
    readonly preferredSizePreserved: boolean;
  };
}

export interface ResolvedPlacement {
  readonly snapshotId: SpatialSceneSnapshot["snapshotId"];
  readonly pageId: SpatialSceneSnapshot["pageId"];
  readonly sceneRevision: SpatialSceneSnapshot["sceneRevision"];
  readonly bounds: Rect;
  readonly relation: SpatialPlacementQuery["relation"];
  readonly alignment: SpatialAlignment;
  readonly candidate: PlacementCandidate;
  readonly anchor?: ResolvedSpatialAnchor;
  readonly subjectTarget?: ResolvedTarget;
}

export type SpatialPlacementReason =
  | "NO_FEASIBLE_PLACEMENT"
  | "ANCHOR_NOT_FOUND"
  | "UNSUPPORTED"
  | "STALE_SCENE"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "INVALID_PROVIDER_CHOICE"
  | "PREVIEW_INVALID"
  | "INVALID_SCENE_GEOMETRY"
  | "CANCELLED";

export interface SpatialPlacementError {
  readonly reason: SpatialPlacementReason;
  readonly message?: string;
}

export type SpatialPlacementResult =
  | {
      readonly status: "RESOLVED";
      readonly source: "DETERMINISTIC" | "MULTIMODAL";
      readonly placement: ResolvedPlacement;
    }
  | {
      readonly status: "AMBIGUOUS";
      readonly candidates: readonly PlacementCandidate[];
    }
  | {
      readonly status: SpatialPlacementReason;
      readonly error?: SpatialPlacementError;
    };
