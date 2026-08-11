import type { Rect, Size } from "@ggulnote/editor-core";
import type {
  MeasuredDraft,
  PlacementCandidate,
  PlacementProfile,
  ResolvedSpatialAnchor,
  ResolvedTarget,
  SpatialAlignment,
  SpatialPlacementQuery,
  SpatialPlacementRelation,
  SpatialPlacementResult,
  SpatialRegionHint,
  SpatialSceneObject,
  SpatialSceneSnapshot,
} from "../domain";
import {
  RectSpatialOccupancyIndex,
  SPATIAL_GEOMETRY_EPSILON,
  isFinitePositiveRect,
  isRectInside,
  rectBottom,
  rectDistance,
  rectRight,
  type SpatialOccupancyIndex,
} from "./spatial-occupancy-index";

export const MAX_FINAL_PLACEMENT_CANDIDATES = 6;

const MAX_AXIS_SEEDS = 12;
const MAX_RAW_FREE_SPACE_CANDIDATES = 144;
const NEAR_DIRECTIONS = [
  "BELOW",
  "RIGHT_OF",
  "ABOVE",
  "LEFT_OF",
] as const satisfies readonly DirectionalRelation[];
const AUTO_ALIGNMENTS = [
  "START",
  "CENTER",
  "END",
] as const satisfies readonly SpatialAlignment[];

type DirectionalRelation = "ABOVE" | "BELOW" | "LEFT_OF" | "RIGHT_OF";
type PlacementFootprintTier = PlacementCandidate["sizeVariant"];
type CandidateWithoutAlias = Omit<PlacementCandidate, "alias">;

export type PlacementCandidateFilterReason =
  | "INVALID_PROFILE"
  | "INVALID_GEOMETRY"
  | "MINIMUM_SIZE"
  | "MAXIMUM_SIZE"
  | "OUT_OF_BOUNDS"
  | "HARD_OVERLAP"
  | "MINIMUM_CLEARANCE"
  | "RELATION_NOT_ALLOWED"
  | "RELATION_UNSATISFIED"
  | "OVERLAY_POLICY";

export interface PlacementCandidateGenerationInput {
  readonly snapshot: SpatialSceneSnapshot;
  readonly query: SpatialPlacementQuery;
  readonly profile: PlacementProfile;
  readonly draft: MeasuredDraft;
  readonly anchor?: ResolvedSpatialAnchor;
  readonly excludedObjectIds?: readonly SpatialSceneObject["id"][];
  readonly maxCandidates?: number;
}

export interface PlacementObstacleDiagnostic {
  readonly id: SpatialSceneObject["id"];
  readonly bounds: Rect;
}

export interface PlacementCandidateGenerationDiagnostics {
  readonly snapshotId: SpatialSceneSnapshot["snapshotId"];
  readonly sceneRevision: SpatialSceneSnapshot["sceneRevision"];
  readonly coordinateSpace: "PAGE_CANONICAL";
  readonly editableBounds: Rect;
  readonly anchorBounds?: Rect;
  readonly preferredFootprint: Size;
  readonly compactFootprint?: Size;
  readonly hardObjects: readonly PlacementObstacleDiagnostic[];
  readonly softObjects: readonly PlacementObstacleDiagnostic[];
  readonly rawCandidateCount: number;
  readonly filteredCandidateCount: number;
  readonly acceptedBeforeDedupeCount: number;
  readonly dedupedCandidateCount: number;
  readonly dominancePrunedCandidateCount: number;
  readonly finalCandidateCount: number;
  readonly footprintTierAttempted: readonly PlacementFootprintTier[];
  readonly filteredReasons: Readonly<
    Partial<Record<PlacementCandidateFilterReason, number>>
  >;
}

export interface PlacementCandidateGenerationResult {
  readonly candidates: readonly PlacementCandidate[];
  readonly diagnostics: PlacementCandidateGenerationDiagnostics;
}

export interface DeterministicPlacementGateInput {
  readonly snapshot: SpatialSceneSnapshot;
  readonly query: SpatialPlacementQuery;
  readonly candidates: readonly PlacementCandidate[];
  readonly anchor?: ResolvedSpatialAnchor;
  readonly subjectTarget?: ResolvedTarget;
}

interface RawPlacementCandidate {
  readonly bounds: Rect;
  readonly strategy: PlacementCandidate["strategy"];
  readonly relation: SpatialPlacementRelation;
  readonly alignment: SpatialAlignment;
  readonly sizeVariant: PlacementFootprintTier;
  readonly ordinal: number;
}

interface MutableGenerationDiagnostics {
  rawCandidateCount: number;
  filteredCandidateCount: number;
  acceptedBeforeDedupeCount: number;
  dedupedCandidateCount: number;
  dominancePrunedCandidateCount: number;
  footprintTierAttempted: PlacementFootprintTier[];
  filteredReasons: Partial<Record<PlacementCandidateFilterReason, number>>;
}

export function generatePlacementCandidates(
  input: PlacementCandidateGenerationInput,
): PlacementCandidateGenerationResult {
  const diagnostics = emptyMutableDiagnostics();
  const excludedObjectIds = resolveExcludedObjectIds(input);
  const occupancy = new RectSpatialOccupancyIndex({
    snapshot: input.snapshot,
    minimumClearance: input.profile.minClearance,
    excludedObjectIds,
  });

  if (!isProfileUsable(input.profile, input.draft)) {
    addFilteredReason(diagnostics, "INVALID_PROFILE");
    return finishGeneration(input, occupancy, diagnostics, []);
  }
  if (!input.profile.allowedRelations.includes(input.query.relation)) {
    addFilteredReason(diagnostics, "RELATION_NOT_ALLOWED");
    return finishGeneration(input, occupancy, diagnostics, []);
  }
  if (!overlayPolicyAllows(input)) {
    addFilteredReason(diagnostics, "OVERLAY_POLICY");
    return finishGeneration(input, occupancy, diagnostics, []);
  }

  const footprints = footprintTiers(input.profile, input.draft);
  for (const footprint of footprints) {
    diagnostics.footprintTierAttempted.push(footprint.tier);
    const candidates = generateForFootprint(
      input,
      occupancy,
      footprint.size,
      footprint.tier,
      diagnostics,
    );
    if (candidates.length > 0) {
      const finalCandidates = finalizeCandidates(
        candidates,
        normalizeCandidateLimit(input.maxCandidates),
        diagnostics,
      );
      return finishGeneration(input, occupancy, diagnostics, finalCandidates);
    }
  }

  return finishGeneration(input, occupancy, diagnostics, []);
}

export function resolveDeterministically(
  input: DeterministicPlacementGateInput,
): SpatialPlacementResult {
  if (input.candidates.some((candidate) =>
    candidate.snapshotId !== input.snapshot.snapshotId
    || candidate.sceneRevision !== input.snapshot.sceneRevision
  )) {
    return {
      status: "STALE_SCENE",
      error: { reason: "STALE_SCENE" },
    };
  }

  const candidates = input.candidates.filter(
    (candidate) => candidate.relation === input.query.relation,
  );
  if (candidates.length === 0) {
    return {
      status: "NO_FEASIBLE_PLACEMENT",
      error: { reason: "NO_FEASIBLE_PLACEMENT" },
    };
  }

  const dominant = candidates.filter((candidate) =>
    candidates.every((other) =>
      candidate === other || dominatesPlacementCandidate(candidate, other),
    ),
  );
  const selected = candidates.length === 1
    ? candidates[0]
    : dominant.length === 1
      ? dominant[0]
      : undefined;
  if (selected === undefined) {
    return { status: "AMBIGUOUS", candidates };
  }

  return {
    status: "RESOLVED",
    source: "DETERMINISTIC",
    placement: {
      snapshotId: input.snapshot.snapshotId,
      pageId: input.snapshot.pageId,
      sceneRevision: input.snapshot.sceneRevision,
      bounds: Object.freeze({ ...selected.bounds }),
      relation: input.query.relation,
      alignment: selected.alignment,
      candidate: selected,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
      ...(input.subjectTarget === undefined
        ? {}
        : { subjectTarget: input.subjectTarget }),
    },
  };
}

export function dedupePlacementCandidates(
  candidates: readonly PlacementCandidate[],
): readonly PlacementCandidate[] {
  return dedupeCandidates(candidates).map((candidate, index) => ({
    ...candidate,
    alias: `S${index + 1}`,
  }));
}

export function pruneDominatedPlacementCandidates(
  candidates: readonly PlacementCandidate[],
): readonly PlacementCandidate[] {
  return candidates.filter((candidate, index) => !candidates.some(
    (other, otherIndex) => otherIndex !== index
      && dominatesPlacementCandidate(other, candidate),
  ));
}

export function dominatesPlacementCandidate(
  left: Pick<PlacementCandidate, "relation" | "evidence">,
  right: Pick<PlacementCandidate, "relation" | "evidence">,
): boolean {
  if (left.relation !== right.relation) return false;
  const leftEvidence = dominanceEvidence(left.evidence);
  const rightEvidence = dominanceEvidence(right.evidence);
  return leftEvidence.every((value, index) =>
    value >= (rightEvidence[index] ?? Number.POSITIVE_INFINITY)
      - SPATIAL_GEOMETRY_EPSILON,
  ) && leftEvidence.some((value, index) =>
    value > (rightEvidence[index] ?? Number.POSITIVE_INFINITY)
      + SPATIAL_GEOMETRY_EPSILON,
  );
}

function generateForFootprint(
  input: PlacementCandidateGenerationInput,
  occupancy: SpatialOccupancyIndex,
  footprint: Size,
  tier: PlacementFootprintTier,
  diagnostics: MutableGenerationDiagnostics,
): CandidateWithoutAlias[] {
  if (!isFootprintValid(footprint, input.profile)) {
    addFilteredReason(
      diagnostics,
      isFinitePositiveSize(footprint) ? "MINIMUM_SIZE" : "INVALID_GEOMETRY",
    );
    return [];
  }

  let accepted: CandidateWithoutAlias[] = [];
  if (input.query.relation !== "FREE_SPACE" && input.anchor !== undefined) {
    accepted = evaluateRawCandidates(
      generateAnchorRelativeCandidates(input, occupancy, footprint, tier),
      input,
      occupancy,
      diagnostics,
    );
  }

  if (input.query.relation === "FREE_SPACE" || accepted.length === 0) {
    const regional = input.query.regionHint === undefined
      ? []
      : evaluateRawCandidates(
        generateFreeSpaceCandidates(
          input,
          occupancy,
          footprint,
          tier,
          regionSearchBounds(input.snapshot, input.query.regionHint),
          "REGION_SLOT",
        ),
        input,
        occupancy,
        diagnostics,
      );
    accepted = regional.length > 0
      ? regional
      : evaluateRawCandidates(
        generateFreeSpaceCandidates(
          input,
          occupancy,
          footprint,
          tier,
          input.snapshot.editableBounds,
          "FREE_SPACE",
        ),
        input,
        occupancy,
        diagnostics,
      );
  }

  return accepted;
}

function generateAnchorRelativeCandidates(
  input: PlacementCandidateGenerationInput,
  occupancy: SpatialOccupancyIndex,
  footprint: Size,
  tier: PlacementFootprintTier,
): RawPlacementCandidate[] {
  const anchor = input.anchor;
  if (anchor === undefined) return [];
  const relation = input.query.relation;
  const raw: RawPlacementCandidate[] = [];

  if (isDirectionalRelation(relation)) {
    for (const alignment of requestedAlignments(input.query)) {
      const ideal = directionalRect(
        anchor.bounds,
        footprint,
        relation,
        alignment,
        input.profile.minClearance,
      );
      raw.push({
        bounds: shiftAlongRelation(
          ideal,
          relation,
          occupancy,
          input.profile.minClearance,
        ),
        strategy: "ANCHOR_RELATIVE",
        relation,
        alignment,
        sizeVariant: tier,
        ordinal: raw.length,
      });
    }
    return raw;
  }

  if (relation === "NEAR") {
    const alignments = input.query.alignment !== undefined
      && input.query.alignment !== "AUTO"
      ? [input.query.alignment]
      : ["CENTER" as const];
    for (const direction of NEAR_DIRECTIONS) {
      for (const alignment of alignments) {
        const ideal = directionalRect(
          anchor.bounds,
          footprint,
          direction,
          alignment,
          input.profile.minClearance,
        );
        raw.push({
          bounds: shiftAlongRelation(
            ideal,
            direction,
            occupancy,
            input.profile.minClearance,
          ),
          strategy: "ANCHOR_RELATIVE",
          relation,
          alignment,
          sizeVariant: tier,
          ordinal: raw.length,
        });
      }
    }
    return raw;
  }

  if (relation === "AT" || relation === "INSIDE") {
    for (const alignment of requestedAlignments(input.query)) {
      raw.push({
        bounds: insideRect(anchor.bounds, footprint, alignment),
        strategy: "ANCHOR_RELATIVE",
        relation,
        alignment,
        sizeVariant: tier,
        ordinal: raw.length,
      });
    }
  }
  return raw;
}

function generateFreeSpaceCandidates(
  input: PlacementCandidateGenerationInput,
  occupancy: SpatialOccupancyIndex,
  footprint: Size,
  tier: PlacementFootprintTier,
  searchBounds: Rect,
  strategy: "REGION_SLOT" | "FREE_SPACE",
): RawPlacementCandidate[] {
  if (!isFinitePositiveRect(searchBounds)) return [];
  const xSeeds = axisSeeds(
    searchBounds.x,
    rectRight(searchBounds),
    footprint.width,
    occupancy.hardObjects.flatMap((object) => [
      rectRight(object.renderBounds) + input.profile.minClearance,
      object.renderBounds.x - footprint.width - input.profile.minClearance,
    ]),
  );
  const ySeeds = axisSeeds(
    searchBounds.y,
    rectBottom(searchBounds),
    footprint.height,
    occupancy.hardObjects.flatMap((object) => [
      rectBottom(object.renderBounds) + input.profile.minClearance,
      object.renderBounds.y - footprint.height - input.profile.minClearance,
    ]),
  );
  const raw: RawPlacementCandidate[] = [];
  for (const y of ySeeds) {
    for (const x of xSeeds) {
      if (raw.length >= MAX_RAW_FREE_SPACE_CANDIDATES) return raw;
      raw.push({
        bounds: { x, y, width: footprint.width, height: footprint.height },
        strategy,
        relation: input.query.relation,
        alignment: input.query.alignment ?? "AUTO",
        sizeVariant: tier,
        ordinal: raw.length,
      });
    }
  }
  return raw;
}

function evaluateRawCandidates(
  rawCandidates: readonly RawPlacementCandidate[],
  input: PlacementCandidateGenerationInput,
  occupancy: SpatialOccupancyIndex,
  diagnostics: MutableGenerationDiagnostics,
): CandidateWithoutAlias[] {
  diagnostics.rawCandidateCount += rawCandidates.length;
  const accepted: CandidateWithoutAlias[] = [];
  for (const raw of rawCandidates) {
    const result = evaluateRawCandidate(raw, input, occupancy);
    if (typeof result === "string") {
      diagnostics.filteredCandidateCount += 1;
      addFilteredReason(diagnostics, result);
    } else {
      accepted.push(result);
    }
  }
  diagnostics.acceptedBeforeDedupeCount += accepted.length;
  return accepted;
}

function evaluateRawCandidate(
  raw: RawPlacementCandidate,
  input: PlacementCandidateGenerationInput,
  occupancy: SpatialOccupancyIndex,
): CandidateWithoutAlias | PlacementCandidateFilterReason {
  if (!isFinitePositiveRect(raw.bounds)) return "INVALID_GEOMETRY";
  if (!isFootprintValid(raw.bounds, input.profile)) return "MINIMUM_SIZE";
  if (!isWithinMaximumSize(raw.bounds, input.profile.maxSize)) {
    return "MAXIMUM_SIZE";
  }

  const insideEditableBounds = occupancy.isInsideEditableBounds(raw.bounds);
  if (!insideEditableBounds) return "OUT_OF_BOUNDS";
  const hardOverlapArea = occupancy.hardOverlapArea(raw.bounds);
  if (hardOverlapArea > 0) return "HARD_OVERLAP";
  if (occupancy.violatesHardClearance(raw.bounds)) {
    return "MINIMUM_CLEARANCE";
  }
  const relationSatisfied = satisfiesSpatialPlacementRelation(
    raw.bounds,
    input.anchor?.bounds,
    input.query.relation,
    input.profile.minClearance,
  );
  if (!relationSatisfied) return "RELATION_UNSATISFIED";

  const alignmentSatisfied = input.query.alignment === undefined
    || input.query.alignment === "AUTO"
    || raw.alignment === input.query.alignment;
  const softOverlapArea = occupancy.softOverlapArea(raw.bounds);
  const nearbyObjectIds = occupancy.nearby(raw.bounds, 6).map(
    (object) => object.id,
  );
  const regionMatch = matchesRegion(
    raw.bounds,
    input.query.regionHint,
    input.snapshot,
    input.profile.minClearance,
  );

  return Object.freeze({
    internalId: candidateInternalId(input.snapshot, raw),
    snapshotId: input.snapshot.snapshotId,
    sceneRevision: input.snapshot.sceneRevision,
    bounds: Object.freeze({ ...raw.bounds }),
    strategy: raw.strategy,
    relation: raw.relation,
    alignment: raw.alignment,
    sizeVariant: raw.sizeVariant,
    evidence: Object.freeze({
      hardOverlapArea,
      softOverlapArea,
      clearance: occupancy.clearance(raw.bounds),
      anchorDistance: input.anchor === undefined
        ? 0
        : rectDistance(raw.bounds, input.anchor.bounds),
      relationSatisfied,
      alignmentSatisfied,
      preferredSizePreserved: raw.sizeVariant === "PREFERRED",
      insideEditableBounds,
      regionMatch,
      nearbyObjectIds: Object.freeze(nearbyObjectIds),
    }),
  });
}

function finalizeCandidates(
  candidates: readonly CandidateWithoutAlias[],
  maxCandidates: number,
  diagnostics: MutableGenerationDiagnostics,
): readonly PlacementCandidate[] {
  const deduped = dedupeCandidates(candidates);
  diagnostics.dedupedCandidateCount = deduped.length;
  const nonDominated = deduped.filter((candidate, index) => !deduped.some(
    (other, otherIndex) => otherIndex !== index
      && dominatesPlacementCandidate(other, candidate),
  ));
  diagnostics.dominancePrunedCandidateCount = nonDominated.length;
  return diversityPrune(nonDominated, maxCandidates).map(
    (candidate, index) => Object.freeze({
      ...candidate,
      alias: `S${index + 1}` as const,
    }),
  );
}

function dedupeCandidates<T extends CandidateWithoutAlias>(
  candidates: readonly T[],
): T[] {
  const deduped: T[] = [];
  for (const candidate of [...candidates].sort(compareCandidatePriority)) {
    if (!deduped.some((existing) => sameCanonicalRect(
      existing.bounds,
      candidate.bounds,
    ))) {
      deduped.push(candidate);
    }
  }
  return deduped;
}

function diversityPrune<T extends CandidateWithoutAlias>(
  candidates: readonly T[],
  limit: number,
): T[] {
  const ordered = [...candidates].sort(compareCandidatePriority);
  const groups = new Map<string, T[]>();
  for (const candidate of ordered) {
    const key = [
      candidate.strategy,
      candidate.alignment,
      candidate.sizeVariant,
    ].join(":");
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  const selected: T[] = [];
  let round = 0;
  while (selected.length < limit) {
    let added = false;
    for (const group of groups.values()) {
      const candidate = group[round];
      if (candidate !== undefined) {
        selected.push(candidate);
        added = true;
        if (selected.length === limit) break;
      }
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

function compareCandidatePriority(
  left: CandidateWithoutAlias,
  right: CandidateWithoutAlias,
): number {
  const booleanChecks: Array<[boolean, boolean]> = [
    [left.evidence.regionMatch, right.evidence.regionMatch],
    [left.evidence.preferredSizePreserved, right.evidence.preferredSizePreserved],
    [left.evidence.alignmentSatisfied, right.evidence.alignmentSatisfied],
  ];
  for (const [leftValue, rightValue] of booleanChecks) {
    if (leftValue !== rightValue) return leftValue ? -1 : 1;
  }
  const strategyDelta = strategyPriority(left.strategy)
    - strategyPriority(right.strategy);
  if (strategyDelta !== 0) return strategyDelta;
  const softDelta = left.evidence.softOverlapArea
    - right.evidence.softOverlapArea;
  if (Math.abs(softDelta) > SPATIAL_GEOMETRY_EPSILON) return softDelta;
  const clearanceDelta = right.evidence.clearance - left.evidence.clearance;
  if (Math.abs(clearanceDelta) > SPATIAL_GEOMETRY_EPSILON) {
    return clearanceDelta;
  }
  const anchorDelta = left.evidence.anchorDistance
    - right.evidence.anchorDistance;
  if (Math.abs(anchorDelta) > SPATIAL_GEOMETRY_EPSILON) return anchorDelta;
  const boundsDelta = compareBounds(left.bounds, right.bounds);
  return boundsDelta !== 0
    ? boundsDelta
    : left.internalId.localeCompare(right.internalId);
}

function strategyPriority(strategy: PlacementCandidate["strategy"]): number {
  switch (strategy) {
    case "ANCHOR_RELATIVE":
      return 0;
    case "REGION_SLOT":
      return 1;
    case "FREE_SPACE":
      return 2;
    case "OVERFLOW":
      return 3;
  }
}

function dominanceEvidence(
  evidence: PlacementCandidate["evidence"],
): readonly number[] {
  return [
    evidence.relationSatisfied ? 1 : 0,
    evidence.preferredSizePreserved ? 1 : 0,
    evidence.alignmentSatisfied ? 1 : 0,
    -evidence.softOverlapArea,
    evidence.clearance,
    -evidence.anchorDistance,
  ];
}

function directionalRect(
  anchor: Rect,
  footprint: Size,
  relation: DirectionalRelation,
  alignment: SpatialAlignment,
  clearance: number,
): Rect {
  const effectiveAlignment = alignment === "AUTO" ? "CENTER" : alignment;
  if (relation === "ABOVE" || relation === "BELOW") {
    return {
      x: alignedStart(
        anchor.x,
        anchor.width,
        footprint.width,
        effectiveAlignment,
      ),
      y: relation === "ABOVE"
        ? anchor.y - clearance - footprint.height
        : rectBottom(anchor) + clearance,
      width: footprint.width,
      height: footprint.height,
    };
  }
  return {
    x: relation === "LEFT_OF"
      ? anchor.x - clearance - footprint.width
      : rectRight(anchor) + clearance,
    y: alignedStart(
      anchor.y,
      anchor.height,
      footprint.height,
      effectiveAlignment,
    ),
    width: footprint.width,
    height: footprint.height,
  };
}

function insideRect(
  anchor: Rect,
  footprint: Size,
  alignment: SpatialAlignment,
): Rect {
  const effectiveAlignment = alignment === "AUTO" ? "CENTER" : alignment;
  return {
    x: alignedStart(anchor.x, anchor.width, footprint.width, effectiveAlignment),
    y: alignedStart(anchor.y, anchor.height, footprint.height, effectiveAlignment),
    width: footprint.width,
    height: footprint.height,
  };
}

function alignedStart(
  start: number,
  span: number,
  footprintSpan: number,
  alignment: Exclude<SpatialAlignment, "AUTO">,
): number {
  switch (alignment) {
    case "START":
      return start;
    case "CENTER":
      return start + (span - footprintSpan) / 2;
    case "END":
      return start + span - footprintSpan;
  }
}

function shiftAlongRelation(
  initial: Rect,
  relation: DirectionalRelation,
  occupancy: SpatialOccupancyIndex,
  clearance: number,
): Rect {
  let current = initial;
  const limit = occupancy.hardObjects.length + 2;
  for (let iteration = 0; iteration < limit; iteration += 1) {
    const blockers = occupancy.blockingHardObjects(current);
    if (blockers.length === 0) return current;
    const shifted = shiftPastBlockers(current, relation, blockers, clearance);
    if (sameCanonicalRect(current, shifted)) return current;
    current = shifted;
  }
  return current;
}

function shiftPastBlockers(
  current: Rect,
  relation: DirectionalRelation,
  blockers: readonly SpatialSceneObject[],
  clearance: number,
): Rect {
  switch (relation) {
    case "BELOW":
      return {
        ...current,
        y: Math.max(...blockers.map((object) =>
          rectBottom(object.renderBounds) + clearance,
        )),
      };
    case "ABOVE":
      return {
        ...current,
        y: Math.min(...blockers.map((object) =>
          object.renderBounds.y - current.height - clearance,
        )),
      };
    case "RIGHT_OF":
      return {
        ...current,
        x: Math.max(...blockers.map((object) =>
          rectRight(object.renderBounds) + clearance,
        )),
      };
    case "LEFT_OF":
      return {
        ...current,
        x: Math.min(...blockers.map((object) =>
          object.renderBounds.x - current.width - clearance,
        )),
      };
  }
}

export function satisfiesSpatialPlacementRelation(
  bounds: Rect,
  anchor: Rect | undefined,
  relation: SpatialPlacementRelation,
  clearance: number,
  tolerance = SPATIAL_GEOMETRY_EPSILON,
): boolean {
  if (relation === "FREE_SPACE") return true;
  if (anchor === undefined) return false;
  switch (relation) {
    case "ABOVE":
      return rectBottom(bounds) <= anchor.y - clearance
        + tolerance;
    case "BELOW":
      return bounds.y >= rectBottom(anchor) + clearance
        - tolerance;
    case "LEFT_OF":
      return rectRight(bounds) <= anchor.x - clearance
        + tolerance;
    case "RIGHT_OF":
      return bounds.x >= rectRight(anchor) + clearance
        - tolerance;
    case "INSIDE":
      return isRectInsideWithTolerance(bounds, anchor, tolerance);
    case "AT":
      return centerInside(bounds, anchor, tolerance);
    case "NEAR":
      return rectDistance(bounds, anchor) >= clearance
        - tolerance;
  }
}

function isRectInsideWithTolerance(
  bounds: Rect,
  container: Rect,
  tolerance: number,
): boolean {
  return bounds.x >= container.x - tolerance
    && bounds.y >= container.y - tolerance
    && rectRight(bounds) <= rectRight(container) + tolerance
    && rectBottom(bounds) <= rectBottom(container) + tolerance;
}

function centerInside(bounds: Rect, anchor: Rect, tolerance: number): boolean {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return centerX >= anchor.x - tolerance
    && centerX <= rectRight(anchor) + tolerance
    && centerY >= anchor.y - tolerance
    && centerY <= rectBottom(anchor) + tolerance;
}

function requestedAlignments(
  query: SpatialPlacementQuery,
): readonly SpatialAlignment[] {
  return query.alignment === undefined || query.alignment === "AUTO"
    ? AUTO_ALIGNMENTS
    : [query.alignment];
}

function isDirectionalRelation(
  relation: SpatialPlacementRelation,
): relation is DirectionalRelation {
  return relation === "ABOVE"
    || relation === "BELOW"
    || relation === "LEFT_OF"
    || relation === "RIGHT_OF";
}

function footprintTiers(
  profile: PlacementProfile,
  draft: MeasuredDraft,
): ReadonlyArray<{ readonly tier: PlacementFootprintTier; readonly size: Size }> {
  const preferred = [{ tier: "PREFERRED" as const, size: draft.preferredFootprint }];
  if (profile.resizePolicy === "FIXED") return preferred;
  const compact = draft.compactFootprint ?? profile.compactSize;
  return compact === undefined
    ? preferred
    : [...preferred, { tier: "COMPACT" as const, size: compact }];
}

function isProfileUsable(
  profile: PlacementProfile,
  draft: MeasuredDraft,
): boolean {
  return profile.capability === draft.capability
    && isFinitePositiveSize(profile.preferredSize)
    && isFinitePositiveSize(profile.minSize)
    && (profile.compactSize === undefined
      || isFinitePositiveSize(profile.compactSize))
    && (profile.maxSize === undefined || isFinitePositiveSize(profile.maxSize))
    && Number.isFinite(profile.minClearance)
    && profile.minClearance >= 0;
}

function isFootprintValid(size: Size, profile: PlacementProfile): boolean {
  return isFinitePositiveSize(size)
    && size.width >= profile.minSize.width
    && size.height >= profile.minSize.height
    && isWithinMaximumSize(size, profile.maxSize);
}

function isWithinMaximumSize(size: Size, maximum: Size | undefined): boolean {
  return maximum === undefined
    || (size.width <= maximum.width
      && size.height <= maximum.height);
}

function isFinitePositiveSize(size: Size): boolean {
  return Number.isFinite(size.width)
    && Number.isFinite(size.height)
    && size.width > 0
    && size.height > 0;
}

function overlayPolicyAllows(input: PlacementCandidateGenerationInput): boolean {
  if (input.query.relation !== "AT" && input.query.relation !== "INSIDE") {
    return true;
  }
  if (input.anchor?.kind !== "OBJECT" && input.anchor?.objectId === undefined) {
    return true;
  }
  return input.query.overlayIntent === "EXPLICIT"
    && input.profile.overlayPolicy !== "NEVER";
}

function resolveExcludedObjectIds(
  input: PlacementCandidateGenerationInput,
): readonly SpatialSceneObject["id"][] {
  const excluded = [...(input.excludedObjectIds ?? [])];
  if (
    (input.query.relation === "AT" || input.query.relation === "INSIDE")
    && input.query.overlayIntent === "EXPLICIT"
    && input.profile.overlayPolicy !== "NEVER"
    && input.anchor?.objectId !== undefined
  ) {
    excluded.push(input.anchor.objectId);
  }
  return excluded;
}

function axisSeeds(
  start: number,
  end: number,
  footprintSpan: number,
  objectEdges: readonly number[],
): number[] {
  const last = end - footprintSpan;
  const seeds = [start, start + (end - start - footprintSpan) / 2, last];
  for (const edge of [...objectEdges].sort((left, right) => left - right)) {
    if (edge >= start - SPATIAL_GEOMETRY_EPSILON
      && edge <= last + SPATIAL_GEOMETRY_EPSILON) {
      seeds.push(edge);
    }
  }
  const unique: number[] = [];
  for (const seed of seeds) {
    if (Number.isFinite(seed) && !unique.some((value) =>
      Math.abs(value - seed) <= SPATIAL_GEOMETRY_EPSILON,
    )) {
      unique.push(seed);
      if (unique.length === MAX_AXIS_SEEDS) break;
    }
  }
  return unique;
}

function regionSearchBounds(
  snapshot: SpatialSceneSnapshot,
  hint: SpatialRegionHint,
): Rect {
  const editable = snapshot.editableBounds;
  switch (hint) {
    case "TOP":
      return { ...editable, height: editable.height / 2 };
    case "BOTTOM":
      return {
        ...editable,
        y: editable.y + editable.height / 2,
        height: editable.height / 2,
      };
    case "LEFT":
      return { ...editable, width: editable.width / 2 };
    case "RIGHT":
      return {
        ...editable,
        x: editable.x + editable.width / 2,
        width: editable.width / 2,
      };
    case "CURRENT_VIEW":
      return intersectRects(editable, snapshot.viewportBounds) ?? editable;
    case "MARGIN":
      return editable;
  }
}

function matchesRegion(
  bounds: Rect,
  hint: SpatialRegionHint | undefined,
  snapshot: SpatialSceneSnapshot,
  clearance: number,
): boolean {
  if (hint === undefined) return true;
  const editable = snapshot.editableBounds;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  switch (hint) {
    case "TOP":
      return centerY <= editable.y + editable.height / 2
        + SPATIAL_GEOMETRY_EPSILON;
    case "BOTTOM":
      return centerY >= editable.y + editable.height / 2
        - SPATIAL_GEOMETRY_EPSILON;
    case "LEFT":
      return centerX <= editable.x + editable.width / 2
        + SPATIAL_GEOMETRY_EPSILON;
    case "RIGHT":
      return centerX >= editable.x + editable.width / 2
        - SPATIAL_GEOMETRY_EPSILON;
    case "CURRENT_VIEW":
      return isRectInside(bounds, snapshot.viewportBounds);
    case "MARGIN": {
      const tolerance = Math.max(clearance, SPATIAL_GEOMETRY_EPSILON);
      return Math.abs(bounds.x - editable.x) <= tolerance
        || Math.abs(bounds.y - editable.y) <= tolerance
        || Math.abs(rectRight(bounds) - rectRight(editable)) <= tolerance
        || Math.abs(rectBottom(bounds) - rectBottom(editable)) <= tolerance;
    }
  }
}

function intersectRects(left: Rect, right: Rect): Rect | undefined {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(rectRight(left), rectRight(right));
  const bottomEdge = Math.min(rectBottom(left), rectBottom(right));
  const result = {
    x,
    y,
    width: rightEdge - x,
    height: bottomEdge - y,
  };
  return isFinitePositiveRect(result) ? result : undefined;
}

function sameCanonicalRect(left: Rect, right: Rect): boolean {
  return Math.abs(left.x - right.x) <= SPATIAL_GEOMETRY_EPSILON
    && Math.abs(left.y - right.y) <= SPATIAL_GEOMETRY_EPSILON
    && Math.abs(left.width - right.width) <= SPATIAL_GEOMETRY_EPSILON
    && Math.abs(left.height - right.height) <= SPATIAL_GEOMETRY_EPSILON;
}

function compareBounds(left: Rect, right: Rect): number {
  for (const [leftValue, rightValue] of [
    [left.y, right.y],
    [left.x, right.x],
    [left.width, right.width],
    [left.height, right.height],
  ] as const) {
    const delta = leftValue - rightValue;
    if (Math.abs(delta) > SPATIAL_GEOMETRY_EPSILON) return delta;
  }
  return 0;
}

function candidateInternalId(
  snapshot: SpatialSceneSnapshot,
  candidate: RawPlacementCandidate,
): string {
  const geometry = [
    candidate.bounds.x,
    candidate.bounds.y,
    candidate.bounds.width,
    candidate.bounds.height,
  ].map(canonicalNumber).join(":");
  return [
    "placement",
    encodeURIComponent(snapshot.snapshotId),
    candidate.strategy,
    candidate.relation,
    candidate.alignment,
    candidate.sizeVariant,
    geometry,
  ].join(":");
}

function canonicalNumber(value: number): string {
  return (Math.round(value / SPATIAL_GEOMETRY_EPSILON)
    * SPATIAL_GEOMETRY_EPSILON).toFixed(6);
}

function normalizeCandidateLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return MAX_FINAL_PLACEMENT_CANDIDATES;
  }
  return Math.max(
    1,
    Math.min(MAX_FINAL_PLACEMENT_CANDIDATES, Math.floor(value)),
  );
}

function emptyMutableDiagnostics(): MutableGenerationDiagnostics {
  return {
    rawCandidateCount: 0,
    filteredCandidateCount: 0,
    acceptedBeforeDedupeCount: 0,
    dedupedCandidateCount: 0,
    dominancePrunedCandidateCount: 0,
    footprintTierAttempted: [],
    filteredReasons: {},
  };
}

function addFilteredReason(
  diagnostics: MutableGenerationDiagnostics,
  reason: PlacementCandidateFilterReason,
): void {
  diagnostics.filteredReasons[reason]
    = (diagnostics.filteredReasons[reason] ?? 0) + 1;
}

function finishGeneration(
  input: PlacementCandidateGenerationInput,
  occupancy: SpatialOccupancyIndex,
  diagnostics: MutableGenerationDiagnostics,
  candidates: readonly PlacementCandidate[],
): PlacementCandidateGenerationResult {
  return Object.freeze({
    candidates: Object.freeze([...candidates]),
    diagnostics: Object.freeze({
      snapshotId: input.snapshot.snapshotId,
      sceneRevision: input.snapshot.sceneRevision,
      coordinateSpace: "PAGE_CANONICAL" as const,
      editableBounds: Object.freeze({ ...input.snapshot.editableBounds }),
      ...(input.anchor === undefined
        ? {}
        : { anchorBounds: Object.freeze({ ...input.anchor.bounds }) }),
      preferredFootprint: Object.freeze({ ...input.draft.preferredFootprint }),
      ...(input.draft.compactFootprint === undefined
        ? input.profile.compactSize === undefined
          ? {}
          : { compactFootprint: Object.freeze({ ...input.profile.compactSize }) }
        : { compactFootprint: Object.freeze({ ...input.draft.compactFootprint }) }),
      hardObjects: obstacleDiagnostics(occupancy.hardObjects),
      softObjects: obstacleDiagnostics(occupancy.softObjects),
      rawCandidateCount: diagnostics.rawCandidateCount,
      filteredCandidateCount: diagnostics.filteredCandidateCount,
      acceptedBeforeDedupeCount: diagnostics.acceptedBeforeDedupeCount,
      dedupedCandidateCount: diagnostics.dedupedCandidateCount,
      dominancePrunedCandidateCount: diagnostics.dominancePrunedCandidateCount,
      finalCandidateCount: candidates.length,
      footprintTierAttempted: Object.freeze([
        ...diagnostics.footprintTierAttempted,
      ]),
      filteredReasons: Object.freeze({ ...diagnostics.filteredReasons }),
    }),
  });
}

function obstacleDiagnostics(
  objects: readonly SpatialSceneObject[],
): readonly PlacementObstacleDiagnostic[] {
  return Object.freeze(objects.map((object) => Object.freeze({
    id: object.id,
    bounds: Object.freeze({ ...object.renderBounds }),
  })));
}
