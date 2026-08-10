import {
  DirectAiProviderError,
  GroundedTargetRecoveryValidationError,
  isAbortError,
  parseGroundedTargetRecoveryResult,
  type GroundedTargetRecoveryInput,
  type GroundedTargetRecoveryResult,
} from "../domain";
import { parseDirectModelJsonObject } from "./direct-model-json";
import { buildGroundedTargetRecoveryModelRequest } from "./grounded-target-recovery-prompt";
import type {
  GroundedTargetRecoveryProvider,
  GroundedTargetRecoveryProviderOptions,
} from "./grounded-target-recovery-provider";
import type { DirectTextModelTransport } from "./direct-text-model-transport";

export class LlmGroundedTargetRecoveryProvider
implements GroundedTargetRecoveryProvider {
  public constructor(private readonly transport: DirectTextModelTransport) {}

  public async recover(
    input: GroundedTargetRecoveryInput,
    options: GroundedTargetRecoveryProviderOptions = {},
  ): Promise<GroundedTargetRecoveryResult> {
    throwIfAborted(options.signal);
    let rawOutput: string;
    try {
      rawOutput = await this.transport.generate(
        buildGroundedTargetRecoveryModelRequest(input),
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
      return parseGroundedTargetRecoveryResult(
        parseDirectModelJsonObject(rawOutput),
        input,
      );
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DirectAiProviderError("ABORTED", "ABORTED");
}
