import type {
  PlacementCandidate,
  ResolvedSpatialAnchor,
  ResolvedTarget,
  SpatialPlacementQuery,
  SpatialPlacementResult,
  SpatialSceneSnapshot,
  TextPlacementChoicePolicy,
} from "../domain";
import { isRectInside } from "./spatial-occupancy-index";

export interface PlacementChoicePolicyInput {
  readonly result: SpatialPlacementResult;
  readonly policy: TextPlacementChoicePolicy;
  readonly snapshot: SpatialSceneSnapshot;
  readonly query: SpatialPlacementQuery;
  readonly anchor?: ResolvedSpatialAnchor;
  readonly subjectTarget?: ResolvedTarget;
}

export interface PlacementChoicePolicyResolution {
  readonly result: SpatialPlacementResult;
  readonly selectedByPolicy: boolean;
}

/** Resolves layout-only ties without inventing geometry or a weighted score. */
export function applyPlacementChoicePolicy(
  input: PlacementChoicePolicyInput,
): PlacementChoicePolicyResolution {
  if (
    input.result.status !== "AMBIGUOUS"
    || (input.policy !== "WRITING_FLOW" && input.policy !== "EXPLICIT_REGION")
  ) {
    return { result: input.result, selectedByPolicy: false };
  }
  return {
    result: resolveStableCandidate(input),
    selectedByPolicy: true,
  };
}

export function resolveDelegatedLayoutFallback(
  input: Omit<PlacementChoicePolicyInput, "policy">,
): SpatialPlacementResult {
  return resolveDeterministicPlacementTie(input);
}

/** Chooses among geometry-equivalent candidates without semantic inference. */
export function resolveDeterministicPlacementTie(
  input: Omit<PlacementChoicePolicyInput, "policy">,
): SpatialPlacementResult {
  return input.result.status === "AMBIGUOUS"
    ? resolveStableCandidate({ ...input, policy: "USER_DELEGATED_LAYOUT" })
    : input.result;
}

function resolveStableCandidate(input: PlacementChoicePolicyInput): SpatialPlacementResult {
  if (input.result.status !== "AMBIGUOUS" || input.result.candidates.length === 0) {
    return input.result;
  }
  let pool = [...input.result.candidates];
  pool = prefer(pool, (candidate) => candidate.evidence.regionMatch);
  pool = prefer(pool, (candidate) => candidate.sizeVariant === "PREFERRED");
  pool = prefer(pool, (candidate) => candidate.evidence.alignmentSatisfied);
  if (input.policy === "WRITING_FLOW") {
    pool = prefer(pool, (candidate) => candidate.alignment === "START");
  }
  pool = prefer(pool, (candidate) => isRectInside(candidate.bounds, input.snapshot.viewportBounds));
  const selected = pool[0] ?? input.result.candidates[0];
  return resolved(input, selected);
}

function prefer(
  candidates: readonly PlacementCandidate[],
  predicate: (candidate: PlacementCandidate) => boolean,
): PlacementCandidate[] {
  const preferred = candidates.filter(predicate);
  return preferred.length > 0 ? preferred : [...candidates];
}

function resolved(
  input: PlacementChoicePolicyInput,
  selected: PlacementCandidate,
): SpatialPlacementResult {
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
      ...(input.subjectTarget === undefined ? {} : { subjectTarget: input.subjectTarget }),
    },
  };
}
