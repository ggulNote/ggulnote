import {
  DirectAiProviderError,
  DirectPlannerResultValidationError,
  isAbortError,
  parseDirectPlannerResult,
  type DirectCommandPlannerInput,
  type DirectPlannerResult,
} from "../domain";
import type {
  DirectCommandPlannerOptions,
  DirectCommandPlannerProvider,
} from "./direct-command-planner-provider";
import { buildDirectCommandPlannerModelRequest } from "./direct-command-planner-prompt";
import { parseDirectModelJsonObject } from "./direct-model-json";
import type { DirectTextModelTransport } from "./direct-text-model-transport";

export interface LlmDirectCommandPlannerProviderOptions {
  transport: DirectTextModelTransport;
  planIdFactory?: () => string;
}

export class LlmDirectCommandPlannerProvider
implements DirectCommandPlannerProvider {
  private readonly planIdFactory: () => string;

  public constructor(private readonly options: LlmDirectCommandPlannerProviderOptions) {
    this.planIdFactory = options.planIdFactory ?? createPlanId;
  }

  public async plan(
    input: DirectCommandPlannerInput,
    options: DirectCommandPlannerOptions = {},
  ): Promise<DirectPlannerResult> {
    throwIfAborted(options.signal);
    const planId = this.planIdFactory();
    const request = buildDirectCommandPlannerModelRequest(input, planId);
    let rawOutput: string;
    try {
      rawOutput = await this.options.transport.generate(request, options);
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
      const result = parseDirectPlannerResult(parseDirectModelJsonObject(rawOutput));
      assertPlannerAuthority(result, input, planId);
      return result;
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (error instanceof DirectPlannerResultValidationError || error instanceof Error) {
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

function assertPlannerAuthority(
  result: DirectPlannerResult,
  input: DirectCommandPlannerInput,
  planId: string,
): void {
  if (result.turnId !== input.turn.turnId) {
    throw new Error("Planner output turnId does not match the request.");
  }
  if (
    result.status === "EXECUTABLE"
    && (
      result.planId !== planId
      || result.sceneRevision !== input.frozenContext.sceneRevision
    )
  ) {
    throw new Error("Planner output authority does not match the request.");
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DirectAiProviderError("ABORTED", "ABORTED");
}

function createPlanId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `direct-plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
