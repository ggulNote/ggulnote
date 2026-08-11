import { describe, expect, it } from "vitest";
import type {
  PageTargetCandidate,
  PageTargetCatalog,
  TargetQuery,
} from "../domain";
import { evaluateCandidateRecallAtK } from "./grounding-retrieval-evaluation";
import {
  buildFrozenPageTermIndex,
  retrieveTargetAwareGroundingEvidence,
} from "./target-aware-grounding-retrieval";

function candidate(id: string, text: string): PageTargetCandidate {
  return {
    candidateId: id,
    pageId: "page-1",
    source: "pdf",
    type: "word",
    sourceObjectId: id,
    semanticObjectId: id,
    sceneObjectId: id,
    text,
    readingOrder: Number(id.replace(/\D/gu, "")) || 0,
    editable: false,
    annotatable: true,
  };
}

function catalog(terms: readonly string[]): PageTargetCatalog {
  return {
    pageId: "page-1",
    sceneRevision: 1,
    candidates: terms.map((term, index) =>
      candidate("word-" + String(index), term)),
  };
}

function retrieve(terms: readonly string[], query: TargetQuery) {
  return retrieveTargetAwareGroundingEvidence({ catalog: catalog(terms), query });
}

describe("target-aware hybrid grounding retrieval", () => {
  it("extracts clean TextSpan slots and excludes command-word pollution", () => {
    const result = retrieve(
      ["challenge", "complex", "He", "is"],
      {
        kind: "text_span",
        startAnchor: "챌린지부터",
        endAnchor: "콤플렉스까지",
      },
    );

    expect(result.slots).toEqual([
      { kind: "start_anchor", text: "챌린지" },
      { kind: "end_anchor", text: "콤플렉스" },
    ]);
    expect(result.termHypotheses[0]?.candidates.map((item) => item.value))
      .toContain("challenge");
    expect(result.termHypotheses[1]?.candidates.map((item) => item.value))
      .toContain("complex");
    expect(result.termHypotheses.map((item) => item.rawSpan))
      .not.toEqual(expect.arrayContaining(["해", "줘"]));
  });

  it("searches the complete Frozen Page universe before bounding candidates", () => {
    const terms = [
      ...Array.from({ length: 520 }, (_, index) => "term" + String(index)),
      "challenge",
    ];
    const result = retrieve(terms, { kind: "text_span", quote: "챌린지" });

    expect(result.index.length).toBeGreaterThan(500);
    expect(result.termHypotheses[0]?.candidates.map((item) => item.value))
      .toContain("challenge");
  });

  it.each([
    ["헨타이어", "entire"],
    ["모얼오벌", "Moreover"],
    ["인스탠스", "instance"],
    ["트랜스포머", "Transformer"],
    ["온라인", "online"],
    ["피니시", "finish"],
    ["챌린지", "challenge"],
    ["챌린지", "challenges"],
    ["콤플렉스", "complex"],
  ])("recalls %s as actual page term %s", (spoken, actual) => {
    const result = retrieve([actual], { kind: "text_span", quote: spoken });
    expect(result.termHypotheses[0]?.candidates.map((item) => item.value))
      .toContain(actual);
  });

  it("does not invent absent page terms and skips Relative term retrieval", () => {
    expect(retrieve(["process"], { kind: "text_span", quote: "챌린지" })
      .termHypotheses.flatMap((item) => item.candidates)
      .map((item) => item.value)).not.toContain("challenge");
    const relative = retrieve(["challenge"], {
      kind: "relative",
      relation: "focused",
    });
    expect(relative.slots).toEqual([]);
    expect(relative.termHypotheses).toEqual([]);
  });

  it("deduplicates actual surfaces and reports candidate recall separately", () => {
    const index = buildFrozenPageTermIndex(catalog(["Challenge", "challenge"]));
    expect(index).toHaveLength(1);
    const result = retrieve(
      ["complex", "challenge"],
      { kind: "text_span", quote: "챌린지" },
    );
    expect(evaluateCandidateRecallAtK({
      expectedSurfaces: ["challenge", "finish"],
      candidates: result.candidatesBySlot[0]?.candidates ?? [],
      k: 2,
    })).toEqual({
      recalled: 1,
      expected: 2,
      recallAtK: 0.5,
    });
  });
});
