import type { SpatialAlignment, SpatialPlacementRelation } from "./spatial-placement-query";
import type { PlacementCandidate } from "./spatial-placement-types";

export type PlacementCandidateAlias = `S${number}`;
export type MultimodalClearanceCategory = "LOW" | "MEDIUM" | "HIGH";
export type MultimodalSoftOverlapCategory = "NONE" | "LOW" | "PRESENT";

export interface MultimodalPlacementDraftSummary {
  readonly kind: string;
  readonly contentSummary?: string;
}

export interface MultimodalPlacementAnchorSummary {
  readonly kind: "OBJECT" | "FOCUS" | "PAGE" | "VIEWPORT";
  readonly semanticRole?: string;
  readonly textSummary?: string;
}

export interface MultimodalPlacementCandidateSummary {
  readonly alias: PlacementCandidateAlias;
  readonly relation: SpatialPlacementRelation;
  readonly alignment: SpatialAlignment;
  readonly fit: PlacementCandidate["sizeVariant"];
  readonly strategy: PlacementCandidate["strategy"];
  readonly clearance: MultimodalClearanceCategory;
  readonly softOverlap: MultimodalSoftOverlapCategory;
  readonly regionMatch: boolean;
}

export interface MultimodalPlacementRequest {
  readonly observationId: string;
  readonly pageId: string;
  readonly sceneRevision: number;
  readonly instruction: string;
  readonly draft: MultimodalPlacementDraftSummary;
  readonly anchor?: MultimodalPlacementAnchorSummary;
  readonly candidates: readonly MultimodalPlacementCandidateSummary[];
  readonly images: {
    readonly globalOverview: string;
    readonly localCandidateCrop: string;
  };
}

export interface MultimodalPlacementChoice {
  readonly choice: PlacementCandidateAlias | "NONE";
}

export class MultimodalPlacementValidationError extends Error {
  public constructor(
    message: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = "MultimodalPlacementValidationError";
  }
}
