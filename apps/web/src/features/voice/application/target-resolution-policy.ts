import type {
  CandidateEvidence,
  TargetQuery,
  TargetResolutionPolicy,
} from "../domain";

export type TargetEvidenceWeights = Partial<
  Readonly<Record<keyof CandidateEvidence, number>>
>;

export interface TargetStrategyConfig {
  policy: TargetResolutionPolicy;
  weights: TargetEvidenceWeights;
}

export const TARGET_STRATEGY_CONFIG = {
  relative: {
    policy: { minResolvedScore: 0.5, minResolvedMargin: 0.12, maxAmbiguousCandidates: 4 },
    weights: {
      typeMatch: 0.2,
      temporalMatch: 0.35,
      structuralMatch: 0.15,
      focusMatch: 0.3,
    },
  },
  text_span: {
    policy: { minResolvedScore: 0.5, minResolvedMargin: 0.12, maxAmbiguousCandidates: 4 },
    weights: {
      typeMatch: 0.2,
      lexicalMatch: 0.25,
      fuzzyMatch: 0.4,
      structuralMatch: 0.15,
    },
  },
  semantic_unit: {
    policy: { minResolvedScore: 0.62, minResolvedMargin: 0.08, maxAmbiguousCandidates: 4 },
    weights: {
      typeMatch: 0.15,
      lexicalMatch: 0.1,
      fuzzyMatch: 0.08,
      semanticMatch: 0.55,
      structuralMatch: 0.07,
      focusMatch: 0.05,
    },
  },
  object: {
    policy: { minResolvedScore: 0.55, minResolvedMargin: 0.1, maxAmbiguousCandidates: 4 },
    weights: {
      typeMatch: 0.2,
      lexicalMatch: 0.15,
      fuzzyMatch: 0.1,
      semanticMatch: 0.35,
      temporalMatch: 0.1,
      structuralMatch: 0.05,
      focusMatch: 0.05,
    },
  },
  subrange: {
    policy: { minResolvedScore: 0.6, minResolvedMargin: 0.12, maxAmbiguousCandidates: 4 },
    weights: {},
  },
} as const satisfies Readonly<Record<TargetQuery["kind"], TargetStrategyConfig>>;
