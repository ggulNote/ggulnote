import type { SceneSnapshot, TextSceneObject } from "@ggulnote/editor-core";
import { describe, expect, it } from "vitest";
import type {
  CompletedVoiceTurn,
  PageTargetCandidate,
  PageTargetCatalog,
} from "../domain";
import { DirectCommandContextBuilder } from "./direct-command-context-builder";
import {
  buildDocumentLexicon,
  normalizeSpokenMath,
  normalizeSpokenNumbers,
  TypedSpeechNormalizer,
} from "./typed-speech-normalizer";

const candidate = (
  candidateId: string,
  text: string,
  type: PageTargetCandidate["type"] = "word",
  source: PageTargetCandidate["source"] = "pdf",
  pageId = "page-1",
): PageTargetCandidate => ({
  candidateId,
  source,
  type,
  pageId,
  sourceObjectId: `source:${candidateId}`,
  sceneObjectId: `scene:${candidateId}`,
  text,
  editable: source === "ggulnote",
  annotatable: true,
});

const catalog = (candidates: readonly PageTargetCandidate[]): PageTargetCatalog => ({
  pageId: "page-1",
  sceneRevision: 1,
  candidates,
});

describe("TypedSpeechNormalizer", () => {
  it("creates production context evidence once from the Frozen Page catalog", () => {
    const textObject: TextSceneObject = {
      id: "scene:text",
      pageId: "page-1",
      source: "canvas",
      kind: "text",
      sourceObjectId: "annotation:text",
      bounds: { x: 10, y: 20, width: 100, height: 20 },
      zIndex: 1,
      visible: true,
      locked: false,
      objectRevision: 1,
      text: "Transformer",
      style: { fontSize: 16 },
    };
    const scene: SceneSnapshot = {
      sceneRevision: 1,
      mode: "blank",
      page: { id: "page-1", index: 0, width: 800, height: 1000 },
      objects: [textObject],
      objectById: { [textObject.id]: textObject },
      renderOrder: [textObject.id],
      generatedAt: 1,
    };
    const turn: CompletedVoiceTurn = {
      id: "turn-1",
      providerId: "test",
      providerSessionId: "session-1",
      language: "ko-KR",
      requestedAt: 1,
      startedAt: 2,
      completedAt: 3,
      state: "completed",
      rawTranscript: "트랜스포머 하이라이트",
      finalSegments: [],
      frozenContext: {
        pageId: "page-1",
        sceneMode: "blank",
        sceneRevision: 1,
        focusSource: "none",
        focusStale: false,
        capturedAt: 2,
      },
      focusSnapshot: {
        source: "none",
        capturedAt: 2,
        pageId: "page-1",
        sceneRevision: 1,
        stale: false,
      },
      scene: {
        sceneRevisionAtSpeechStart: 1,
        pageIdAtSpeechStart: "page-1",
        sceneChangedDuringTurn: false,
        pageChangedDuringTurn: false,
      },
      metrics: {
        interimUpdateCount: 0,
        finalSegmentCount: 0,
        providerRestartCount: 0,
      },
    };
    const builder = new DirectCommandContextBuilder({
      frozenSceneSource: {
        getSnapshot: () => ({ scene }),
      },
      recentOperationsSource: {
        getRecentOperations: () => [],
      },
    });

    const result = builder.build(turn);

    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(result.context.speechGroundingEvidence).toBeUndefined();
    const speechGroundingEvidence = builder.buildSpeechGroundingEvidence(
      result.context,
      { kind: "object", objectType: "text", query: "트랜스포머" },
    );
    expect(speechGroundingEvidence).toMatchObject({
      rawFinalTranscript: "트랜스포머 하이라이트",
      targetSlots: [{ kind: "object_query", text: "트랜스포머" }],
      diagnostics: {
        speechNormalizationUsed: true,
        documentLexiconSize: 1,
        targetSlotKind: "object",
      },
    });
  });

  it("builds a bounded Frozen Page lexicon with source mapping and dedupe", () => {
    const entries = buildDocumentLexicon(catalog([
      candidate("entire-1", "entire"),
      candidate("entire-2", "Entire"),
      candidate("other-page", "excluded", "word", "pdf", "page-2"),
      candidate("canvas", "Transformer memo", "text", "ggulnote"),
    ]));

    expect(entries.map((entry) => entry.surface)).toEqual([
      "entire",
      "Transformer",
      "memo",
      "Transformer memo",
    ]);
    expect(entries[0]?.sourceReferences).toHaveLength(2);
    expect(entries.some((entry) => entry.surface === "excluded")).toBe(false);
  });

  it("preserves raw STT and produces only document-grounded phonetic candidates", () => {
    let now = 10;
    const normalizer = new TypedSpeechNormalizer({ now: () => now++ });
    for (const [rawSpan, expected] of [
      ["헨타이어", "entire"],
      ["모얼오벌", "Moreover"],
      ["인스탠스", "instance"],
      ["트랜스포머", "Transformer"],
    ] as const) {
      const evidence = normalizer.normalize({
        rawFinalTranscript: rawSpan,
        targetQuery: { kind: "text_span", quote: rawSpan },
        pageTargetCatalog: catalog([
          candidate("entire", "entire"),
          candidate("process", "process"),
          candidate("moreover", "Moreover"),
          candidate("instance", "instance"),
          candidate("transformer", "Transformer"),
        ]),
        focusObjectId: "scene:entire",
      });
      expect(evidence.rawFinalTranscript).toBe(rawSpan);
      expect(evidence.termHypotheses.find((item) => item.rawSpan === rawSpan)
        ?.candidates.map((item) => item.value)).toContain(expected);
      expect(evidence.diagnostics.normalizationMs).toBe(1);
      expect(Object.isFrozen(evidence)).toBe(true);
    }
  });

  it("does not hallucinate an English candidate absent from the lexicon", () => {
    const evidence = new TypedSpeechNormalizer().normalize({
      rawFinalTranscript: "헨타이어",
      targetQuery: { kind: "text_span", quote: "헨타이어" },
      pageTargetCatalog: catalog([candidate("process", "process")]),
    });
    expect(evidence.termHypotheses.flatMap((item) => item.candidates)
      .some((item) => item.value.toLowerCase() === "entire")).toBe(false);
  });
});

describe("typed number normalization", () => {
  it.each([
    ["이십삼", { kind: "integer", value: 23 }],
    ["이 점 삼", { kind: "decimal", value: 2.3 }],
    ["이십삼 퍼센트", { kind: "percent", value: 23 }],
    ["이의 삼승", { kind: "power", base: 2, exponent: 3 }],
  ] as const)("normalizes %s", (raw, expected) => {
    expect(normalizeSpokenNumbers(raw)[0]).toMatchObject(expected);
  });

  it("keeps a spaced digit sequence ambiguous", () => {
    expect(normalizeSpokenNumbers("이 삼")).toEqual([
      { kind: "sequence", raw: "이 삼", values: [2, 3], ambiguous: true },
      { kind: "integer", raw: "이 삼", value: 23, ambiguous: true },
    ]);
  });
});

describe("spoken math normalization", () => {
  it.each([
    ["엑스", "x"],
    ["삼 엑스", "3x"],
    ["엑스 제곱 더하기 삼 엑스", "x^2 + 3x"],
    ["이 엑스는 오", "2x = 5"],
  ] as const)("normalizes %s", (raw, normalizedText) => {
    expect(normalizeSpokenMath(raw)).toMatchObject({
      status: "NORMALIZED",
      normalizedText,
    });
  });

  it("does not invent precedence or an AST", () => {
    expect(normalizeSpokenMath("마이너스 엑스 제곱")).toEqual({
      raw: "마이너스 엑스 제곱",
      status: "AMBIGUOUS",
    });
    expect(normalizeSpokenMath("적분해 줘")).toEqual({
      raw: "적분해 줘",
      status: "UNSUPPORTED",
    });
  });
});
