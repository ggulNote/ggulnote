import type { PageId } from "@ggulnote/editor-core";
import type { SpeechRefinementEvidence } from "./speech-refinement-types";

export type SpeechNormalizationMode = "command" | "target" | "math" | "dictation";
export type TermHypothesisSource =
  | "document_lexicon"
  | "deterministic_normalizer"
  | "asr_alternative";

export interface SpeechAlternative {
  text: string;
  confidence?: number;
}

export interface DocumentLexiconSourceReference {
  candidateId: string;
  sourceObjectId: string;
  source: "pdf" | "ggulnote";
}

export interface DocumentLexiconEntry {
  surface: string;
  normalized: string;
  pageId: PageId;
  kind: "word" | "phrase" | "term";
  readingOrder?: number;
  sourceReferences: readonly DocumentLexiconSourceReference[];
}

export type TargetGroundingSlotKind =
  | "quote"
  | "start_anchor"
  | "end_anchor"
  | "semantic_query"
  | "object_query"
  | "subrange_selector";

export interface TargetGroundingSlot {
  kind: TargetGroundingSlotKind;
  text: string;
}

export interface GroundingRetrievalEvidence {
  exact?: number;
  normalized?: number;
  fuzzy?: number;
  phonetic?: number;
  semantic?: number;
  asrAlternative?: number;
  history?: number;
  focus?: number;
}

export interface TargetTermCandidate {
  actualTerm: DocumentLexiconEntry;
  evidence: GroundingRetrievalEvidence;
  score: number;
}

export interface TermHypothesisCandidate {
  value: string;
  source: TermHypothesisSource;
  confidence?: number;
  sourceObjectIds?: readonly string[];
}

export interface TermHypothesis {
  rawSpan: string;
  candidates: readonly TermHypothesisCandidate[];
}

interface NumberHypothesisBase {
  raw: string;
  ambiguous: boolean;
}

export type NumberHypothesis =
  | (NumberHypothesisBase & { kind: "integer"; value: number })
  | (NumberHypothesisBase & { kind: "decimal"; value: number })
  | (NumberHypothesisBase & { kind: "percent"; value: number })
  | (NumberHypothesisBase & { kind: "sequence"; values: readonly number[] })
  | (NumberHypothesisBase & {
      kind: "power";
      base: number | string;
      exponent: number;
    });

export interface MathSpeechToken {
  kind: "number" | "variable" | "operator" | "power" | "parenthesis";
  raw: string;
  value: string;
}

export interface MathNormalizationResult {
  raw: string;
  status: "NORMALIZED" | "AMBIGUOUS" | "UNSUPPORTED";
  normalizedText?: string;
  tokens?: readonly MathSpeechToken[];
  confidence?: number;
}

export interface ContextualSpeechTerm {
  text: string;
  priority: number;
  source: "frozen_focus" | "frozen_page" | "document";
}

export interface SpeechNormalizationDiagnostics {
  speechNormalizationUsed: boolean;
  termHypothesisCount: number;
  numberHypothesisCount: number;
  mathNormalizationStatus?: MathNormalizationResult["status"];
  documentLexiconSize: number;
  contextTermCount: number;
  normalizationMs: number;
  targetSlotKind?: string;
  localTermUniverseSize?: number;
  exactHitCount?: number;
  normalizedHitCount?: number;
  fuzzyHitCount?: number;
  phoneticHitCount?: number;
  asrAlternativeHitCount?: number;
  semanticHitCount?: number;
  mergedCandidateCount?: number;
  errorCode?: string;
}

export interface SpeechGroundingEvidence {
  rawFinalTranscript: string;
  refinement?: SpeechRefinementEvidence;
  targetSlots?: readonly TargetGroundingSlot[];
  termHypotheses: readonly TermHypothesis[];
  numberHypotheses: readonly NumberHypothesis[];
  mathHypothesis?: MathNormalizationResult;
  contextualTerms: readonly ContextualSpeechTerm[];
  asrAlternatives: readonly SpeechAlternative[];
  diagnostics: SpeechNormalizationDiagnostics;
}
