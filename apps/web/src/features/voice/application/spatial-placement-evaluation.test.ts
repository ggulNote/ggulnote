import { describe, expect, it } from "vitest";
import { evaluateSpatialPlacementCases } from "./spatial-placement-evaluation";

describe("evaluateSpatialPlacementCases", () => {
  it("reports safety, bounded multimodal, latency, and undo fixture metrics", () => {
    const metrics = evaluateSpatialPlacementCases([
      {
        expectedCommit: true,
        executed: true,
        placementValid: true,
        hardOverlap: false,
        relationSatisfied: true,
        preferredSizePreserved: true,
        resolvedDeterministically: true,
        multimodalUsed: false,
        latencyMs: 10,
        undoIntegrity: true,
      },
      {
        expectedCommit: true,
        executed: true,
        placementValid: true,
        hardOverlap: false,
        relationSatisfied: true,
        preferredSizePreserved: false,
        resolvedDeterministically: false,
        multimodalUsed: true,
        multimodalChoiceCorrect: true,
        latencyMs: 30,
        undoIntegrity: true,
      },
      {
        expectedCommit: false,
        executed: false,
        resolvedDeterministically: false,
        multimodalUsed: false,
        latencyMs: 20,
      },
    ]);

    expect(metrics).toEqual({
      caseCount: 3,
      placementValidityRate: 1,
      hardOverlapRate: 0,
      relationSatisfactionRate: 1,
      preferredSizePreservationRate: 0.5,
      deterministicResolutionRate: 1 / 3,
      multimodalFallbackRate: 1 / 3,
      multimodalChoiceAccuracy: 1,
      falseCommitRate: 0,
      noCommitPrecision: 1,
      p50LatencyMs: 20,
      p95LatencyMs: 30,
      undoIntegrityRate: 1,
    });
  });
});
