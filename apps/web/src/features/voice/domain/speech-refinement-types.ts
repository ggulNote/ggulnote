import type { DirectCommandName } from "./direct-command-types";

export const SPEECH_REFINEMENT_CORRECTION_KINDS = [
  "disfluency",
  "self_correction",
  "spacing",
  "command_cleanup",
] as const;

export type SpeechRefinementCorrectionKind =
  (typeof SPEECH_REFINEMENT_CORRECTION_KINDS)[number];

export interface SpeechRefinementInput {
  rawTranscript: string;
  language: string;
  allowedCommands: readonly DirectCommandName[];
}

export type SpeechRefinementProviderResult =
  | { status: "UNCHANGED" }
  | {
      status: "REFINED";
      refinedTranscript: string;
      corrections: readonly { kind: SpeechRefinementCorrectionKind }[];
    };

export interface SpeechRefinementEvidence {
  rawTranscript: string;
  refinedTranscript: string;
  changed: boolean;
  corrections: readonly { kind: SpeechRefinementCorrectionKind }[];
  providerCalled: boolean;
  result: "SKIPPED" | "UNCHANGED" | "REFINED" | "REJECTED" | "ERROR";
  latencyMs: number;
  errorCode?: string;
}
