import type { NoteDecision, NoteDecisionInput } from "../domain";

export interface NoteDecisionProviderOptions {
  readonly signal?: AbortSignal;
}
export interface NoteDecisionProvider {
  decide(
    input: NoteDecisionInput,
    options?: NoteDecisionProviderOptions,
  ): Promise<NoteDecision>;
}

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

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
