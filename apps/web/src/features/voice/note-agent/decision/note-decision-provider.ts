import type {
  NoteDecision,
  NoteDecisionInput,
  NoteDecisionWarmupInput,
} from "../domain";

export interface NoteDecisionProviderOptions {
  readonly signal?: AbortSignal;
  readonly onTelemetry?: (telemetry: {
    readonly openaiTtfbMs: number;
    readonly openaiBodyReadMs: number;
    readonly decisionJsonParseMs: number;
    readonly inputTokens?: number;
    readonly cachedInputTokens?: number;
    readonly cacheWriteInputTokens?: number;
    readonly outputTokens?: number;
  }) => void;
}
export interface NoteDecisionProvider {
  warmup?(
    input: NoteDecisionWarmupInput,
    options?: NoteDecisionProviderOptions,
  ): Promise<void>;
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
