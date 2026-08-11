import { describe, expect, it } from "vitest";
import type { CanonicalTextStream, CanonicalTextToken } from "./canonical-text-stream";
import {
  buildSpanPairCandidates,
  canonicalizeAnchorCandidates,
  groundTextSpan,
  normalizeTextSpanAnchorSlot,
  pruneDominatedSpanPairs,
  retrieveAnchorSpanCandidates,
  TEXT_SPAN_GROUNDING_POLICY,
} from "./text-span-grounder";

describe("layered TextSpan grounding", () => {
  it("normalizes boundary particles and keeps single-token anchors on the shared path", () => {
    const page = createStream(["challenge", "requires", "complex", "reasoning"]);
    expect(normalizeTextSpanAnchorSlot("챌린지부터", "start")).toBe("챌린지");
    expect(normalizeTextSpanAnchorSlot("콤플렉스까지", "end")).toBe("콤플렉스");
    const candidates = retrieveAnchorSpanCandidates(page, "capability", { role: "start" });
    expect(candidates).toEqual([]);
    expect(retrieveAnchorSpanCandidates(page, "challenge", { role: "start" })[0])
      .toMatchObject({ text: "challenge", tokenCount: 1 });
  });

  it("recalls a multi-token vision capability anchor by seed expansion and coverage", () => {
    const page = visionPage();
    const candidates = retrieveAnchorSpanCandidates(page, "미전 케퍼블리티", { role: "start" });
    const phrase = candidates.find((candidate) => candidate.text === "vision capability");
    const token = candidates.find((candidate) => candidate.text === "capability");
    expect(phrase).toBeDefined();
    expect(phrase?.evidence.coverage).toBe(1);
    expect(phrase?.evidence).toMatchObject({
      queryChunkCount: 2,
      matchedChunkCount: 2,
      boundaryPrecision: 1,
      extraPrefixTokens: 0,
      extraSuffixTokens: 0,
    });
    expect(phrase?.score).toBeGreaterThan(token?.score ?? 0);
  });

  it("canonicalizes same-occurrence boundary variants relative to the query", () => {
    const page = visionPage();
    const clean = retrieveAnchorSpanCandidates(page, "미전 케퍼블리티", { role: "start" })
      .find((candidate) => candidate.text === "vision capability");
    if (clean === undefined) throw new Error("Expected clean anchor.");
    const expanded = {
      ...clean,
      text: "Particularly vision capability",
      startIndex: clean.startIndex - 1,
      tokenCount: clean.tokenCount + 1,
      evidence: {
        ...clean.evidence,
        candidateTokenCount: clean.evidence.candidateTokenCount + 1,
        extraPrefixTokens: 1,
        boundaryPrecision: 2 / 3,
      },
      score: clean.score - 0.06,
    };
    expect(canonicalizeAnchorCandidates([expanded, clean])).toEqual([clean]);

    const explicit = retrieveAnchorSpanCandidates(
      page,
      "Particularly vision capability",
      { role: "start" },
    )[0];
    expect(explicit).toMatchObject({
      text: "Particularly vision capability",
      evidence: { coverage: 1, boundaryPrecision: 1 },
    });
  });

  it("supports multi-token anchors on the end and on both sides", () => {
    const page = createStream([
      "challenge", "drives", "browser", "rendering", "while", "vision", "capability", "improves", "web", "browsing",
    ]);
    const end = retrieveAnchorSpanCandidates(page, "browser rendering", { role: "end" });
    expect(end[0]).toMatchObject({ text: "browser rendering", tokenCount: 2 });
    const both = groundTextSpan({
      stream: page,
      query: { kind: "text_span", startAnchor: "vision capability", endAnchor: "web browsing" },
    });
    expect(both.status).not.toBe("NOT_FOUND");
    if (both.status === "NOT_FOUND") return;
    expect((both.status === "RESOLVED" ? both.pair : both.pairs[0])?.start.text)
      .toBe("vision capability");
    expect((both.status === "RESOLVED" ? both.pair : both.pairs[0])?.end.text)
      .toBe("web browsing");
  });

  it("builds an actual forward pair for vision capability through browsers", () => {
    const page = visionPage();
    const result = groundTextSpan({
      stream: page,
      query: { kind: "text_span", startAnchor: "미전 케퍼블리티", endAnchor: "브라우저스" },
    });
    expect(result.status).not.toBe("NOT_FOUND");
    if (result.status === "NOT_FOUND") return;
    const pair = result.status === "RESOLVED" ? result.pair : result.pairs[0];
    expect(pair).toMatchObject({
      start: { text: "vision capability" },
      end: { text: "browsers" },
      evidence: { forwardValid: true, rangeMaterializable: true },
    });
    expect(pair?.materialized.bounds.length).toBeGreaterThanOrEqual(2);
    expect(result.diagnostics.multiTokenAnchorUsed).toBe(true);
  });

  it("deterministically selects clean full-coverage phrase boundaries", () => {
    const page = createStream([
      "Particularly,", "vision", "capability", "is", "crucial", "for", "utilizing",
      "tools", "such", "as", "web", "browsers,", "as", "rendered", "web", "pages",
      "support", "web", "browsing",
    ]);
    const result = groundTextSpan({
      stream: page,
      query: {
        kind: "text_span",
        startAnchor: "비전 capability",
        endAnchor: "웹 브라우저스",
      },
    });
    expect(result.status).toBe("RESOLVED");
    if (result.status !== "RESOLVED") return;
    expect(result.pair).toMatchObject({
      start: {
        text: "vision capability",
        evidence: { coverage: 1, boundaryPrecision: 1 },
      },
      end: {
        text: "web browsers,",
        evidence: { coverage: 1, boundaryPrecision: 1 },
      },
      evidence: {
        startAlignment: { matchedChunkCount: 2, queryChunkCount: 2 },
        endAlignment: { matchedChunkCount: 2, queryChunkCount: 2 },
      },
    });
    expect(result.diagnostics).toMatchObject({
      dominatedAnchorVariantCount: expect.any(Number),
      spanPairCandidateCountBeforePruning: expect.any(Number),
      spanPairCandidateCountAfterPruning: expect.any(Number),
      spanPairResolvedDeterministically: true,
    });
  });

  it("ranks browser morphology above end phrases with partial alignment", () => {
    const page = createStream(["web", "browsers", "then", "web", "pages", "and", "web", "browsing"]);
    const candidates = retrieveAnchorSpanCandidates(page, "웹 브라우저스", { role: "end" });
    expect(candidates[0]).toMatchObject({
      text: "web browsers",
      evidence: { coverage: 1, boundaryPrecision: 1 },
    });
    expect(candidates.find((candidate) => candidate.text === "web pages")?.score ?? 0)
      .toBeLessThan(candidates[0]?.score ?? 0);
  });

  it("separates high-recall retrieval hits from query-relative chunk support", () => {
    const page = createStream([
      "bridge", "approaches", "approach",
      "exceptional", "capability", "represent", "a", "vision", "capability",
      "then", "web", "pages", "before", "web", "browsers",
    ]);
    const starts = retrieveAnchorSpanCandidates(page, "비전 capability", { role: "start" });
    const correct = starts.find((candidate) => candidate.text === "vision capability");
    const partial = starts.find((candidate) => candidate.text === "exceptional capability");
    const noise = starts.find((candidate) => candidate.text === "represent a");
    expect(correct?.evidence).toMatchObject({
      matchedChunkCount: 2,
      coverage: 1,
      boundaryPrecision: 1,
    });
    expect(correct?.evidence.chunkAlignments).toHaveLength(2);
    expect(partial?.evidence.coverage ?? 0).toBeLessThan(1);
    expect(partial?.evidence.matchedChunkCount ?? 0).toBeLessThan(2);
    expect(noise?.evidence.coverage ?? 0).toBeLessThan(1);

    const ends = retrieveAnchorSpanCandidates(page, "웹 브라우저", { role: "end" });
    const browsers = ends.find((candidate) => candidate.text === "web browsers");
    const browserAlignment = browsers?.evidence.chunkAlignments.find(
      (alignment) => alignment.queryChunkIndex === 1,
    );
    expect(browsers?.evidence.coverage).toBe(1);
    expect(browserAlignment?.relativeScore ?? 1)
      .toBeLessThan(TEXT_SPAN_GROUNDING_POLICY.minSupportedChunkRelativeScore);
    expect(browserAlignment?.supported).toBe(true);
    expect(ends.find((candidate) => candidate.text === "web pages")?.evidence.coverage ?? 0)
      .toBeLessThan(1);
  });

  it("uses absolute fuzzy support for an English typo inside a grounded phrase", () => {
    const page = createStream(["vision", "capability", "to", "web", "browsers"]);
    expect(retrieveAnchorSpanCandidates(page, "비전 capibility", { role: "start" })[0])
      .toMatchObject({
        text: "vision capability",
        evidence: { matchedChunkCount: 2, coverage: 1, boundaryPrecision: 1 },
      });
  });

  it("ranks the production-style bilingual span deterministically without recovery", () => {
    const page = createStream([
      "bridge", "approaches", "approach",
      "exceptional", "capability", "can", "represent", "a", "baseline", "while",
      "Particularly,", "vision", "capability", "is", "crucial", "for", "utilizing",
      "tools", "such", "as", "web", "browsers,", "as", "rendered", "web", "pages",
      "support", "web", "browsing",
    ]);
    const result = groundTextSpan({
      stream: page,
      query: {
        kind: "text_span",
        startAnchor: "비전 capability",
        endAnchor: "웹 브라우저",
      },
    });
    expect(result.status).toBe("RESOLVED");
    if (result.status !== "RESOLVED") return;
    expect(result.pair).toMatchObject({
      start: { text: "vision capability", evidence: { coverage: 1 } },
      end: { text: "web browsers,", evidence: { coverage: 1 } },
    });
    expect(result.diagnostics).toMatchObject({
      confidenceDecision: "deterministic",
      spanPairResolvedDeterministically: true,
      rawAnchorCandidateCount: expect.any(Number),
      canonicalAnchorCandidateCount: expect.any(Number),
      rawPairCandidateCount: expect.any(Number),
      nonDominatedPairCount: expect.any(Number),
      topSpanPairScore: expect.any(Number),
      runnerUpSpanPairScore: expect.any(Number),
    });
    expect(result.diagnostics.topSpanPairScore ?? 0)
      .toBeGreaterThan(result.diagnostics.runnerUpSpanPairScore ?? 0);
  });

  it("keeps genuine duplicate occurrences ambiguous for bounded recovery", () => {
    const page = createStream([
      "vision", "capability", "to", "web", "browsers", "then",
      "vision", "capability", "to", "web", "browsers",
    ], {
      sentenceByIndex: ["s1", "s1", "s1", "s1", "s1", "s2", "s2", "s2", "s2", "s2", "s2"],
    });
    const result = groundTextSpan({
      stream: page,
      query: { kind: "text_span", startAnchor: "vision capability", endAnchor: "web browsers" },
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.diagnostics).toMatchObject({
      confidenceDecision: "recovery",
      spanPairResolvedDeterministically: false,
    });
  });

  it("prunes only dominated boundary variants and preserves distinct occurrences", () => {
    const page = visionPage();
    const start = retrieveAnchorSpanCandidates(page, "미전 케퍼블리티", { role: "start" })[0];
    const end = retrieveAnchorSpanCandidates(page, "브라우저스", { role: "end" })[0];
    if (start === undefined || end === undefined) throw new Error("Expected anchors.");
    const pair = buildSpanPairCandidates(page, [start], [end])[0];
    if (pair === undefined) throw new Error("Expected pair.");
    const dominated = {
      ...pair,
      start: {
        ...start,
        text: `prefix ${start.text}`,
        startIndex: start.startIndex - 1,
        evidence: {
          ...start.evidence,
          extraPrefixTokens: 1,
          boundaryPrecision: start.evidence.boundaryPrecision / 2,
        },
        score: start.score - 0.1,
      },
      evidence: {
        ...pair.evidence,
        startAlignment: {
          ...pair.evidence.startAlignment,
          extraPrefixTokens: 1,
          boundaryPrecision: pair.evidence.startAlignment.boundaryPrecision / 2,
        },
      },
      score: pair.score - 0.1,
    };
    expect(pruneDominatedSpanPairs([dominated, pair])).toEqual([pair]);

    const twoOccurrences = createStream([
      "vision", "capability", "to", "browsers", "then", "vision", "capability", "to", "browsers",
    ]);
    const starts = retrieveAnchorSpanCandidates(twoOccurrences, "vision capability", { role: "start" });
    expect(starts.filter((candidate) => candidate.text === "vision capability")).toHaveLength(2);
  });

  it("does not force neighboring words onto a single-token capability anchor", () => {
    const page = visionPage();
    expect(retrieveAnchorSpanCandidates(page, "케퍼블리티", { role: "start" })[0])
      .toMatchObject({ text: "capability", tokenCount: 1 });
  });

  it("does not resolve a synthetic vision phrase when only visual capability exists", () => {
    const page = createStream(["visual", "capability", "supports", "browsers"]);
    const result = groundTextSpan({
      stream: page,
      query: { kind: "text_span", startAnchor: "미전 케퍼블리티", endAnchor: "브라우저스" },
    });
    expect(result.status).not.toBe("RESOLVED");
  });

  it("ranks occurrence pairs structurally without treating shortest range as a hard rule", () => {
    const page = createStream([
      "challenge", "in", "complex", "systems", "another", "section", "uses", "complex",
    ], {
      paragraphByIndex: ["p1", "p1", "p1", "p1", "p2", "p2", "p2", "p2"],
      sentenceByIndex: ["s1", "s1", "s1", "s1", "s2", "s2", "s2", "s2"],
    });
    const starts = retrieveAnchorSpanCandidates(page, "challenge", { role: "start" });
    const ends = retrieveAnchorSpanCandidates(page, "complex", { role: "end" });
    const pairs = buildSpanPairCandidates(page, starts, ends);
    expect(pairs.filter((pair) => pair.end.text === "complex")).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ range: { startIndex: 0, endIndex: 2 }, evidence: { sameSentence: true } });

    const longPage = createStream(["Introduction", ...Array.from({ length: 120 }, (_, index) => `term${index}`), "Conclusion"]);
    const longPairs = buildSpanPairCandidates(
      longPage,
      retrieveAnchorSpanCandidates(longPage, "Introduction", { role: "start" }),
      retrieveAnchorSpanCandidates(longPage, "Conclusion", { role: "end" }),
    );
    expect(longPairs[0]?.evidence.tokenDistance).toBe(122);
  });

  it("removes reverse pairs before recovery", () => {
    const page = createStream(["finish", "middle", "online"]);
    const pairs = buildSpanPairCandidates(
      page,
      retrieveAnchorSpanCandidates(page, "online", { role: "start" }),
      retrieveAnchorSpanCandidates(page, "finish", { role: "end" }),
    );
    expect(pairs).toEqual([]);
  });

  it("allows cross-line phrases in one paragraph but not cross-column paragraph stitching", () => {
    const crossLine = createStream(["vision", "capability", "works"], {
      lineByIndex: ["l1", "l2", "l2"],
      paragraphByIndex: ["p1", "p1", "p1"],
    });
    expect(retrieveAnchorSpanCandidates(crossLine, "vision capability", { role: "start" })[0])
      .toMatchObject({ text: "vision capability", lineIds: ["l1", "l2"] });

    const columns = createStream(["vision", "capability"], {
      paragraphByIndex: ["left-column", "right-column"],
    });
    expect(retrieveAnchorSpanCandidates(columns, "vision capability", { role: "start" })
      .some((candidate) => candidate.tokenCount === 2)).toBe(false);
  });

  it("keeps grounding capability-independent and reports pair diagnostics", () => {
    const page = visionPage();
    const query = { kind: "text_span", startAnchor: "미전 케퍼블리티", endAnchor: "브라우저스" } as const;
    const underlineGrounding = groundTextSpan({ stream: page, query });
    const highlightGrounding = groundTextSpan({ stream: page, query });
    expect(highlightGrounding).toEqual(underlineGrounding);
    expect(underlineGrounding.diagnostics).toMatchObject({
      startAnchorChunkCount: 2,
      endAnchorChunkCount: 1,
      spanPairCandidateCount: expect.any(Number),
      canonicalAnchorCount: expect.any(Number),
      dominatedPairCount: expect.any(Number),
    });
  });
});

function visionPage(): CanonicalTextStream {
  return createStream([
    "Particularly", "vision", "capability", "is", "crucial", "for", "modern", "web", "browsers", "today",
  ], {
    lineByIndex: ["l1", "l1", "l1", "l1", "l1", "l2", "l2", "l2", "l2", "l2"],
  });
}

function createStream(
  words: readonly string[],
  options: {
    lineByIndex?: readonly string[];
    paragraphByIndex?: readonly string[];
    sentenceByIndex?: readonly string[];
  } = {},
): CanonicalTextStream {
  const tokens: CanonicalTextToken[] = words.map((text, index) => {
    const lineId = options.lineByIndex?.[index] ?? "l1";
    const lineNumber = Number(lineId.replace(/\D/gu, "")) || 1;
    return {
      id: `token-${index}`,
      pageId: "page-1",
      text,
      normalizedText: text.toLocaleLowerCase(),
      readingOrder: index,
      paragraphId: options.paragraphByIndex?.[index] ?? "p1",
      sentenceId: options.sentenceByIndex?.[index] ?? "s1",
      lineId,
      sourceObjectId: `word-${index}`,
      bounds: { x: (index % 5) * 22, y: (lineNumber - 1) * 24, width: 20, height: 18 },
    };
  });
  return { pageId: "page-1", tokens };
}
