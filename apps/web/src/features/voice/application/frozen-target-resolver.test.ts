import { describe, expect, it } from "vitest";
import type {
  DirectRecentOperation,
  FrozenVoiceTurnContext,
  PageTargetCandidate,
  PageTargetCatalog,
  TargetQuery,
} from "../domain";
import { FrozenTargetResolver } from "./frozen-target-resolver";

const FROZEN_CONTEXT: FrozenVoiceTurnContext = {
  pageId: "page-1",
  sceneMode: "pdf",
  sceneRevision: 7,
  focusObjectId: "pdf:line:focus",
  focusBounds: { x: 10, y: 10, width: 200, height: 20 },
  focusSource: "selection",
  focusStale: false,
  capturedAt: 10,
};

function candidate(
  overrides: Partial<PageTargetCandidate> & Pick<PageTargetCandidate, "candidateId">,
): PageTargetCandidate {
  return {
    source: "pdf",
    type: "line",
    pageId: "page-1",
    sceneObjectId: overrides.candidateId.replace("candidate:", ""),
    text: "기본 문장",
    bounds: { x: 10, y: 10, width: 200, height: 20 },
    editable: false,
    annotatable: true,
    semanticUnit: "line",
    readingOrder: 1,
    ...overrides,
  };
}

function catalog(candidates: readonly PageTargetCandidate[]): PageTargetCatalog {
  return { pageId: "page-1", sceneRevision: 7, candidates };
}

function resolve(
  query: TargetQuery,
  candidates: readonly PageTargetCandidate[],
  recentOperations: readonly DirectRecentOperation[] = [],
) {
  return new FrozenTargetResolver().resolve({
    query,
    catalog: catalog(candidates),
    frozenContext: FROZEN_CONTEXT,
    recentOperations,
  });
}

describe("FrozenTargetResolver", () => {
  it("resolves the frozen focused target without reading current focus", () => {
    const focused = candidate({
      candidateId: "candidate:pdf:line:focus",
      sceneObjectId: "pdf:line:focus",
      text: "포커스 문장",
    });

    const result = resolve(
      { kind: "relative", relation: "focused" },
      [focused],
    );

    expect(result).toMatchObject({
      status: "RESOLVED",
      confidence: 1,
      target: {
        kind: "text_span",
        objectId: "pdf:line:focus",
        sceneRevision: 7,
      },
      evidence: { focusMatch: 1 },
    });
  });

  it("resolves last_target and ranks the most recent object", () => {
    const older = candidate({
      candidateId: "candidate:canvas:graph:old",
      sceneObjectId: "canvas:graph:old",
      source: "ggulnote",
      type: "graph",
      text: "y=x",
      editable: true,
      annotatable: false,
    });
    const recent = candidate({
      candidateId: "candidate:canvas:graph:new",
      sceneObjectId: "canvas:graph:new",
      source: "ggulnote",
      type: "graph",
      text: "y=x^2",
      editable: true,
      annotatable: false,
    });
    const operations: DirectRecentOperation[] = [
      {
        operationId: "op-new",
        pageId: "page-1",
        operationType: "CREATE_ANNOTATION",
        annotationId: "new",
        createdAt: 20,
        targetSceneObjectId: recent.sceneObjectId,
      },
      {
        operationId: "op-old",
        pageId: "page-1",
        operationType: "CREATE_ANNOTATION",
        annotationId: "old",
        createdAt: 10,
        targetSceneObjectId: older.sceneObjectId,
      },
    ];

    expect(resolve(
      { kind: "relative", relation: "last_target", objectType: "graph" },
      [older, recent],
      operations,
    )).toMatchObject({
      status: "RESOLVED",
      target: { kind: "object", objectId: recent.sceneObjectId },
    });
    expect(resolve(
      { kind: "relative", relation: "recent", objectType: "graph" },
      [older, recent],
      operations,
    )).toMatchObject({
      status: "RESOLVED",
      target: { kind: "object", objectId: recent.sceneObjectId },
    });
  });

  it.each([
    {
      query: {
        kind: "text_span",
        startAnchor: "세종대왕의",
        endAnchor: "업적",
      } satisfies TargetQuery,
      targetText: "세종대왕의 주요 업적",
    },
    {
      query: {
        kind: "semantic_unit",
        unit: "line",
        query: "AI의 문제점을 설명하는 문장",
      } satisfies TargetQuery,
      targetText: "AI의 문제점을 설명하는 문장",
    },
  ])("resolves actual text-bearing Scene units without fake offsets", ({
    query,
    targetText,
  }) => {
    const result = resolve(query, [
      candidate({
        candidateId: `candidate:${targetText}`,
        sceneObjectId: `pdf:${targetText}`,
        text: targetText,
      }),
    ]);

    expect(result).toMatchObject({
      status: "RESOLVED",
      target: { kind: "text_span", text: targetText },
    });
    if (result.status !== "RESOLVED") throw new Error("Expected resolution.");
    expect(result.target).not.toHaveProperty("startOffset");
    expect(result.target).not.toHaveProperty("endOffset");
  });

  it("resolves object queries within the actual Scene kind allowlist", () => {
    const graph = candidate({
      candidateId: "candidate:canvas:graph:quadratic",
      sceneObjectId: "canvas:graph:quadratic",
      source: "ggulnote",
      type: "graph",
      text: "y=x^2",
      editable: true,
      annotatable: false,
    });

    expect(resolve(
      { kind: "object", objectType: "graph", query: "y=x^2" },
      [graph],
    )).toMatchObject({
      status: "RESOLVED",
      target: { kind: "object", objectId: graph.sceneObjectId },
    });
  });

  it("resolves sentence units when the actual PageSemanticModel candidate is available", () => {
    const result = resolve(
      {
        kind: "semantic_unit",
        unit: "sentence",
        query: "AI의 문제점을 설명",
      },
      [
        candidate({
          candidateId: "candidate:semantic:sentence:1",
          sceneObjectId: undefined,
          semanticObjectId: "sentence-1",
          type: "sentence",
          semanticUnit: "sentence",
          text: "AI의 문제점을 설명하는 문장",
        }),
      ],
    );

    expect(result).toMatchObject({
      status: "RESOLVED",
      target: {
        kind: "text_span",
        type: "sentence",
        text: "AI의 문제점을 설명하는 문장",
      },
    });
    if (result.status !== "RESOLVED") throw new Error("Expected sentence.");
    expect(result.target).not.toHaveProperty("objectId");
  });

  it("uses deterministic Korean spacing and minor STT mismatch similarity", () => {
    const result = resolve(
      { kind: "text_span", quote: "세종 대왕에 업적" },
      [
        candidate({
          candidateId: "candidate:matching",
          sceneObjectId: "pdf:matching",
          text: "세종대왕의 업적",
        }),
      ],
    );

    expect(result).toMatchObject({ status: "RESOLVED" });
    if (result.status !== "RESOLVED") throw new Error("Expected fuzzy resolution.");
    expect(result.evidence.fuzzyMatch).toBeGreaterThan(0.7);
  });

  it("returns AMBIGUOUS for close candidates without auto-selecting top1", () => {
    const result = resolve(
      { kind: "semantic_unit", unit: "line", query: "동일한 문장" },
      [
        candidate({
          candidateId: "candidate:a",
          sceneObjectId: "pdf:a",
          text: "동일한 문장",
          readingOrder: 1,
        }),
        candidate({
          candidateId: "candidate:b",
          sceneObjectId: "pdf:b",
          text: "동일한 문장",
          readingOrder: 2,
        }),
      ],
    );

    expect(result).toMatchObject({
      status: "AMBIGUOUS",
      reasonCode: "AMBIGUOUS_MATCH",
    });
    if (result.status !== "AMBIGUOUS") throw new Error("Expected ambiguity.");
    expect(result.candidates).toHaveLength(2);
  });

  it("returns NOT_FOUND and an explicit unsupported path for subranges", () => {
    expect(resolve(
      { kind: "text_span", quote: "존재하지 않는 구절" },
      [
        candidate({
          candidateId: "candidate:other",
          sceneObjectId: "pdf:other",
          text: "완전히 다른 내용",
        }),
      ],
    )).toMatchObject({ status: "NOT_FOUND" });

    expect(resolve(
      {
        kind: "subrange",
        parent: { kind: "relative", relation: "focused" },
        query: "2x",
      },
      [],
    )).toEqual({
      status: "NOT_FOUND",
      reasonCode: "SUBRANGE_UNSUPPORTED",
    });
  });
});
