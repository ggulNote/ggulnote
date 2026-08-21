import { describe, expect, it } from "vitest";
import type {
  PlacementCandidate,
  SpatialPlacementResult,
  SpatialSceneSnapshot,
} from "../domain";
import {
  applyPlacementChoicePolicy,
  resolveDelegatedLayoutFallback,
} from "./placement-choice-policy";

const SNAPSHOT: SpatialSceneSnapshot = {
  snapshotId: "snapshot-1",
  pageId: "page-1",
  sceneRevision: 3,
  mode: "BLANK",
  coordinateSpace: { kind: "PAGE_CANONICAL", rotation: 0 },
  pageBounds: { x: 0, y: 0, width: 600, height: 800 },
  editableBounds: { x: 0, y: 0, width: 600, height: 800 },
  viewportBounds: { x: 0, y: 0, width: 600, height: 400 },
  objects: [],
  capturedAt: 1,
};

const QUERY = {
  reference: { kind: "PAGE" as const },
  relation: "FREE_SPACE" as const,
  regionHint: "TOP" as const,
  alignment: "START" as const,
  overlayIntent: "NONE" as const,
};

describe("placement choice policy", () => {
  it.each(["WRITING_FLOW", "EXPLICIT_REGION"] as const)(
    "selects a stable safe candidate for %s without multimodal work",
    (policy) => {
      const result = applyPlacementChoicePolicy({
        result: ambiguous(),
        policy,
        snapshot: SNAPSHOT,
        query: QUERY,
      });
      expect(result.selectedByPolicy).toBe(true);
      expect(result.result).toMatchObject({
        status: "RESOLVED",
        source: "DETERMINISTIC",
        placement: { candidate: { internalId: "candidate-start" } },
      });
    },
  );

  it("leaves delegated layout ambiguous while a provider may choose", () => {
    expect(applyPlacementChoicePolicy({
      result: ambiguous(),
      policy: "USER_DELEGATED_LAYOUT",
      snapshot: SNAPSHOT,
      query: QUERY,
    })).toMatchObject({ result: { status: "AMBIGUOUS" }, selectedByPolicy: false });
  });

  it("uses the same stable shortlist for a provider-unavailable delegated fallback", () => {
    expect(resolveDelegatedLayoutFallback({
      result: ambiguous(),
      snapshot: SNAPSHOT,
      query: QUERY,
    })).toMatchObject({
      status: "RESOLVED",
      placement: { candidate: { internalId: "candidate-start" } },
    });
  });
});

function ambiguous(): SpatialPlacementResult {
  return {
    status: "AMBIGUOUS",
    candidates: [
      candidate("candidate-center", "S1", "CENTER", false),
      candidate("candidate-start", "S2", "START", true),
    ],
  };
}

function candidate(
  internalId: string,
  alias: `S${number}`,
  alignment: PlacementCandidate["alignment"],
  alignmentSatisfied: boolean,
): PlacementCandidate {
  return {
    internalId,
    alias,
    snapshotId: SNAPSHOT.snapshotId,
    sceneRevision: SNAPSHOT.sceneRevision,
    bounds: alignment === "START"
      ? { x: 20, y: 20, width: 120, height: 60 }
      : { x: 240, y: 20, width: 120, height: 60 },
    strategy: "FREE_SPACE",
    relation: "FREE_SPACE",
    alignment,
    sizeVariant: "PREFERRED",
    evidence: {
      hardOverlapArea: 0,
      softOverlapArea: 0,
      clearance: 20,
      anchorDistance: 0,
      relationSatisfied: true,
      alignmentSatisfied,
      preferredSizePreserved: true,
      insideEditableBounds: true,
      regionMatch: true,
      nearbyObjectIds: [],
    },
  };
}
