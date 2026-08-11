import { describe, expect, it } from "vitest";
import type { GroundingEvaluationCase } from "./grounding-evaluation";
import { evaluateGroundingCases } from "./grounding-evaluation";

describe("grounding evaluation", () => {
  it("computes Stage 3.5 safety, accuracy, cache, recovery, undo, and latency metrics", () => {
    const categories: GroundingEvaluationCase["category"][] = [
      "exact_relative",
      "exact_text_span",
      "semantic_sentence",
      "semantic_paragraph",
      "phonetic_semantic",
      "phonetic_text_span",
      "duplicate_anchor",
      "no_target",
      "ambiguous_target",
      "canvas_text",
      "numeric_evidence",
      "math_evidence",
    ];
    const cases = categories.map((category, index): GroundingEvaluationCase => ({
      category,
      expectedIntent: `intent-${index}`,
      actualIntent: `intent-${index}`,
      ...(index < 6
        ? { expectedTargetId: `target-${index}`, actualTargetId: `target-${index}` }
        : {}),
      ...(category === "exact_text_span" || category === "phonetic_text_span"
        ? {
            expectedStartTokenId: "start",
            actualStartTokenId: "start",
            expectedEndTokenId: "end",
            actualEndTokenId: "end",
            expectedRangeTokenIds: ["start", "middle", "end"],
            actualRangeTokenIds: ["start", "middle", "end"],
          }
        : {}),
      shouldCommit: !["duplicate_anchor", "no_target", "ambiguous_target"].includes(category),
      committed: !["duplicate_anchor", "no_target", "ambiguous_target"].includes(category),
      recoveryAttempted: category === "phonetic_semantic"
        || category === "phonetic_text_span"
        || category === "no_target",
      recoverySelected: category === "phonetic_semantic" || category === "phonetic_text_span",
      recoveryNoneExpected: category === "no_target",
      undoRestored: !["duplicate_anchor", "no_target", "ambiguous_target"].includes(category)
        ? true
        : undefined,
      embeddingCacheHit: category === "semantic_sentence" || category === "semantic_paragraph"
        ? true
        : undefined,
      latencyMs: (index + 1) * 10,
    }));

    expect(evaluateGroundingCases(cases)).toEqual({
      intentAccuracy: 1,
      targetHitAt1: 1,
      anchorStartAccuracy: 1,
      anchorEndAccuracy: 1,
      rangeCorrectness: 1,
      recoverySuccessRate: 2 / 3,
      recoveryNonePrecision: 1,
      falseCommitRate: 0,
      embeddingCacheHitRate: 1,
      recoveryRate: 0.25,
      undoIntegrity: 1,
      latencyP50Ms: 60,
      latencyP95Ms: 120,
    });
  });
});
