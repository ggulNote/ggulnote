import type {
  ContextualSpeechTerm,
  DocumentLexiconEntry,
  MathNormalizationResult,
  MathSpeechToken,
  NumberHypothesis,
  PageTargetCatalog,
  SpeechAlternative,
  SpeechGroundingEvidence,
  SpeechNormalizationMode,
  TermHypothesis,
  TermHypothesisCandidate,
} from "../domain";
import { normalizeGroundingText } from "./candidate-ranker";

const MAX_LEXICON_ENTRIES = 256;
const MAX_CONTEXT_TERMS = 30;
const MAX_TERM_CANDIDATES = 3;
const LATIN_TERM = /[A-Za-z][A-Za-z0-9]*(?:[-'][A-Za-z0-9]+)*/g;
const LATIN_ONLY = /^[A-Za-z][A-Za-z0-9]*(?:[-'][A-Za-z0-9]+)*$/;
const KOREAN_FRAGMENT = /[가-힣]+/g;
const KOREAN_DIGITS: Readonly<Record<string, number>> = {
  영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4,
  오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9,
};
const KOREAN_UNITS: Readonly<Record<string, number>> = {
  십: 10, 백: 100, 천: 1000, 만: 10000,
};
const SPEECH_STOPWORDS = new Set([
  "여기", "거기", "문장", "문단", "단어", "텍스트", "메모", "그래프",
  "수식", "하이라이트", "밑줄", "설명", "들어간", "만든", "방금", "아까",
]);

export interface TypedSpeechNormalizationInput {
  rawFinalTranscript: string;
  pageTargetCatalog: PageTargetCatalog;
  focusObjectId?: string;
  mode?: SpeechNormalizationMode;
  asrAlternatives?: readonly SpeechAlternative[];
}

export interface TypedSpeechNormalizerPort {
  normalize(input: TypedSpeechNormalizationInput): SpeechGroundingEvidence;
}

export interface TypedSpeechNormalizerOptions {
  now?: () => number;
  maxLexiconEntries?: number;
  maxContextTerms?: number;
}

export class TypedSpeechNormalizer implements TypedSpeechNormalizerPort {
  private readonly now: () => number;
  private readonly maxLexiconEntries: number;
  private readonly maxContextTerms: number;

  public constructor(options: TypedSpeechNormalizerOptions = {}) {
    this.now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.maxLexiconEntries = positiveInteger(
      options.maxLexiconEntries ?? MAX_LEXICON_ENTRIES,
      "maxLexiconEntries",
    );
    this.maxContextTerms = positiveInteger(
      options.maxContextTerms ?? MAX_CONTEXT_TERMS,
      "maxContextTerms",
    );
  }

  public normalize(input: TypedSpeechNormalizationInput): SpeechGroundingEvidence {
    const startedAt = this.now();
    const lexicon = buildDocumentLexicon(input.pageTargetCatalog, this.maxLexiconEntries);
    const termHypotheses = buildTermHypotheses(
      input.rawFinalTranscript,
      lexicon,
      input.asrAlternatives ?? [],
    );
    const numberHypotheses = normalizeSpokenNumbers(
      input.rawFinalTranscript,
      input.mode ?? "command",
    );
    const mathResult = normalizeSpokenMath(input.rawFinalTranscript);
    const contextualTerms = buildContextualSpeechTerms(
      lexicon,
      input.pageTargetCatalog,
      input.focusObjectId,
      this.maxContextTerms,
    );
    const completedAt = this.now();
    const mathHypothesis = mathResult.status === "UNSUPPORTED" ? undefined : mathResult;
    return freezeEvidence({
      rawFinalTranscript: input.rawFinalTranscript,
      termHypotheses,
      numberHypotheses,
      ...(mathHypothesis === undefined ? {} : { mathHypothesis }),
      contextualTerms,
      asrAlternatives: input.asrAlternatives ?? [],
      diagnostics: {
        speechNormalizationUsed: true,
        termHypothesisCount: termHypotheses.length,
        numberHypothesisCount: numberHypotheses.length,
        ...(mathHypothesis === undefined
          ? {}
          : { mathNormalizationStatus: mathHypothesis.status }),
        documentLexiconSize: lexicon.length,
        contextTermCount: contextualTerms.length,
        normalizationMs: Math.max(0, completedAt - startedAt),
      },
    });
  }
}

export function buildDocumentLexicon(
  catalog: PageTargetCatalog,
  maxEntries = MAX_LEXICON_ENTRIES,
): readonly DocumentLexiconEntry[] {
  const entries = new Map<string, MutableLexiconEntry>();
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
    const compact = candidate.text.normalize("NFKC").replace(/\s+/g, " ").trim();
    const surfaces: string[] = [...(compact.match(LATIN_TERM) ?? [])];
    if (eligibleCanvas && compact.length <= 80) surfaces.push(compact);
    const words = compact.split(/\s+/).filter(Boolean);
    if (
      words.length >= 2
      && words.length <= 4
      && words.every((word) => LATIN_ONLY.test(word))
    ) {
      surfaces.push(compact);
    }

    for (const surface of surfaces) {
      if (entries.size >= maxEntries && !entries.has(normalizeGroundingText(surface))) break;
      const normalized = normalizeGroundingText(surface);
      if (!normalized) continue;
      const reference = {
        candidateId: candidate.candidateId,
        sourceObjectId,
        source: candidate.source,
      } as const;
      const existing = entries.get(normalized);
      if (existing) {
        if (!existing.sourceReferences.some((item) =>
          item.candidateId === reference.candidateId
          && item.sourceObjectId === reference.sourceObjectId
        )) existing.sourceReferences.push(reference);
        continue;
      }
      entries.set(normalized, {
        surface,
        normalized,
        pageId: catalog.pageId,
        kind: candidate.type === "word"
          ? "word"
          : words.length >= 2 ? "phrase" : "term",
        sourceReferences: [reference],
      });
    }
    if (entries.size >= maxEntries) break;
  }
  return [...entries.values()].map((entry) => Object.freeze({
    ...entry,
    sourceReferences: Object.freeze([...entry.sourceReferences]),
  }));
}

export function normalizeSpokenNumbers(
  raw: string,
  _mode: SpeechNormalizationMode = "command",
): readonly NumberHypothesis[] {
  const value = raw.normalize("NFKC").trim();
  const power = value.match(/^(.+?)\s*의\s*(.+?)\s*승$/);
  if (power) {
    const base = parseSpokenInteger(power[1] ?? "");
    const exponent = parseSpokenInteger(power[2] ?? "");
    if (base !== undefined && exponent !== undefined) {
      return [{ kind: "power", raw, base, exponent, ambiguous: false }];
    }
  }
  const percent = value.match(/^(.+?)\s*퍼센트$/);
  if (percent) {
    const number = parseSpokenInteger(percent[1] ?? "");
    if (number !== undefined) {
      return [{ kind: "percent", raw, value: number, ambiguous: false }];
    }
  }
  const decimal = value.match(/^(.+?)\s*점\s*(.+)$/);
  if (decimal) {
    const integer = parseSpokenInteger(decimal[1] ?? "");
    const fraction = parseDigitSequence(decimal[2] ?? "");
    if (integer !== undefined && fraction !== undefined) {
      return [{
        kind: "decimal",
        raw,
        value: Number(`${integer}.${fraction}`),
        ambiguous: false,
      }];
    }
  }
  const sequenceParts = value.split(/\s+/);
  if (sequenceParts.length > 1) {
    const values = sequenceParts.map(parseSpokenInteger);
    if (values.every((item): item is number => item !== undefined)) {
      const joined = Number(values.join(""));
      return [
        { kind: "sequence", raw, values, ambiguous: true },
        { kind: "integer", raw, value: joined, ambiguous: true },
      ];
    }
  }
  const integer = parseSpokenInteger(value);
  return integer === undefined
    ? []
    : [{ kind: "integer", raw, value: integer, ambiguous: false }];
}

export function normalizeSpokenMath(raw: string): MathNormalizationResult {
  const source = raw.normalize("NFKC").trim();
  if (/^마이너스\s+.+\s+제곱$/.test(source)) {
    return { raw, status: "AMBIGUOUS" };
  }
  const prepared = source
    .replace(/(엑스|와이|제트|[xyz])(?:는|은)/gi, "$1 =")
    .replace(/([()=+\-*/])/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
  if (!looksLikeMath(prepared)) return { raw, status: "UNSUPPORTED" };

  const pieces: string[] = [];
  const tokens: MathSpeechToken[] = [];
  for (const word of prepared.split(" ")) {
    const variable = normalizeVariable(word);
    const number = parseSpokenInteger(word);
    const operator = normalizeOperator(word);
    if (variable !== undefined) {
      if (/^\d+(?:\.\d+)?$/.test(pieces.at(-1) ?? "")) {
        pieces[pieces.length - 1] = `${pieces.at(-1)}${variable}`;
      } else {
        pieces.push(variable);
      }
      tokens.push({ kind: "variable", raw: word, value: variable });
    } else if (number !== undefined) {
      pieces.push(String(number));
      tokens.push({ kind: "number", raw: word, value: String(number) });
    } else if (word === "제곱") {
      const previous = pieces.at(-1);
      if (!previous || isOperator(previous)) return { raw, status: "UNSUPPORTED" };
      pieces[pieces.length - 1] = `${previous}^2`;
      tokens.push({ kind: "power", raw: word, value: "2" });
    } else if (operator !== undefined) {
      pieces.push(operator);
      tokens.push({ kind: "operator", raw: word, value: operator });
    } else if (word === "열고" || word === "(") {
      pieces.push("(");
      tokens.push({ kind: "parenthesis", raw: word, value: "(" });
    } else if (word === "닫고" || word === ")") {
      pieces.push(")");
      tokens.push({ kind: "parenthesis", raw: word, value: ")" });
    } else {
      return { raw, status: "UNSUPPORTED" };
    }
  }
  return {
    raw,
    status: "NORMALIZED",
    normalizedText: formatMathPieces(pieces),
    tokens,
    confidence: 1,
  };
}

interface MutableLexiconEntry extends Omit<DocumentLexiconEntry, "sourceReferences"> {
  sourceReferences: DocumentLexiconEntry["sourceReferences"][number][];
}

function buildContextualSpeechTerms(
  lexicon: readonly DocumentLexiconEntry[],
  catalog: PageTargetCatalog,
  focusObjectId: string | undefined,
  maxTerms: number,
): readonly ContextualSpeechTerm[] {
  return lexicon
    .map((entry): ContextualSpeechTerm => {
      const focused = focusObjectId !== undefined
        && entry.sourceReferences.some((reference) => {
          const candidate = catalog.candidates.find(
            (item) => item.candidateId === reference.candidateId,
          );
          return candidate?.sceneObjectId === focusObjectId
            || reference.sourceObjectId === focusObjectId;
        });
      return {
        text: entry.surface,
        priority: focused ? 100 : 50,
        source: focused ? "frozen_focus" : "frozen_page",
      };
    })
    .sort((left, right) => right.priority - left.priority || left.text.localeCompare(right.text))
    .slice(0, maxTerms);
}

function buildTermHypotheses(
  raw: string,
  lexicon: readonly DocumentLexiconEntry[],
  alternatives: readonly SpeechAlternative[],
): readonly TermHypothesis[] {
  const hypotheses: TermHypothesis[] = [];
  for (const match of raw.matchAll(KOREAN_FRAGMENT)) {
    const rawSpan = match[0];
    if (SPEECH_STOPWORDS.has(rawSpan) || parseSpokenInteger(rawSpan) !== undefined) continue;
    const scored = lexicon
      .filter((entry) => /[A-Za-z]/.test(entry.surface))
      .map((entry) => ({ entry, score: phoneticSimilarity(rawSpan, entry.surface) }))
      .filter((item) => item.score >= 0.28)
      .sort((left, right) => right.score - left.score || left.entry.surface.localeCompare(right.entry.surface));
    const top = scored[0]?.score;
    if (top === undefined) continue;
    const candidates = scored
      .filter((item) => top - item.score <= 0.14)
      .slice(0, MAX_TERM_CANDIDATES)
      .map((item): TermHypothesisCandidate => ({
        value: item.entry.surface,
        source: "document_lexicon",
        confidence: roundConfidence(item.score),
        sourceObjectIds: [...new Set(
          item.entry.sourceReferences.map((reference) => reference.sourceObjectId),
        )],
      }));
    hypotheses.push({ rawSpan, candidates });
  }
  const asrCandidates = alternatives
    .filter((alternative) => alternative.text.trim() && alternative.text !== raw)
    .slice(0, MAX_TERM_CANDIDATES)
    .map((alternative): TermHypothesisCandidate => ({
      value: alternative.text,
      source: "asr_alternative",
      ...(alternative.confidence === undefined
        ? {}
        : { confidence: alternative.confidence }),
    }));
  if (asrCandidates.length > 0) hypotheses.push({ rawSpan: raw, candidates: asrCandidates });
  return hypotheses;
}

export function parseSpokenInteger(raw: string): number | undefined {
  const value = raw.trim();
  if (/^\d+$/.test(value)) return Number(value);
  if (!value || !/^[영공일이삼사오육칠팔구십백천만]+$/.test(value)) return undefined;
  if ([...value].every((char) => KOREAN_DIGITS[char] !== undefined)) {
    return Number([...value].map((char) => KOREAN_DIGITS[char]).join(""));
  }
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const char of value) {
    const nextDigit = KOREAN_DIGITS[char];
    if (nextDigit !== undefined) {
      digit = nextDigit;
      continue;
    }
    const unit = KOREAN_UNITS[char];
    if (unit === undefined) return undefined;
    if (unit === 10000) {
      total += (section + digit || 1) * unit;
      section = 0;
      digit = 0;
    } else {
      section += (digit || 1) * unit;
      digit = 0;
    }
  }
  return total + section + digit;
}

function parseDigitSequence(raw: string): string | undefined {
  const compact = raw.replace(/\s+/g, "");
  if (/^\d+$/.test(compact)) return compact;
  if (![...compact].every((char) => KOREAN_DIGITS[char] !== undefined)) return undefined;
  return [...compact].map((char) => KOREAN_DIGITS[char]).join("");
}

function phoneticSimilarity(korean: string, english: string): number {
  const koreanSkeleton = koreanConsonantSkeleton(korean);
  const englishSkeleton = latinConsonantSkeleton(english);
  const skeletonScore = Math.max(
    editSimilarity(koreanSkeleton, englishSkeleton),
    koreanSkeleton.startsWith("H")
      ? editSimilarity(koreanSkeleton.slice(1), englishSkeleton)
      : 0,
  );
  const surfaceScore = editSimilarity(romanizeHangul(korean), english.toLowerCase());
  return skeletonScore * 0.8 + surfaceScore * 0.2;
}

function latinConsonantSkeleton(value: string): string {
  return collapseSounds(value.toLowerCase().replace(/[^a-z]/g, "").split("").map((char) => {
    if ("bpfv".includes(char)) return "P";
    if ("dt".includes(char)) return "T";
    if ("gkcq".includes(char)) return "K";
    if ("rl".includes(char)) return "R";
    if ("szxcj".includes(char)) return "S";
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
  return value.replace(/(.)\1+/g, "$1");
}

function editSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index] ?? 0;
  }
  return 1 - (previous[right.length] ?? 0) / Math.max(left.length, right.length);
}

function normalizeVariable(value: string): string | undefined {
  const normalized = value.toLowerCase();
  if (normalized === "엑스" || normalized === "x") return "x";
  if (normalized === "와이" || normalized === "y") return "y";
  if (normalized === "제트" || normalized === "z") return "z";
  return undefined;
}

function normalizeOperator(value: string): string | undefined {
  const operators: Readonly<Record<string, string>> = {
    더하기: "+", "+": "+", 빼기: "-", "-": "-",
    곱하기: "*", "*": "*", 나누기: "/", "/": "/",
    같다: "=", "=": "=",
  };
  return operators[value];
}

function looksLikeMath(value: string): boolean {
  return /(?:엑스|와이|제트|\b[xyz]\b|제곱|더하기|빼기|곱하기|나누기|[=+*/()])/i.test(value);
}

function isOperator(value: string): boolean {
  return ["+", "-", "*", "/", "="].includes(value);
}

function formatMathPieces(pieces: readonly string[]): string {
  return pieces.join(" ")
    .replace(/\s+([)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function roundConfidence(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be positive.`);
  return value;
}

function freezeEvidence(value: SpeechGroundingEvidence): SpeechGroundingEvidence {
  for (const hypothesis of value.termHypotheses) {
    for (const candidate of hypothesis.candidates) Object.freeze(candidate);
    Object.freeze(hypothesis.candidates);
    Object.freeze(hypothesis);
  }
  for (const item of value.numberHypotheses) Object.freeze(item);
  for (const item of value.contextualTerms) Object.freeze(item);
  for (const item of value.asrAlternatives) Object.freeze(item);
  Object.freeze(value.termHypotheses);
  Object.freeze(value.numberHypotheses);
  Object.freeze(value.contextualTerms);
  Object.freeze(value.asrAlternatives);
  Object.freeze(value.mathHypothesis);
  Object.freeze(value.diagnostics);
  return Object.freeze(value);
}
