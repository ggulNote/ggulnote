import type { Rect } from "@ggulnote/editor-core";
import {
  generatePlacementCandidates,
  resolveDeterministically,
  type PreparedSpatialPlacement,
  type SpatialPlacementPreparationInput,
  type SpatialPlacementPreparationResolution,
} from "../../application";
import type {
  MeasuredDraft,
  PlacementCandidate,
  PlacementProfile,
  ResolvedPlacement,
  ResolvedSpatialAnchor,
  SpatialAlignment,
  SpatialPlacementQuery,
  SpatialPlacementRelation,
  SpatialRegionHint,
  SpatialSceneSnapshot,
} from "../../domain";
import type {
  Destination,
  EntitySelector,
  NotePageRegion,
  NoteSpatialRelation,
} from "../domain";
import type { EntityRef } from "../world";
import type {
  ExistingWorldResolver,
  FrozenWorldContext,
  UnifiedObjectWorld,
} from "../world";

export type NotePlacementResult =
  | {
      readonly status: "RESOLVED";
      readonly placement: ResolvedPlacement;
      readonly preparedSpatial?: PreparedSpatialPlacement;
    }
  | { readonly status: "AMBIGUOUS"; readonly candidates: readonly PlacementCandidate[] }
  | { readonly status: "NO_FEASIBLE_PLACEMENT" }
  | { readonly status: "STALE_SCENE" }
  | { readonly status: "FAILED"; readonly reasonCode: string };

export interface NotePlacementInput {
  readonly destination?: Destination;
  readonly draft: MeasuredDraft;
  readonly profile: PlacementProfile;
  readonly snapshot: SpatialSceneSnapshot;
  readonly worldContext: FrozenWorldContext;
  readonly anchorRef?: EntityRef;
  readonly candidateAlias?: `${"C" | "S"}${number}`;
  readonly instruction?: string;
  readonly requirePreviewValidation?: boolean;
}

export interface SpatialPlacementPreparationPort {
  preparePlacement(
    input: SpatialPlacementPreparationInput,
  ): Promise<SpatialPlacementPreparationResolution>;
}

export interface ExistingPlacementEngineOptions {
  readonly world: UnifiedObjectWorld;
  readonly resolver: ExistingWorldResolver;
  readonly defaultDestination?: Destination;
  readonly preparation?: SpatialPlacementPreparationPort;
}

/**
 * Phase 2 facade over the Stage 4 candidate engine. Preview validation and the
 * final commit guard remain owned by the existing production Stage 4 pipeline.
 */
export class ExistingPlacementEngine {
  private readonly defaultDestination: Destination;

  public constructor(private readonly options: ExistingPlacementEngineOptions) {
    this.defaultDestination = options.defaultDestination ?? {
      kind: "PAGE_REGION",
      region: "TOP_LEFT",
      alignment: "START",
      avoidOverlap: true,
    };
  }

  public async resolve(input: NotePlacementInput): Promise<NotePlacementResult> {
    if (
      input.snapshot.pageId !== input.worldContext.pageId
      || input.snapshot.sceneRevision !== input.worldContext.sceneRevision
    ) {
      return { status: "STALE_SCENE" };
    }
    const destination = input.destination ?? this.defaultDestination;
    if (destination.kind === "PAGE_REGION") {
      return this.resolveQuery(input, pageRegionQuery(destination.region, destination.alignment));
    }

    const anchorSelector: EntitySelector = "context" in destination.anchor
      ? { context: destination.anchor.context }
      : destination.anchor;
    const resolved = input.anchorRef === undefined
      ? await this.options.resolver.resolve(anchorSelector, input.worldContext)
      : { status: "RESOLVED" as const, ref: input.anchorRef };
    if (resolved.status !== "RESOLVED") {
      return resolved.status === "UNSUPPORTED" && resolved.reasonCode === "STALE_SCENE"
        ? { status: "STALE_SCENE" }
        : { status: "NO_FEASIBLE_PLACEMENT" };
    }
    const anchor = resolvedAnchor(resolved.ref, this.options.world);
    if (anchor === undefined) return { status: "NO_FEASIBLE_PLACEMENT" };

    if (destination.relation === "BESIDE") {
      const unvalidatedInput = input.requirePreviewValidation === true
        ? { ...input, requirePreviewValidation: false }
        : input;
      const left = await this.resolveQuery(
        unvalidatedInput,
        relativeQuery("LEFT_OF", destination.alignment, destination.distance),
        anchor,
      );
      const right = await this.resolveQuery(
        unvalidatedInput,
        relativeQuery("RIGHT_OF", destination.alignment, destination.distance),
        anchor,
      );
      return combineBeside(left, right);
    }
    const relation = toExistingRelation(destination.relation);
    if (relation === undefined) return { status: "NO_FEASIBLE_PLACEMENT" };
    return this.resolveQuery(
      input,
      relativeQuery(relation, destination.alignment, destination.distance),
      anchor,
    );
  }

  private async resolveQuery(
    input: NotePlacementInput,
    query: SpatialPlacementQuery,
    anchor?: ResolvedSpatialAnchor,
  ): Promise<NotePlacementResult> {
    if (input.requirePreviewValidation === true) {
      const preparation = this.options.preparation;
      if (preparation === undefined) {
        return { status: "FAILED", reasonCode: "PREVIEW_UNAVAILABLE" };
      }
      const prepared = await preparation.preparePlacement({
        snapshot: input.snapshot,
        query,
        draft: input.draft,
        profile: input.profile,
        instruction: input.instruction ?? "",
        ...(anchor === undefined ? {} : { anchor }),
      });
      if (prepared.status === "ERROR") {
        if (prepared.errorCode === "STALE_SCENE") return { status: "STALE_SCENE" };
        if (prepared.errorCode === "NO_FEASIBLE_PLACEMENT") {
          return { status: "NO_FEASIBLE_PLACEMENT" };
        }
        return { status: "FAILED", reasonCode: prepared.errorCode };
      }
      const candidate = prepared.prepared.placement.candidate;
      return {
        status: "RESOLVED",
        placement: {
          snapshotId: input.snapshot.snapshotId,
          pageId: input.snapshot.pageId,
          sceneRevision: input.snapshot.sceneRevision,
          bounds: { ...prepared.prepared.placement.requestedBounds },
          relation: query.relation,
          alignment: candidate.alignment,
          candidate,
          ...(anchor === undefined ? {} : { anchor }),
        },
        preparedSpatial: prepared.prepared,
      };
    }
    const generated = generatePlacementCandidates({
      snapshot: input.snapshot,
      query,
      profile: input.profile,
      draft: input.draft,
      ...(anchor === undefined ? {} : { anchor }),
    });
    const result = resolveDeterministically({
      snapshot: input.snapshot,
      query,
      candidates: generated.candidates,
      ...(anchor === undefined ? {} : { anchor }),
    });
    if (result.status === "RESOLVED") {
      return { status: "RESOLVED", placement: result.placement };
    }
    if (result.status === "AMBIGUOUS") {
      const selected = input.candidateAlias === undefined
        ? undefined
        : result.candidates.find((candidate) => candidate.alias === input.candidateAlias);
      if (selected !== undefined) {
        return {
          status: "RESOLVED",
          placement: {
            snapshotId: input.snapshot.snapshotId,
            pageId: input.snapshot.pageId,
            sceneRevision: input.snapshot.sceneRevision,
            bounds: { ...selected.bounds },
            relation: query.relation,
            alignment: selected.alignment,
            candidate: selected,
            ...(anchor === undefined ? {} : { anchor }),
          },
        };
      }
      return { status: "AMBIGUOUS", candidates: result.candidates };
    }
    return result.status === "STALE_SCENE"
      ? { status: "STALE_SCENE" }
      : { status: "NO_FEASIBLE_PLACEMENT" };
  }
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
  const relation = resolvedRelation ?? toExistingRelation(effective.relation);
  if (relation === undefined) {
    throw new RangeError(`Unsupported production placement relation: ${effective.relation}`);
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
    overlayIntent: "NONE",
  };
}

function toExistingRelation(
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

function resolvedAnchor(
  ref: EntityRef,
  world: UnifiedObjectWorld,
): ResolvedSpatialAnchor | undefined {
  const bounds = boundsForRef(ref, world);
  if (bounds === undefined) return undefined;
  const objectId = ref.kind === "OBJECT" || ref.kind === "OBJECT_PART"
    ? ref.objectId
    : ref.kind === "TEXT_RANGE"
      ? ref.objectIds[0]
      : undefined;
  const metadata = objectId === undefined ? undefined : world.getObjectMetadata(objectId);
  return {
    kind: "OBJECT",
    ...(objectId === undefined ? {} : { objectId }),
    bounds,
    ...(metadata?.searchableText === undefined
      ? {}
      : { textPreview: metadata.searchableText.slice(0, 160) }),
  };
}

function boundsForRef(ref: EntityRef, world: UnifiedObjectWorld): Rect | undefined {
  if (ref.kind === "OBJECT") return world.getObjectMetadata(ref.objectId)?.renderBounds;
  if (ref.kind === "OBJECT_PART") {
    return ref.bounds ?? world.getObjectMetadata(ref.objectId)?.renderBounds;
  }
  if (ref.kind === "TEXT_RANGE") return unionRects(ref.rects);
  return undefined;
}

function unionRects(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

function combineBeside(
  left: NotePlacementResult,
  right: NotePlacementResult,
): NotePlacementResult {
  if (left.status === "STALE_SCENE" || right.status === "STALE_SCENE") {
    return { status: "STALE_SCENE" };
  }
  const candidates = [
    ...placementCandidates(left),
    ...placementCandidates(right),
  ];
  if (candidates.length === 0) return { status: "NO_FEASIBLE_PLACEMENT" };
  if (left.status === "RESOLVED" && right.status !== "RESOLVED" && candidates.length === 1) {
    return left;
  }
  if (right.status === "RESOLVED" && left.status !== "RESOLVED" && candidates.length === 1) {
    return right;
  }
  return { status: "AMBIGUOUS", candidates };
}

function placementCandidates(result: NotePlacementResult): readonly PlacementCandidate[] {
  if (result.status === "RESOLVED") return [result.placement.candidate];
  if (result.status === "AMBIGUOUS") return result.candidates;
  return [];
}
