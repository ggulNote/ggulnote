import type {
  NoteDecision,
  NoteDecisionInput,
  NoteDisambiguationChoice,
  NoteDisambiguationInput,
} from "../domain";

export interface NoteDecisionProviderOptions {
  readonly signal?: AbortSignal;
}
export interface NoteDecisionProvider {
  decide(
    input: NoteDecisionInput,
    options?: NoteDecisionProviderOptions,
  ): Promise<NoteDecision>;
}

export interface NoteDisambiguationProvider {
  disambiguate(
    input: NoteDisambiguationInput,
    options?: NoteDecisionProviderOptions,
  ): Promise<NoteDisambiguationChoice>;
}

export type NoteDecisionCompositionProvider = NoteDecisionProvider
  & NoteDisambiguationProvider;

export class FakeNoteDecisionProvider implements NoteDecisionProvider {
  public callCount = 0;

  public constructor(
    private readonly result: NoteDecision | ((input: NoteDecisionInput) => NoteDecision),
  ) {}

  public decide(
    input: NoteDecisionInput,
    options: NoteDecisionProviderOptions = {},
  ): Promise<NoteDecision> {
    if (options.signal?.aborted) return Promise.reject(abortError());
    this.callCount += 1;
    return Promise.resolve(
      typeof this.result === "function" ? this.result(input) : this.result,
    );
  }
}

export class FakeNoteDecisionCompositionProvider
implements NoteDecisionCompositionProvider {
  public decisionCallCount = 0;
  public disambiguationCallCount = 0;

  public constructor(
    private readonly decision: NoteDecision,
    private readonly choice: NoteDisambiguationChoice = { status: "NONE" },
  ) {}

  public decide(
    _input: NoteDecisionInput,
    options: NoteDecisionProviderOptions = {},
  ): Promise<NoteDecision> {
    if (options.signal?.aborted) return Promise.reject(abortError());
    this.decisionCallCount += 1;
    return Promise.resolve(this.decision);
  }

  public disambiguate(
    _input: NoteDisambiguationInput,
    options: NoteDecisionProviderOptions = {},
  ): Promise<NoteDisambiguationChoice> {
    if (options.signal?.aborted) return Promise.reject(abortError());
    this.disambiguationCallCount += 1;
    return Promise.resolve(this.choice);
  }
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
