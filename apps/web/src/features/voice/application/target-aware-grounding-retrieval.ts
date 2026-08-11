import type {
  ContextualSpeechTerm,
  DocumentLexiconEntry,
  GroundingRetrievalEvidence,
  PageTargetCatalog,
  SpeechAlternative,
  TargetGroundingSlot,
  TargetQuery,
  TargetTermCandidate,
  TermHypothesis,
  TermHypothesisCandidate,
} from "../domain";
import {
  compactGroundingText,
  fuzzyTextSimilarity,
  normalizeGroundingText,
} from "./candidate-ranker";

const MAX_TERM_CANDIDATES = 3;
const MAX_CONTEXT_TERMS = 30;
const TERM_PATTERN = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;
const LATIN_TERM = /[A-Za-z]/u;
const KOREAN_FRAGMENT = /[가-힣]+/gu;
const TARGET_STOPWORDS = new Set([
  "해", "줘", "해주세요", "해줘", "하고", "그", "이", "저", "것",
  "하이라이트", "밑줄", "삭제", "수정", "변경", "바꿔", "문장", "문단",
  "단어", "텍스트", "메모", "표", "그래프", "수식", "도형",
]);

export const TARGET_RETRIEVAL_PROFILES = {
  text_span: { exact: 1, normalized: 0.98, fuzzy: 0.55, phonetic: 0.94, asrAlternative: 0.85, minScore: 0.4 },
  semantic_unit: { exact: 0.78, normalized: 0.75, fuzzy: 0.42, phonetic: 0.38, asrAlternative: 0.55, minScore: 0.42 },
  object: { exact: 0.82, normalized: 0.8, fuzzy: 0.45, phonetic: 0.42, asrAlternative: 0.58, minScore: 0.42 },
  relative: { exact: 0, normalized: 0, fuzzy: 0, phonetic: 0, asrAlternative: 0, minScore: 1 },
  subrange: { exact: 0.9, normalized: 0.88, fuzzy: 0.5, phonetic: 0.62, asrAlternative: 0.65, minScore: 0.42 },
} as const;

export interface TargetAwareGroundingRetrievalInput {
  catalog: PageTargetCatalog;
  query: TargetQuery;
  focusObjectId?: string;
  asrAlternatives?: readonly SpeechAlternative[];
  maxCandidatesPerSlot?: number;
  maxContextTerms?: number;
}

export interface TargetAwareGroundingRetrievalResult {
  index: readonly DocumentLexiconEntry[];
  slots: readonly TargetGroundingSlot[];
  candidatesBySlot: readonly { slot: TargetGroundingSlot; candidates: readonly TargetTermCandidate[] }[];
  termHypotheses: readonly TermHypothesis[];
  contextualTerms: readonly ContextualSpeechTerm[];
  diagnostics: {
    targetSlotKind: TargetQuery["kind"];
    localTermUniverseSize: number;
    exactHitCount: number;
    normalizedHitCount: number;
    fuzzyHitCount: number;
    phoneticHitCount: number;
    asrAlternativeHitCount: number;
    semanticHitCount: number;
    mergedCandidateCount: number;
  };
}

export function buildFrozenPageTermIndex(catalog: PageTargetCatalog): readonly DocumentLexiconEntry[] {
  const entries = new Map<string, MutableTerm>();
  for (const candidate of catalog.candidates) {
    if (candidate.pageId !== catalog.pageId || !candidate.text) continue;
    const eligiblePdf = candidate.source === "pdf"
      && ["word", "line", "sentence", "paragraph"].includes(candidate.type);
    const eligibleCanvas = candidate.source === "ggulnote" && candidate.type === "text";
    if (!eligiblePdf && !eligibleCanvas) continue;
    const sourceObjectId = candidate.sourceObjectId
      ?? candidate.semanticObjectId
      ?? candidate.sceneObjectId
      ?? candidate.candidateId;
    const compact = candidate.text.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const surfaces: string[] = [...(compact.match(TERM_PATTERN) ?? [])];
    if (eligibleCanvas && compact.length <= 120) surfaces.push(compact);
    if (eligiblePdf && candidate.type !== "word" && compact.length <= 120
      && compact.split(/\s+/u).length <= 6) surfaces.push(compact);
    for (const surface of surfaces) {
      const normalized = normalizeGroundingText(surface);
      if (!normalized) continue;
      const reference = { candidateId: candidate.candidateId, sourceObjectId, source: candidate.source } as const;
      const existing = entries.get(normalized);
      if (existing !== undefined) {
        if (!existing.sourceReferences.some((item) => item.candidateId === reference.candidateId
          && item.sourceObjectId === reference.sourceObjectId)) existing.sourceReferences.push(reference);
        if (candidate.readingOrder !== undefined
          && (existing.readingOrder === undefined || candidate.readingOrder < existing.readingOrder)) {
          existing.readingOrder = candidate.readingOrder;
        }
        continue;
      }
      entries.set(normalized, {
        surface,
        normalized,
        pageId: catalog.pageId,
        kind: candidate.type === "word" ? "word" : surface.includes(" ") ? "phrase" : "term",
        ...(candidate.readingOrder === undefined ? {} : { readingOrder: candidate.readingOrder }),
        sourceReferences: [reference],
      });
    }
  }
  return [...entries.values()].map((entry) => Object.freeze({
    ...entry,
    sourceReferences: Object.freeze([...entry.sourceReferences]),
  }));
}

export function extractTargetGroundingSlots(query: TargetQuery): readonly TargetGroundingSlot[] {
  switch (query.kind) {
    case "text_span":
      if (query.quote !== undefined) return slot("quote", query.quote);
      return [...slot("start_anchor", query.startAnchor ?? ""), ...slot("end_anchor", query.endAnchor ?? "")];
    case "semantic_unit": return slot("semantic_query", query.query ?? "");
    case "object": return slot("object_query", query.query ?? "");
    case "relative": return [];
    case "subrange": return [...extractTargetGroundingSlots(query.parent), ...slot("subrange_selector", query.query)];
  }
}

export function retrieveTargetAwareGroundingEvidence(
  input: TargetAwareGroundingRetrievalInput,
): TargetAwareGroundingRetrievalResult {
  const index = buildFrozenPageTermIndex(input.catalog);
  const slots = extractTargetGroundingSlots(input.query);
  const profile = TARGET_RETRIEVAL_PROFILES[input.query.kind];
  const candidatesBySlot = slots.map((targetSlot) => ({
    slot: targetSlot,
    candidates: retrieveSlot(targetSlot, index, input.asrAlternatives ?? [], profile),
  }));
  const maxCandidates = input.maxCandidatesPerSlot ?? MAX_TERM_CANDIDATES;
  const termHypotheses = candidatesBySlot.flatMap(({ slot: targetSlot, candidates }) => {
    const bounded = candidates.slice(0, maxCandidates);
    if (bounded.length === 0) return [];
    return [{
      rawSpan: targetSlot.text,
      candidates: bounded.map((candidate): TermHypothesisCandidate => ({
        value: candidate.actualTerm.surface,
        source: "document_lexicon",
        confidence: round(candidate.score),
        sourceObjectIds: [...new Set(candidate.actualTerm.sourceReferences.map((reference) => reference.sourceObjectId))],
      })),
    }];
  });
  const contextualTerms = buildRelevantContextTerms(
    candidatesBySlot.flatMap((item) => item.candidates),
    input.catalog,
    input.focusObjectId,
    input.maxContextTerms ?? MAX_CONTEXT_TERMS,
  );
  const merged = dedupeCandidates(candidatesBySlot.flatMap((item) => item.candidates));
  return {
    index,
    slots,
    candidatesBySlot,
    termHypotheses,
    contextualTerms,
    diagnostics: {
      targetSlotKind: input.query.kind,
      localTermUniverseSize: index.length,
      exactHitCount: countEvidence(merged, "exact"),
      normalizedHitCount: countEvidence(merged, "normalized"),
      fuzzyHitCount: countEvidence(merged, "fuzzy"),
      phoneticHitCount: countEvidence(merged, "phonetic"),
      asrAlternativeHitCount: countEvidence(merged, "asrAlternative"),
      semanticHitCount: countEvidence(merged, "semantic"),
      mergedCandidateCount: merged.length,
    },
  };
}

export function phoneticSimilarity(korean: string, english: string): number {
  if (!/[가-힣]/u.test(korean) || !LATIN_TERM.test(english)) return 0;
  const koreanSkeleton = koreanConsonantSkeleton(korean);
  let best = 0;
  for (const variant of englishMorphologyVariants(english)) {
    const englishSkeleton = latinPhoneticSkeleton(variant);
    const skeleton = Math.max(
      editSimilarity(koreanSkeleton, englishSkeleton),
      koreanSkeleton.startsWith("H") ? editSimilarity(koreanSkeleton.slice(1), englishSkeleton) : 0,
    );
    best = Math.max(
      best,
      skeleton * 0.75 + editSimilarity(romanizeHangul(korean), variant.toLowerCase()) * 0.25,
    );
  }
  const morphology = phoneticMorphologyCompatibility(korean, english);
  return morphology === undefined
    ? best
    : morphology === 1 ? best * 0.9 + 0.1 : best * 0.5;
}

export function phoneticMorphologyCompatibility(
  korean: string,
  english: string,
): 0 | 1 | undefined {
  const compact = english.toLowerCase().replace(/[^a-z]/gu, "");
  if (/ing$/u.test(compact)) return /잉$/u.test(korean) ? 1 : 0;
  if (/[스즈]$/u.test(korean)) {
    return /(?:[sxz]|sh|ch)$/u.test(compact) ? 1 : undefined;
  }
  if (/잉$/u.test(korean)) return 0;
  return undefined;
}

interface MutableTerm extends Omit<DocumentLexiconEntry, "sourceReferences"> {
  sourceReferences: DocumentLexiconEntry["sourceReferences"][number][];
}
type RetrievalProfile = (typeof TARGET_RETRIEVAL_PROFILES)[keyof typeof TARGET_RETRIEVAL_PROFILES];

function slot(kind: TargetGroundingSlot["kind"], raw: string): readonly TargetGroundingSlot[] {
  const text = normalizeSlotBoundary(kind, raw);
  return text.length === 0 ? [] : [{ kind, text }];
}

function normalizeSlotBoundary(kind: TargetGroundingSlot["kind"], raw: string): string {
  let value = raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (kind === "start_anchor") value = value.replace(/(?:에서)?부터\s*$/u, "").trim();
  if (kind === "end_anchor") value = value.replace(/까지(?:의)?\s*$/u, "").trim();
  return value;
}

function retrieveSlot(
  targetSlot: TargetGroundingSlot,
  index: readonly DocumentLexiconEntry[],
  alternatives: readonly SpeechAlternative[],
  profile: RetrievalProfile,
): readonly TargetTermCandidate[] {
  const searchTexts = targetSearchTexts(targetSlot.text);
  const alternativeTexts = alternatives.flatMap((alternative) => [
    alternative.text,
    ...(alternative.text.match(TERM_PATTERN) ?? []),
  ]);
  return index.flatMap((actualTerm): TargetTermCandidate[] => {
    const evidence: GroundingRetrievalEvidence = {};
    for (const searchText of searchTexts) {
      const compactSearch = compactGroundingText(normalizeGroundingText(searchText));
      const compactTerm = compactGroundingText(actualTerm.normalized);
      if (searchText === actualTerm.surface) evidence.exact = 1;
      if (compactSearch.length > 0 && compactSearch === compactTerm) evidence.normalized = 1;
      else if (targetSlot.kind !== "start_anchor" && targetSlot.kind !== "end_anchor"
        && compactSearch.includes(compactTerm)) evidence.normalized = Math.max(evidence.normalized ?? 0, 0.86);
      const fuzzy = fuzzyTextSimilarity(searchText, actualTerm.surface);
      if (fuzzy >= 0.3) evidence.fuzzy = Math.max(evidence.fuzzy ?? 0, fuzzy);
      const phonetic = phoneticSimilarity(searchText, actualTerm.surface);
      if (phonetic >= 0.36) evidence.phonetic = Math.max(evidence.phonetic ?? 0, phonetic);
    }
    for (const alternative of alternativeTexts) {
      const score = fuzzyTextSimilarity(alternative, actualTerm.surface);
      if (normalizeGroundingText(alternative) === actualTerm.normalized || score >= 0.7) {
        evidence.asrAlternative = Math.max(evidence.asrAlternative ?? 0, score);
      }
    }
    const score = Math.max(
      (evidence.exact ?? 0) * profile.exact,
      (evidence.normalized ?? 0) * profile.normalized,
      (evidence.fuzzy ?? 0) * profile.fuzzy,
      (evidence.phonetic ?? 0) * profile.phonetic,
      (evidence.asrAlternative ?? 0) * profile.asrAlternative,
    );
    return score >= profile.minScore ? [{ actualTerm, evidence, score }] : [];
  }).sort((left, right) => right.score - left.score
    || (left.actualTerm.readingOrder ?? Number.MAX_SAFE_INTEGER)
      - (right.actualTerm.readingOrder ?? Number.MAX_SAFE_INTEGER)
    || left.actualTerm.surface.localeCompare(right.actualTerm.surface));
}

function targetSearchTexts(value: string): readonly string[] {
  const result = new Set<string>();
  if (value.trim()) result.add(value.trim());
  for (const fragment of value.match(KOREAN_FRAGMENT) ?? []) {
    if (fragment.length <= 1 || TARGET_STOPWORDS.has(fragment)) continue;
    result.add(fragment);
  }
  return [...result];
}

function buildRelevantContextTerms(
  candidates: readonly TargetTermCandidate[],
  catalog: PageTargetCatalog,
  focusObjectId: string | undefined,
  maxTerms: number,
): readonly ContextualSpeechTerm[] {
  const catalogById = new Map(catalog.candidates.map((item) => [item.candidateId, item]));
  return dedupeCandidates(candidates).map((candidate) => {
    const focused = focusObjectId !== undefined && candidate.actualTerm.sourceReferences.some((reference) => {
      const pageCandidate = catalogById.get(reference.candidateId);
      return reference.sourceObjectId === focusObjectId || pageCandidate?.sceneObjectId === focusObjectId;
    });
    return {
      candidate,
      contextual: {
        text: candidate.actualTerm.surface,
        priority: Math.round(candidate.score * 100) + (focused ? 100 : 0),
        source: focused ? "frozen_focus" as const : "frozen_page" as const,
      },
    };
  }).sort((left, right) => right.contextual.priority - left.contextual.priority
    || right.candidate.score - left.candidate.score
    || left.contextual.text.localeCompare(right.contextual.text))
    .slice(0, maxTerms)
    .map((item) => item.contextual);
}

function dedupeCandidates(candidates: readonly TargetTermCandidate[]): readonly TargetTermCandidate[] {
  const result = new Map<string, TargetTermCandidate>();
  for (const candidate of candidates) {
    const existing = result.get(candidate.actualTerm.normalized);
    if (existing === undefined) result.set(candidate.actualTerm.normalized, candidate);
    else result.set(candidate.actualTerm.normalized, {
      actualTerm: candidate.actualTerm,
      score: Math.max(existing.score, candidate.score),
      evidence: mergeEvidence(existing.evidence, candidate.evidence),
    });
  }
  return [...result.values()];
}

function mergeEvidence(
  left: GroundingRetrievalEvidence,
  right: GroundingRetrievalEvidence,
): GroundingRetrievalEvidence {
  const result: GroundingRetrievalEvidence = { ...left };
  for (const key of Object.keys(right) as (keyof GroundingRetrievalEvidence)[]) {
    result[key] = Math.max(result[key] ?? 0, right[key] ?? 0);
  }
  return result;
}

function countEvidence(
  candidates: readonly TargetTermCandidate[],
  key: keyof GroundingRetrievalEvidence,
): number {
  return candidates.filter((candidate) => (candidate.evidence[key] ?? 0) > 0).length;
}

function englishMorphologyVariants(value: string): readonly string[] {
  const compact = value.toLowerCase().replace(/[^a-z]/gu, "");
  const variants = new Set([compact]);
  if (compact.endsWith("ies") && compact.length > 4) variants.add(`${compact.slice(0, -3)}y`);
  if (compact.endsWith("ing") && compact.length > 5) {
    variants.add(compact.slice(0, -3));
    variants.add(`${compact.slice(0, -3)}e`);
  }
  if (compact.endsWith("ed") && compact.length > 4) {
    variants.add(compact.slice(0, -2));
    variants.add(compact.slice(0, -1));
  }
  if (compact.endsWith("es") && compact.length > 4) variants.add(compact.slice(0, -2));
  if (compact.endsWith("s") && compact.length > 3) variants.add(compact.slice(0, -1));
  return [...variants].filter(Boolean);
}

function latinPhoneticSkeleton(value: string): string {
  const prepared = value.toLowerCase()
    .replace(/tch/gu, "C")
    .replace(/ch|sh/gu, "C")
    .replace(/dge|ge(?=$|s)/gu, "J")
    .replace(/ph/gu, "F")
    .replace(/th/gu, "T")
    .replace(/ng/gu, "N")
    .replace(/qu|ck/gu, "K")
    .replace(/x/gu, "KS");
  return collapseSounds([...prepared].map((char) => {
    if (char === "C" || char === "J") return "S";
    if (char === "F") return "P";
    if (char === "T") return "T";
    if (char === "K") return "K";
    if ("bpfv".includes(char)) return "P";
    if ("dt".includes(char)) return "T";
    if ("gkcq".includes(char)) return "K";
    if ("rl".includes(char)) return "R";
    if ("szcj".includes(char)) return "S";
    if (char === "m") return "M";
    if (char === "n") return "N";
    if (char === "h") return "H";
    return "";
  }).join(""));
}

function koreanConsonantSkeleton(value: string): string {
  const initials = ["K", "K", "N", "T", "T", "R", "M", "P", "P", "S", "S", "", "S", "S", "S", "K", "T", "P", "H"];
  const finals = ["", "K", "K", "K", "N", "N", "N", "T", "R", "K", "M", "P", "R", "R", "P", "R", "M", "P", "P", "S", "S", "NG", "S", "K", "T", "P", "H"];
  let result = "";
  for (const char of value) {
    const code = char.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) continue;
    result += initials[Math.floor(code / 588)] ?? "";
    result += finals[code % 28] ?? "";
  }
  return collapseSounds(result);
}

function romanizeHangul(value: string): string {
  const initials = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
  const vowels = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
  const finals = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "p", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "k", "t", "p", "h"];
  let result = "";
  for (const char of value) {
    const code = char.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) continue;
    result += initials[Math.floor(code / 588)] ?? "";
    result += vowels[Math.floor((code % 588) / 28)] ?? "";
    result += finals[code % 28] ?? "";
  }
  return result;
}

function collapseSounds(value: string): string {
  return value.replace(/(.)\1+/gu, "$1");
}

function editSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current: number[] = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index] ?? 0;
    }
  }
  return 1 - (previous[right.length] ?? 0) / Math.max(left.length, right.length);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
