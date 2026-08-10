import {
  DirectAiProviderError,
  GroundedTargetRecoveryValidationError,
  parseGroundedTargetRecoveryInput,
  parseGroundedTargetRecoveryResult,
  type GroundedTargetRecoveryInput,
  type GroundedTargetRecoveryResult,
} from "../domain";
import { postDirectAiRequest, type DirectAiFetch } from "./http-direct-ai-client";
import type {
  GroundedTargetRecoveryProvider,
  GroundedTargetRecoveryProviderOptions,
} from "./grounded-target-recovery-provider";

export interface HttpGroundedTargetRecoveryProviderOptions {
  endpoint?: string;
  fetch?: DirectAiFetch;
}

export class HttpGroundedTargetRecoveryProvider
implements GroundedTargetRecoveryProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: DirectAiFetch;

  public constructor(options: HttpGroundedTargetRecoveryProviderOptions = {}) {
    this.endpoint = options.endpoint ?? "/api/voice/direct-command/recover";
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public async recover(
    input: GroundedTargetRecoveryInput,
    options: GroundedTargetRecoveryProviderOptions = {},
  ): Promise<GroundedTargetRecoveryResult> {
    const safeInput = parseGroundedTargetRecoveryInput(input);
    const value = await postDirectAiRequest(
      this.endpoint,
      safeInput,
      this.fetchImpl,
      options.signal,
    );
    try {
      return parseGroundedTargetRecoveryResult(value, safeInput);
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (error instanceof GroundedTargetRecoveryValidationError || error instanceof Error) {
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
