import type {
  SpeechRefinementInput,
  SpeechRefinementProviderResult,
} from "../domain";

export interface SpeechRefinerProviderOptions {
  signal?: AbortSignal;
}

export interface SpeechRefinerProvider {
  refine(
    input: SpeechRefinementInput,
    options?: SpeechRefinerProviderOptions,
  ): Promise<SpeechRefinementProviderResult>;
}
