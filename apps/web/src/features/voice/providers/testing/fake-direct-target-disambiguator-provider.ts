import {
  DirectAiProviderError,
  parseDirectTargetDisambiguationInput,
  parseDirectTargetDisambiguationResult,
  type DirectTargetDisambiguationInput,
  type DirectTargetDisambiguationResult,
} from "../../domain";
import type {
  DirectTargetDisambiguatorOptions,
  DirectTargetDisambiguatorProvider,
} from "../direct-target-disambiguator-provider";

export interface FakeDirectTargetDisambiguatorProviderOptions {
  result: DirectTargetDisambiguationResult;
  error?: unknown;
}

export interface FakeDirectTargetDisambiguatorCall {
  input: DirectTargetDisambiguationInput;
  signal?: AbortSignal;
}

export class FakeDirectTargetDisambiguatorProvider
implements DirectTargetDisambiguatorProvider {
  private result: DirectTargetDisambiguationResult;
  private injectedError: unknown;
  private hasInjectedError = false;
  private readonly recordedCalls: FakeDirectTargetDisambiguatorCall[] = [];

  public constructor(options: FakeDirectTargetDisambiguatorProviderOptions) {
    this.result = cloneResult(options.result);
    if (options.error !== undefined) {
      this.injectedError = options.error;
      this.hasInjectedError = true;
    }
  }

  public async disambiguate(
    input: DirectTargetDisambiguationInput,
    options: DirectTargetDisambiguatorOptions = {},
  ): Promise<DirectTargetDisambiguationResult> {
    const call: FakeDirectTargetDisambiguatorCall = {
      input: parseDirectTargetDisambiguationInput(input),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    this.recordedCalls.push(call);
    throwIfAborted(options.signal);
    await Promise.resolve();
    throwIfAborted(options.signal);
    if (this.hasInjectedError) throw this.injectedError;
    return parseDirectTargetDisambiguationResult(
      this.result,
      input.candidates.length,
    );
  }

  public get disambiguateCallCount(): number {
    return this.recordedCalls.length;
  }

  public get lastInput(): DirectTargetDisambiguationInput | undefined {
    const input = this.recordedCalls.at(-1)?.input;
    return input === undefined
      ? undefined
      : parseDirectTargetDisambiguationInput(input);
  }

  public get calls(): readonly FakeDirectTargetDisambiguatorCall[] {
    return this.recordedCalls.map((call) => ({
      input: parseDirectTargetDisambiguationInput(call.input),
      ...(call.signal === undefined ? {} : { signal: call.signal }),
    }));
  }

  public setResult(result: DirectTargetDisambiguationResult): void {
    this.result = cloneResult(result);
  }

  public injectError(error: unknown): void {
    this.injectedError = error;
    this.hasInjectedError = true;
  }

  public clearError(): void {
    this.injectedError = undefined;
    this.hasInjectedError = false;
  }
}

function cloneResult(
  result: DirectTargetDisambiguationResult,
): DirectTargetDisambiguationResult {
  return result.status === "NONE"
    ? { status: "NONE" }
    : { status: "SELECTED", candidateLabel: result.candidateLabel };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DirectAiProviderError("ABORTED", "ABORTED");
}
