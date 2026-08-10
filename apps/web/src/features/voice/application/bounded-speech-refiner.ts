import type {
  CompletedVoiceTurn,
  DirectCommandName,
  SpeechRefinementEvidence,
} from "../domain";
import type { SpeechRefinerProvider } from "../providers";

const REFINEMENT_SIGNAL =
  /(?:(?:^|\s)(?:어|음|그)(?=\s|$)|아니|다시|그러니까|\.\.\.)/u;
const REPETITION_SIGNAL = /(?:^|\s)(\S+)\s+\1(?=\s|$)/u;
const LATIN_TERM = /[A-Za-z][A-Za-z0-9'-]*/gu;

export interface BoundedSpeechRefinerInput {
  turn: CompletedVoiceTurn;
  allowedCommands: readonly DirectCommandName[];
}

export interface BoundedSpeechRefinerOptions {
  signal?: AbortSignal;
}

export interface BoundedSpeechRefinerPort {
  refine(
    input: BoundedSpeechRefinerInput,
    options?: BoundedSpeechRefinerOptions,
  ): Promise<SpeechRefinementEvidence>;
}

export class BoundedSpeechRefiner implements BoundedSpeechRefinerPort {
  public constructor(
    private readonly provider: SpeechRefinerProvider,
    private readonly now: () => number = () =>
      globalThis.performance?.now?.() ?? Date.now(),
  ) {}

  public async refine(
    input: BoundedSpeechRefinerInput,
    options: BoundedSpeechRefinerOptions = {},
  ): Promise<SpeechRefinementEvidence> {
    const raw = input.turn.rawTranscript;
    if (!shouldRefine(raw)) return evidence(raw, raw, false, "SKIPPED", 0);
    const startedAt = this.now();
    try {
      const result = await this.provider.refine({
        rawTranscript: raw,
        language: input.turn.language,
        allowedCommands: input.allowedCommands,
      }, options);
      const completedAt = this.now();
      if (result.status === "UNCHANGED") {
        return evidence(raw, raw, true, "UNCHANGED", completedAt - startedAt);
      }
      if (introducesLatinDocumentTerm(raw, result.refinedTranscript)) {
        return evidence(raw, raw, true, "REJECTED", completedAt - startedAt);
      }
      const refined = result.refinedTranscript.trim();
      if (refined.length === 0) {
        return evidence(raw, raw, true, "REJECTED", completedAt - startedAt);
      }
      return evidence(
        raw,
        refined,
        true,
        "REFINED",
        completedAt - startedAt,
        undefined,
        result.corrections,
      );
    } catch (error) {
      const completedAt = this.now();
      return evidence(
        raw,
        raw,
        true,
        "ERROR",
        completedAt - startedAt,
        error instanceof Error ? error.name : "SPEECH_REFINER_ERROR",
      );
    }
  }
}

function shouldRefine(raw: string): boolean {
  return raw.length >= 80
    || REFINEMENT_SIGNAL.test(raw)
    || REPETITION_SIGNAL.test(raw);
}

function introducesLatinDocumentTerm(raw: string, refined: string): boolean {
  const original = new Set(
    (raw.match(LATIN_TERM) ?? []).map((value) => value.toLowerCase()),
  );
  return (refined.match(LATIN_TERM) ?? []).some(
    (value) => !original.has(value.toLowerCase()),
  );
}

function evidence(
  rawTranscript: string,
  refinedTranscript: string,
  providerCalled: boolean,
  result: SpeechRefinementEvidence["result"],
  latencyMs: number,
  errorCode?: string,
  corrections: SpeechRefinementEvidence["corrections"] = [],
): SpeechRefinementEvidence {
  return Object.freeze({
    rawTranscript,
    refinedTranscript,
    changed: rawTranscript !== refinedTranscript,
    corrections: Object.freeze([...corrections]),
    providerCalled,
    result,
    latencyMs: Math.max(0, latencyMs),
    ...(errorCode === undefined ? {} : { errorCode }),
  });
}
