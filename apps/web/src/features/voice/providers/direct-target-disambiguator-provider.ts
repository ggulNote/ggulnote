import type {
  DirectTargetDisambiguationInput,
  DirectTargetDisambiguationResult,
} from "../domain";

export interface DirectTargetDisambiguatorOptions {
  signal?: AbortSignal;
}

export interface DirectTargetDisambiguatorProvider {
  disambiguate(
    input: DirectTargetDisambiguationInput,
    options?: DirectTargetDisambiguatorOptions,
  ): Promise<DirectTargetDisambiguationResult>;
}
