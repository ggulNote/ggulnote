import {
  DirectAiProviderError,
  SpeechRefinementValidationError,
  isAbortError,
  parseSpeechRefinementProviderResult,
  type SpeechRefinementInput,
  type SpeechRefinementProviderResult,
} from "../domain";
import { parseDirectModelJsonObject } from "./direct-model-json";
import type { DirectTextModelTransport } from "./direct-text-model-transport";
import { buildSpeechRefinerModelRequest } from "./speech-refiner-prompt";
import type {
  SpeechRefinerProvider,
  SpeechRefinerProviderOptions,
} from "./speech-refiner-provider";

export class LlmSpeechRefinerProvider implements SpeechRefinerProvider {
  public constructor(private readonly transport: DirectTextModelTransport) {}

  public async refine(
    input: SpeechRefinementInput,
    options: SpeechRefinerProviderOptions = {},
  ): Promise<SpeechRefinementProviderResult> {
    throwIfAborted(options.signal);
    let rawOutput: string;
    try {
      rawOutput = await this.transport.generate(
        buildSpeechRefinerModelRequest(input),
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
      return parseSpeechRefinementProviderResult(
        parseDirectModelJsonObject(rawOutput),
      );
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (error instanceof SpeechRefinementValidationError || error instanceof Error) {
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
  if (signal?.aborted) throw new DirectAiProviderError("ABORTED", "ABORTED");
}
