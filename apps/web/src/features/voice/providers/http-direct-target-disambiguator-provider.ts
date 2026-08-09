import {
  DirectAiProviderError,
  DirectTargetDisambiguationValidationError,
  parseDirectTargetDisambiguationInput,
  parseDirectTargetDisambiguationResult,
  type DirectTargetDisambiguationInput,
  type DirectTargetDisambiguationResult,
} from "../domain";
import type {
  DirectTargetDisambiguatorOptions,
  DirectTargetDisambiguatorProvider,
} from "./direct-target-disambiguator-provider";
import {
  postDirectAiRequest,
  type DirectAiFetch,
} from "./http-direct-ai-client";

export interface HttpDirectTargetDisambiguatorProviderOptions {
  endpoint?: string;
  fetch?: DirectAiFetch;
}

export class HttpDirectTargetDisambiguatorProvider
implements DirectTargetDisambiguatorProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: DirectAiFetch;

  public constructor(options: HttpDirectTargetDisambiguatorProviderOptions = {}) {
    this.endpoint = options.endpoint ?? "/api/voice/direct-command/disambiguate";
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public async disambiguate(
    input: DirectTargetDisambiguationInput,
    options: DirectTargetDisambiguatorOptions = {},
  ): Promise<DirectTargetDisambiguationResult> {
    const safeInput = parseDirectTargetDisambiguationInput(input);
    const value = await postDirectAiRequest(
      this.endpoint,
      safeInput,
      this.fetchImpl,
      options.signal,
    );
    try {
      return parseDirectTargetDisambiguationResult(
        value,
        safeInput.candidates.length,
      );
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (error instanceof DirectTargetDisambiguationValidationError || error instanceof Error) {
        throw new DirectAiProviderError(
          "PLANNER_INVALID_OUTPUT",
          "INVALID_OUTPUT",
          { cause: error },
        );
      }
      throw error;
    }
  }
}
