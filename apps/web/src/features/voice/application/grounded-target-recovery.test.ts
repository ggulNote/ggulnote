import type { PageSemanticModel } from "@ggulnote/document-core";
import type { Rect } from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import {
  DIRECT_COMMAND_NAMES,
  type CandidateEvidence,
  type CompletedVoiceTurn,
  type DirectCommandContext,
  type ExecutableDirectPlan,
  type PageTargetCandidate,
  type PageTargetCatalog,
  type SpeechGroundingEvidence,
  type TargetQuery,
  type TargetResolutionInput,
} from "../domain";
import { DirectAiProviderError } from "../domain/direct-ai-provider-error";
import { FakeGroundedTargetRecoveryProvider } from "../providers/testing/fake-grounded-target-recovery-provider";
import { FrozenTargetResolver } from "./frozen-target-resolver";
import { GroundedTargetRecovery } from "./grounded-target-recovery";

const EMPTY_EVIDENCE: CandidateEvidence = {
  typeMatch: 1,
  lexicalMatch: null,
  fuzzyMatch: null,
  semanticMatch: null,
  mathMatch: null,
  temporalMatch: null,
  structuralMatch: null,
  focusMatch: null,
};

function candidate(
  candidateId: string,
  text: string,
  options: Partial<PageTargetCandidate> = {},
): PageTargetCandidate {
  const type = options.type ?? "sentence";
  const { semanticUnit, ...rest } = options;
  const resolvedSemanticUnit = semanticUnit
    ?? (type === "sentence" ? "sentence" : undefined);
  return {
    candidateId,
    source: "pdf",
    type,
    pageId: "page-1",
    text,
    editable: false,
    annotatable: true,
    readingOrder: 1,
    ...rest,
    ...(resolvedSemanticUnit === undefined
      ? {}
      : { semanticUnit: resolvedSemanticUnit }),
  };
}

function turn(rawTranscript: string): CompletedVoiceTurn {
  return {
    id: "turn-1",
    providerId: "test",
    providerSessionId: "session-1",
    language: "ko-KR",
    requestedAt: 1,
    startedAt: 2,
    completedAt: 3,
    state: "completed",
    rawTranscript,
    finalSegments: [],
    frozenContext: {
      pageId: "page-1",
      sceneMode: "pdf",
      sceneRevision: 7,
      focusSource: "page",
      focusStale: false,
      capturedAt: 2,
    },
    focusSnapshot: {
      source: "page",
      capturedAt: 2,
      pageId: "page-1",
      sceneRevision: 7,
      stale: false,
    },
    scene: {
      sceneRevisionAtSpeechStart: 7,
      pageIdAtSpeechStart: "page-1",
      currentSceneRevisionAtCompletion: 7,
      sceneChangedDuringTurn: false,
      pageChangedDuringTurn: false,
    },
    metrics: {
      interimUpdateCount: 0,
      finalSegmentCount: 1,
      providerRestartCount: 0,
    },
  };
}

function speechEvidence(
  rawFinalTranscript: string,
  terms: readonly [string, string][],
): SpeechGroundingEvidence {
  return {
    rawFinalTranscript,
    termHypotheses: terms.map(([rawSpan, value]) => ({
      rawSpan,
      candidates: [{ value, source: "document_lexicon" as const, confidence: 1 }],
    })),
    numberHypotheses: [],
    contextualTerms: [],
    asrAlternatives: [],
    diagnostics: {
      speechNormalizationUsed: true,
      termHypothesisCount: terms.length,
      numberHypothesisCount: 0,
      documentLexiconSize: terms.length,
      contextTermCount: 0,
      normalizationMs: 1,
    },
  };
}

function context(
  catalog: PageTargetCatalog,
  evidence?: SpeechGroundingEvidence,
): DirectCommandContext {
  const completed = turn(evidence?.rawFinalTranscript ?? "대상 복구");
  return {
    turn: completed,
    frozenContext: completed.frozenContext,
    pageTargetCatalog: catalog,
    recentOperations: [],
    plannerContext: {
      turn: {
        turnId: completed.id,
        language: completed.language,
        rawFinalTranscript: completed.rawTranscript,
      },
      frozenContext: {
        pageId: "page-1",
        sceneMode: "pdf",
        sceneRevision: 7,
        focusSource: "page",
        focusStale: false,
        capturedAt: 2,
        focus: null,
      },
      allowedCommands: DIRECT_COMMAND_NAMES,
    },
    ...(evidence === undefined ? {} : { speechGroundingEvidence: evidence }),
  };
}

function plan(query: TargetQuery): ExecutableDirectPlan {
  return {
    status: "EXECUTABLE",
    planId: "plan-1",
    turnId: "turn-1",
    sceneRevision: 7,
    normalizedIntent: "target highlight",
    relation: "NEW",
    command: {
      capability: "annotation",
      operation: "highlight",
      target: query,
      payload: {},
    },
  };
}

function resolutionInput(
  query: TargetQuery,
  catalog: PageTargetCatalog,
  evidence?: SpeechGroundingEvidence,
): TargetResolutionInput {
  return {
    query,
    catalog,
    frozenContext: turn("target").frozenContext,
    recentOperations: [],
    ...(evidence === undefined ? {} : { speechGroundingEvidence: evidence }),
  };
}

describe("GroundedTargetRecovery", () => {
  it("recovers the entire-process sentence from bounded Frozen Page candidates", async () => {
    const s1 = candidate("s1", "The training process starts after preprocessing.", {
      readingOrder: 1,
    });
    const s2 = candidate("s2", "The entire process consists of three stages.", {
      readingOrder: 2,
    });
    const s3 = candidate("s3", "The final output is stored.", { readingOrder: 3 });
    const offPage = candidate("page-2", "The entire process is elsewhere.", {
      pageId: "page-2",
    });
    const catalog: PageTargetCatalog = {
      pageId: "page-1",
      sceneRevision: 7,
      candidates: [s1, s2, s3, offPage],
    };
    const evidence = speechEvidence(
      "헨타이어 프로세스 들어간 문장 하이라이트",
      [["헨타이어", "entire"]],
    );
    const query = {
      kind: "semantic_unit",
      unit: "sentence",
      query: "헨타이어 프로세스 들어간",
    } as const;
    const provider = new FakeGroundedTargetRecoveryProvider({
      status: "SELECTED",
      candidateLabel: "C1",
    });
    const recovery = new GroundedTargetRecovery({
      provider,
      resolver: new FrozenTargetResolver(),
    });

    const result = await recovery.recover({
      context: context(catalog, evidence),
      plan: plan(query),
      resolutionInput: resolutionInput(query, catalog, evidence),
      initialResolution: {
        status: "NOT_FOUND",
        reasonCode: "LOW_CONFIDENCE",
        recoveryCandidates: [{ candidate: s2, score: 0.4, evidence: EMPTY_EVIDENCE }],
      },
    });

    expect(result).toMatchObject({
      status: "RESOLVED",
      kind: "semantic_unit",
      resolution: { target: { candidateId: "s2", text: s2.text } },
    });
    expect(provider.recoverCallCount).toBe(1);
    expect(provider.lastInput?.kind).toBe("semantic_unit");
    expect(JSON.stringify(provider.lastInput)).not.toContain("candidateId");
    expect(JSON.stringify(provider.lastInput)).not.toContain("page-2");
    expect(provider.lastInput?.speechEvidence?.termHypotheses).toEqual([
      { rawSpan: "헨타이어", candidates: ["entire"] },
    ]);
  });

  it("recovers only same-type Canvas TEXT objects", async () => {
    const text = candidate("text-1", "역전파의 핵심은 연쇄법칙이다", {
      source: "ggulnote",
      type: "text",
      sceneObjectId: "canvas:text-1",
      editable: true,
    });
    const graph = candidate("graph-1", "역전파 그래프", {
      source: "ggulnote",
      type: "graph",
      sceneObjectId: "canvas:graph-1",
    });
    const catalog: PageTargetCatalog = {
      pageId: "page-1",
      sceneRevision: 7,
      candidates: [text, graph],
    };
    const query = {
      kind: "object",
      objectType: "text",
      query: "역전파 설명한 텍스트",
    } as const;
    const provider = new FakeGroundedTargetRecoveryProvider({
      status: "SELECTED",
      candidateLabel: "O1",
    });
    const result = await new GroundedTargetRecovery({
      provider,
      resolver: new FrozenTargetResolver(),
    }).recover({
      context: context(catalog),
      plan: plan(query),
      resolutionInput: resolutionInput(query, catalog),
      initialResolution: {
        status: "NOT_FOUND",
        reasonCode: "LOW_CONFIDENCE",
        recoveryCandidates: [{ candidate: text, score: 0.4, evidence: EMPTY_EVIDENCE }],
      },
    });

    expect(result).toMatchObject({
      status: "RESOLVED",
      kind: "object",
      resolution: { target: { objectId: "canvas:text-1" } },
    });
    if (provider.lastInput?.kind !== "object") throw new Error("Expected object input.");
    expect(provider.lastInput.candidates).toHaveLength(1);
    expect(provider.lastInput.candidates[0]?.type).toBe("text");
  });

  it("recovers actual Moreover-to-instance tokens and materializes line Rect[]", async () => {
    const fixture = textSpanFixture();
    const evidence = speechEvidence(
      "모얼오벌부터 인스탠스까지 밑줄",
      [["모얼오벌", "Moreover"], ["인스탠스", "instance"]],
    );
    const query = {
      kind: "text_span",
      startAnchor: "모얼오벌",
      endAnchor: "인스탠스",
    } as const;
    const provider = new FakeGroundedTargetRecoveryProvider({
      status: "SELECTED",
      pairLabel: "P1",
    });
    const result = await new GroundedTargetRecovery({
      provider,
      resolver: new FrozenTargetResolver(),
    }).recover({
      context: context(fixture.catalog, evidence),
      plan: plan(query),
      resolutionInput: resolutionInput(query, fixture.catalog, evidence),
      initialResolution: { status: "NOT_FOUND", reasonCode: "NO_MATCH" },
    });

    expect(result).toMatchObject({
      status: "RESOLVED",
      resolution: {
        target: {
          kind: "text_span",
          text: "Moreover modern For instance",
          bounds: [
            { x: 0, y: 0, width: 118, height: 18 },
            { x: 0, y: 24, width: 94, height: 18 },
          ],
        },
      },
    });
    if (provider.lastInput?.kind !== "text_span") throw new Error("Expected span input.");
    expect(provider.lastInput.pairCandidates[0]).toMatchObject({
      label: "P1",
      startText: "Moreover",
      endText: "instance",
      alignment: {
        start: { coverage: "full", boundary: "clean" },
        end: { coverage: "full", boundary: "clean" },
      },
    });
    expect(JSON.stringify(provider.lastInput)).not.toContain("tokenId");
    expect(JSON.stringify(provider.lastInput)).not.toContain("readingOrder");
  });

  it("returns NONE without an LLM call when an actual end anchor candidate is absent", async () => {
    const fixture = textSpanFixture(false);
    const evidence = speechEvidence(
      "모얼오벌부터 인스탠스까지",
      [["모얼오벌", "Moreover"], ["인스탠스", "instance"]],
    );
    const query = {
      kind: "text_span",
      startAnchor: "모얼오벌",
      endAnchor: "인스탠스",
    } as const;
    const provider = new FakeGroundedTargetRecoveryProvider({ status: "NONE" });
    const result = await new GroundedTargetRecovery({
      provider,
      resolver: new FrozenTargetResolver(),
    }).recover({
      context: context(fixture.catalog, evidence),
      plan: plan(query),
      resolutionInput: resolutionInput(query, fixture.catalog, evidence),
      initialResolution: { status: "NOT_FOUND", reasonCode: "NO_MATCH" },
    });

    expect(result).toMatchObject({ status: "NONE", providerCalled: false });
    expect(provider.recoverCallCount).toBe(0);
  });

  it("keeps valid occurrence pairs distinct and exposes only pair labels", async () => {
    const fixture = textSpanFixture(true, true);
    const evidence = speechEvidence(
      "모얼오벌부터 인스탠스까지",
      [["모얼오벌", "Moreover"], ["인스탠스", "instance"]],
    );
    const query = {
      kind: "text_span",
      startAnchor: "모얼오벌",
      endAnchor: "인스탠스",
    } as const;
    const provider = new FakeGroundedTargetRecoveryProvider({
      status: "SELECTED",
      pairLabel: "P1",
    });
    const recovery = new GroundedTargetRecovery({
      provider,
      resolver: new FrozenTargetResolver(),
    });
    const result = await recovery.recover({
      context: context(fixture.catalog, evidence),
      plan: plan(query),
      resolutionInput: resolutionInput(query, fixture.catalog, evidence),
      initialResolution: { status: "NOT_FOUND", reasonCode: "NO_MATCH" },
    });

    expect(result.status).toBe("RESOLVED");
    if (provider.lastInput?.kind !== "text_span") throw new Error("Expected span input.");
    expect(provider.lastInput.pairCandidates.length).toBeGreaterThan(0);
    expect(provider.recoverCallCount).toBe(1);
  });

  it("normalizes provider unavailability without selecting a target", async () => {
    const item = candidate("s1", "A sentence");
    const catalog: PageTargetCatalog = {
      pageId: "page-1",
      sceneRevision: 7,
      candidates: [item],
    };
    const query = {
      kind: "semantic_unit",
      unit: "sentence",
      query: "missing",
    } as const;
    const provider = new FakeGroundedTargetRecoveryProvider(
      { status: "NONE" },
      new DirectAiProviderError("PLANNER_UNAVAILABLE", "NETWORK_FAILURE"),
    );
    const result = await new GroundedTargetRecovery({
      provider,
      resolver: new FrozenTargetResolver(),
    }).recover({
      context: context(catalog),
      plan: plan(query),
      resolutionInput: resolutionInput(query, catalog),
      initialResolution: { status: "NOT_FOUND", reasonCode: "LOW_CONFIDENCE" },
    });
    expect(result).toMatchObject({
      status: "ERROR",
      errorCode: "RECOVERY_UNAVAILABLE",
    });
  });
});

function textSpanFixture(
  includeEnd = true,
  reverse = false,
): { catalog: PageTargetCatalog } {
  type WordSpec = readonly [string, string, string, number, Rect];
  const reverseSpecs = [
        ["instance-1", "instance", "line-1", 1, { x: 0, y: 0, width: 62, height: 18 }],
        ["moreover", "Moreover", "line-1", 2, { x: 66, y: 0, width: 56, height: 18 }],
        ["instance-2", "instance", "line-2", 3, { x: 0, y: 24, width: 62, height: 18 }],
      ] satisfies readonly WordSpec[];
  const forwardSpecs = [
        ["moreover", "Moreover", "line-1", 1, { x: 0, y: 0, width: 56, height: 18 }],
        ["modern", "modern", "line-1", 2, { x: 62, y: 0, width: 56, height: 18 }],
        ["for", "For", "line-2", 3, { x: 0, y: 24, width: 26, height: 18 }],
        ...(includeEnd
          ? [["instance-1", "instance", "line-2", 4, { x: 32, y: 24, width: 62, height: 18 }] as const]
          : []),
      ] satisfies readonly WordSpec[];
  const specs: readonly WordSpec[] = reverse ? reverseSpecs : forwardSpecs;
  const words = specs.map(([id, text, lineId, readingOrder, bounds]) => ({
    id,
    type: "WORD",
    pageId: "page-1",
    text,
    normalizedText: text,
    readingOrder,
    lineId,
    sourceRanges: [{ sourceTextItemId: id, startOffset: 0, endOffset: text.length }],
  }));
  const lines = [
    { id: "line-1", type: "LINE", pageId: "page-1", text: "line one", readingOrder: 1, paragraphId: null },
    { id: "line-2", type: "LINE", pageId: "page-1", text: "line two", readingOrder: 2, paragraphId: null },
  ];
  const semanticModel = {
    getAllByReadingOrder: () => [...words, ...lines],
  } as unknown as PageSemanticModel;
  const candidates = specs.map(([id, text, , readingOrder, bounds]) =>
    candidate(`target:${id}`, text, {
      type: "word",
      sourceObjectId: id,
      sceneObjectId: `scene:${id}`,
      readingOrder,
      bounds: bounds as Rect,
    }));
  return {
    catalog: {
      pageId: "page-1",
      sceneRevision: 7,
      semanticModel,
      candidates,
    },
  };
}
