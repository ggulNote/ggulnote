import type { TargetQuery } from "./target-query";

export const SPATIAL_PLACEMENT_RELATIONS = [
  "AT",
  "INSIDE",
  "ABOVE",
  "BELOW",
  "LEFT_OF",
  "RIGHT_OF",
  "NEAR",
  "FREE_SPACE",
] as const;

export type SpatialPlacementRelation =
  (typeof SPATIAL_PLACEMENT_RELATIONS)[number];

export const SPATIAL_REGION_HINTS = [
  "TOP",
  "BOTTOM",
  "LEFT",
  "RIGHT",
  "MARGIN",
  "CURRENT_VIEW",
] as const;

export type SpatialRegionHint = (typeof SPATIAL_REGION_HINTS)[number];

export const SPATIAL_ALIGNMENTS = [
  "START",
  "CENTER",
  "END",
  "AUTO",
] as const;

export type SpatialAlignment = (typeof SPATIAL_ALIGNMENTS)[number];

export type SpatialDistance = "NEAR" | "NORMAL";
export type SpatialOverlayIntent = "NONE" | "EXPLICIT";

export type SpatialReferenceQuery =
  | {
      kind: "TARGET";
      query: TargetQuery;
    }
  | {
      kind: "FOCUS";
    }
  | {
      kind: "PAGE";
    }
  | {
      kind: "VIEWPORT";
    };

export interface SpatialPlacementQuery {
  reference: SpatialReferenceQuery;
  relation: SpatialPlacementRelation;
  regionHint?: SpatialRegionHint;
  alignment?: SpatialAlignment;
  distance?: SpatialDistance;
  overlayIntent?: SpatialOverlayIntent;
}
