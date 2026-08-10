import type {
  DocumentLexiconEntry,
  MathNormalizationResult,
  MathSpeechToken,
  NumberHypothesis,
  PageTargetCatalog,
  SpeechAlternative,
  SpeechGroundingEvidence,
  SpeechNormalizationMode,
  SpeechRefinementEvidence,
  TargetQuery,
} from "../domain";
import {
  buildFrozenPageTermIndex,
  retrieveTargetAwareGroundingEvidence,
} from "./target-aware-grounding-retrieval";

const MAX_CONTEXT_TERMS = 30;
const KOREAN_DIGITS: Readonly<Record<string, number>> = {
  영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4,
  오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9,
};
const KOREAN_UNITS: Readonly<Record<string, number>> = {
  십: 10, 백: 100, 천: 1000, 만: 10000,
};

export interface TypedSpeechNormalizationInput {
  rawFinalTranscript: string;
  targetQuery: TargetQuery;
  pageTargetCatalog: PageTargetCatalog;
  focusObjectId?: string;
  mode?: SpeechNormalizationMode;
  asrAlternatives?: readonly SpeechAlternative[];
  refinement?: SpeechRefinementEvidence;
}

export interface TypedSpeechNormalizerPort {
  normalize(input: TypedSpeechNormalizationInput): SpeechGroundingEvidence;
}

export interface TypedSpeechNormalizerOptions {
  now?: () => number;
  maxContextTerms?: number;
}

export class TypedSpeechNormalizer implements TypedSpeechNormalizerPort {
  private readonly now: () => number;
  private readonly maxContextTerms: number;

  public constructor(options: TypedSpeechNormalizerOptions = {}) {
    this.now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.maxContextTerms = positiveInteger(
      options.maxContextTerms ?? MAX_CONTEXT_TERMS,
      "maxContextTerms",
    );
  }

  public normalize(input: TypedSpeechNormalizationInput): SpeechGroundingEvidence {
    const startedAt = this.now();
    const retrieval = retrieveTargetAwareGroundingEvidence({
      catalog: input.pageTargetCatalog,
      query: input.targetQuery,
      ...(input.focusObjectId === undefined ? {} : { focusObjectId: input.focusObjectId }),
      asrAlternatives: input.asrAlternatives ?? [],
      maxContextTerms: this.maxContextTerms,
    });
    const numberHypotheses = normalizeSpokenNumbers(
      input.rawFinalTranscript,
      input.mode ?? "command",
    );
    const mathResult = normalizeSpokenMath(input.rawFinalTranscript);
    const completedAt = this.now();
    const mathHypothesis = mathResult.status === "UNSUPPORTED" ? undefined : mathResult;
    return freezeEvidence({
      rawFinalTranscript: input.rawFinalTranscript,
      ...(input.refinement === undefined ? {} : { refinement: input.refinement }),
      targetSlots: retrieval.slots,
      termHypotheses: retrieval.termHypotheses,
      numberHypotheses,
      ...(mathHypothesis === undefined ? {} : { mathHypothesis }),
      contextualTerms: retrieval.contextualTerms,
      asrAlternatives: input.asrAlternatives ?? [],
      diagnostics: {
        speechNormalizationUsed: true,
        termHypothesisCount: retrieval.termHypotheses.length,
        numberHypothesisCount: numberHypotheses.length,
        ...(mathHypothesis === undefined
          ? {}
          : { mathNormalizationStatus: mathHypothesis.status }),
        documentLexiconSize: retrieval.index.length,
        contextTermCount: retrieval.contextualTerms.length,
        normalizationMs: Math.max(0, completedAt - startedAt),
        ...retrieval.diagnostics,
      },
    });
  }
}

export function buildDocumentLexicon(
  catalog: PageTargetCatalog,
  _legacyMaxEntries?: number,
): readonly DocumentLexiconEntry[] {
  return buildFrozenPageTermIndex(catalog);
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
  for (const item of value.targetSlots ?? []) Object.freeze(item);
  Object.freeze(value.termHypotheses);
  Object.freeze(value.numberHypotheses);
  Object.freeze(value.contextualTerms);
  Object.freeze(value.asrAlternatives);
  Object.freeze(value.targetSlots);
  Object.freeze(value.refinement?.corrections);
  Object.freeze(value.refinement);
  Object.freeze(value.mathHypothesis);
  Object.freeze(value.diagnostics);
  return Object.freeze(value);
}
