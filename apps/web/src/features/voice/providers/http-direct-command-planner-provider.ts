import {
  DirectAiProviderError,
  DirectPlannerResultValidationError,
  parseDirectCommandPlannerInput,
  parseDirectPlannerDraftResult,
  type DirectCommandPlannerInput,
  type DirectPlannerDraftResult,
} from "../domain";
import type {
  DirectCommandPlannerOptions,
  DirectCommandPlannerProvider,
} from "./direct-command-planner-provider";
import {
  postDirectAiRequest,
  type DirectAiFetch,
} from "./http-direct-ai-client";

export interface HttpDirectCommandPlannerProviderOptions {
  endpoint?: string;
  fetch?: DirectAiFetch;
}

export class HttpDirectCommandPlannerProvider
implements DirectCommandPlannerProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: DirectAiFetch;

  public constructor(options: HttpDirectCommandPlannerProviderOptions = {}) {
    this.endpoint = options.endpoint ?? "/api/voice/direct-command/planner";
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public async plan(
    input: DirectCommandPlannerInput,
    options: DirectCommandPlannerOptions = {},
  ): Promise<DirectPlannerDraftResult> {
    const safeInput = parseDirectCommandPlannerInput(input);
    const value = await postDirectAiRequest(
      this.endpoint,
      safeInput,
      this.fetchImpl,
      options.signal,
    );
    try {
      const result = parseDirectPlannerDraftResult(value);
      if (
        result.turnId !== safeInput.turn.turnId
        || (
          result.status === "EXECUTABLE"
          && result.sceneRevision !== safeInput.frozenContext.sceneRevision
        )
      ) {
        throw new Error("Planner response authority mismatch.");
      }
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
