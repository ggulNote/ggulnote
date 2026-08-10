import {
  DirectAiProviderError,
  SpeechRefinementValidationError,
  parseSpeechRefinementInput,
  parseSpeechRefinementProviderResult,
  type SpeechRefinementInput,
  type SpeechRefinementProviderResult,
} from "../domain";
import { postDirectAiRequest, type DirectAiFetch } from "./http-direct-ai-client";
import type {
  SpeechRefinerProvider,
  SpeechRefinerProviderOptions,
} from "./speech-refiner-provider";

export interface HttpSpeechRefinerProviderOptions {
  endpoint?: string;
  fetch?: DirectAiFetch;
}

export class HttpSpeechRefinerProvider implements SpeechRefinerProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: DirectAiFetch;

  public constructor(options: HttpSpeechRefinerProviderOptions = {}) {
    this.endpoint = options.endpoint ?? "/api/voice/direct-command/refine";
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public async refine(
    input: SpeechRefinementInput,
    options: SpeechRefinerProviderOptions = {},
  ): Promise<SpeechRefinementProviderResult> {
    const safeInput = parseSpeechRefinementInput(input);
    const value = await postDirectAiRequest(
      this.endpoint,
      safeInput,
      this.fetchImpl,
      options.signal,
    );
    try {
      return parseSpeechRefinementProviderResult(value);
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
