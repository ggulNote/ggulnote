import {
  DirectAiProviderError,
  DirectTargetDisambiguationValidationError,
  isAbortError,
  parseDirectTargetDisambiguationResult,
  type DirectTargetDisambiguationInput,
  type DirectTargetDisambiguationResult,
} from "../domain";
import type {
  DirectTargetDisambiguatorOptions,
  DirectTargetDisambiguatorProvider,
} from "./direct-target-disambiguator-provider";
import { parseDirectModelJsonObject } from "./direct-model-json";
import { buildDirectTargetDisambiguatorModelRequest } from "./direct-target-disambiguator-prompt";
import type { DirectTextModelTransport } from "./direct-text-model-transport";

export class LlmDirectTargetDisambiguatorProvider
implements DirectTargetDisambiguatorProvider {
  public constructor(private readonly transport: DirectTextModelTransport) {}

  public async disambiguate(
    input: DirectTargetDisambiguationInput,
    options: DirectTargetDisambiguatorOptions = {},
  ): Promise<DirectTargetDisambiguationResult> {
    throwIfAborted(options.signal);
    let rawOutput: string;
    try {
      rawOutput = await this.transport.generate(
        buildDirectTargetDisambiguatorModelRequest(input),
        options,
      );
      throwIfAborted(options.signal);
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (isAbortError(error) || options.signal?.aborted) {
        throw new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
      }
      throw new DirectAiProviderError(
        "PLANNER_UNAVAILABLE",
        "NETWORK_FAILURE",
        { cause: error },
      );
    }

    try {
      return parseDirectTargetDisambiguationResult(
        parseDirectModelJsonObject(rawOutput),
        input.candidates.length,
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DirectAiProviderError("ABORTED", "ABORTED");
}
