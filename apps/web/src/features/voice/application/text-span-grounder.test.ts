import { describe, expect, it } from "vitest";
import type { CanonicalTextStream, CanonicalTextToken } from "./canonical-text-stream";
import {
  buildSpanPairCandidates,
  groundTextSpan,
  normalizeTextSpanAnchorSlot,
  retrieveAnchorSpanCandidates,
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
    expect(phrase?.score).toBeGreaterThan(token?.score ?? 0);
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
