import type { Rect } from "@ggulnote/editor-core";
import type {
  MeasuredDraft,
  SpatialAlignment,
  SpatialPlacementQuery,
  SpatialPlacementRelation,
  SpatialRegionHint,
  SpatialSceneSnapshot,
} from "../../domain";
import type {
  CanvasPlacement,
  Destination,
  NotePageRegion,
  NoteSpatialRelation,
} from "../domain";

export type CanvasPlacementProjectionResult =
  | { readonly status: "RESOLVED"; readonly bounds: Rect }
  | { readonly status: "INVALID"; readonly reasonCode: "INVALID_PLACEMENT" };

/** Projects the model's final page-normalized geometry without semantic replanning. */
export function projectCanvasPlacement(input: {
  readonly placement: CanvasPlacement;
  readonly snapshot: SpatialSceneSnapshot;
  readonly draft: MeasuredDraft;
}): CanvasPlacementProjectionResult {
  const page = input.snapshot.pageBounds;
  const requestedWidth = input.placement.width === null
    ? input.draft.preferredFootprint.width
    : input.placement.width * page.width;
  const requestedHeight = input.placement.height === null
    ? input.draft.preferredFootprint.height
    : input.placement.height * page.height;
  if (![page.x, page.y, page.width, page.height, requestedWidth, requestedHeight]
    .every(Number.isFinite)
    || page.width <= 0
    || page.height <= 0
    || requestedWidth <= 0
    || requestedHeight <= 0) {
    return { status: "INVALID", reasonCode: "INVALID_PLACEMENT" };
  }
  const width = Math.min(requestedWidth, page.width);
  const height = Math.min(requestedHeight, page.height);
  const requestedX = page.x + input.placement.x * page.width;
  const requestedY = page.y + input.placement.y * page.height;
  return {
    status: "RESOLVED",
    bounds: {
      x: Math.max(page.x, Math.min(page.x + page.width - width, requestedX)),
      y: Math.max(page.y, Math.min(page.y + page.height - height, requestedY)),
      width,
      height,
    },
  };
}

function pageRegionQuery(
  region: NotePageRegion,
  requestedAlignment: "START" | "CENTER" | "END" | "AUTO" | undefined,
): SpatialPlacementQuery {
  const mapped = pageRegionMapping(region);
  return {
    reference: { kind: "PAGE" },
    relation: "FREE_SPACE",
    regionHint: mapped.regionHint,
    alignment: requestedAlignment ?? mapped.alignment,
    overlayIntent: "NONE",
  };
}

/** Legacy direct-command transaction compatibility; One Decision does not call this path. */
export function spatialQueryForDestination(
  destination: Destination | undefined,
  resolvedRelation?: SpatialPlacementRelation,
): SpatialPlacementQuery {
  const effective = destination ?? {
    kind: "PAGE_REGION" as const,
    region: "TOP_LEFT" as const,
    alignment: "START" as const,
    avoidOverlap: true,
  };
  if (effective.kind === "PAGE_REGION") {
    return pageRegionQuery(effective.region, effective.alignment);
  }
  const relation = resolvedRelation ?? toLegacyRelation(effective.relation);
  if (relation === undefined) {
    throw new RangeError(`Unsupported legacy placement relation: ${effective.relation}`);
  }
  return relativeQuery(relation, effective.alignment, effective.distance);
}

function pageRegionMapping(region: NotePageRegion): {
  readonly regionHint: SpatialRegionHint;
  readonly alignment: SpatialAlignment;
} {
  switch (region) {
    case "TOP_LEFT": return { regionHint: "TOP", alignment: "START" };
    case "TOP": return { regionHint: "TOP", alignment: "CENTER" };
    case "TOP_RIGHT": return { regionHint: "TOP", alignment: "END" };
    case "LEFT": return { regionHint: "LEFT", alignment: "CENTER" };
    case "CENTER": return { regionHint: "CURRENT_VIEW", alignment: "CENTER" };
    case "RIGHT": return { regionHint: "RIGHT", alignment: "CENTER" };
    case "BOTTOM_LEFT": return { regionHint: "BOTTOM", alignment: "START" };
    case "BOTTOM": return { regionHint: "BOTTOM", alignment: "CENTER" };
    case "BOTTOM_RIGHT": return { regionHint: "BOTTOM", alignment: "END" };
    case "MARGIN": return { regionHint: "MARGIN", alignment: "AUTO" };
  }
}

function relativeQuery(
  relation: SpatialPlacementRelation,
  alignment: SpatialAlignment | undefined,
  distance: "NEAR" | "NORMAL" | undefined,
): SpatialPlacementQuery {
  return {
    reference: { kind: "TARGET", query: { kind: "relative", relation: "focused" } },
    relation,
    ...(alignment === undefined ? {} : { alignment }),
    ...(distance === undefined ? {} : { distance }),
    overlayIntent: relation === "INSIDE" ? "EXPLICIT" : "NONE",
  };
}

function toLegacyRelation(
  relation: NoteSpatialRelation,
): SpatialPlacementRelation | undefined {
  switch (relation) {
    case "ABOVE":
    case "BELOW":
    case "LEFT_OF":
    case "RIGHT_OF":
    case "NEAR":
    case "INSIDE":
      return relation;
    default:
      return undefined;
  }
}
