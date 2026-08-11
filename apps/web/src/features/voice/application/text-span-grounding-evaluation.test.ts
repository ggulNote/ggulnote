import { describe, expect, it } from "vitest";
import { evaluateTextSpanGroundingStages } from "./grounding-retrieval-evaluation";
import type { AnchorSpanCandidate, SpanPairCandidate } from "./text-span-grounder";

describe("TextSpan grounding evaluation", () => {
  it("separates anchor recall, phrase accuracy, pair recall, selection, and false commit", () => {
    const start = anchor(1, 2);
    const end = anchor(8, 8);
    const pair = {
      start,
      end,
      range: { startIndex: 1, endIndex: 8 },
    } as SpanPairCandidate;
    expect(evaluateTextSpanGroundingStages({
      expectedStart: { startIndex: 1, endIndex: 2 },
      expectedEnd: { startIndex: 8, endIndex: 8 },
      expectedPair: { startIndex: 1, endIndex: 8 },
      startCandidates: [start],
      endCandidates: [end],
      pairCandidates: [pair],
      selectedPair: pair,
      committed: true,
      shouldCommit: true,
      deterministicallyResolved: true,
      recoveryUsed: false,
      k: 3,
    })).toEqual({
      anchorCandidateRecallAtK: 1,
      anchorPhraseAccuracy: 1,
      anchorBoundaryAccuracy: 1,
      spanPairRecallAtK: 1,
      spanPairSelectionAccuracy: 1,
      finalTargetHitAt1: 1,
      deterministicResolutionRate: 1,
      llmRecoveryRate: 0,
      falseCommitRate: 0,
    });
  });
});

function anchor(startIndex: number, endIndex: number): AnchorSpanCandidate {
  return {
    startIndex,
    endIndex,
    evidence: { boundaryPrecision: 1 },
  } as AnchorSpanCandidate;
}
