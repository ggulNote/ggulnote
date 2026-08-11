import {
  DirectAiProviderError,
  MultimodalPlacementValidationError,
  parseMultimodalPlacementChoice,
  parseMultimodalPlacementRequest,
  type MultimodalPlacementChoice,
  type MultimodalPlacementRequest,
} from "../domain";
import { postDirectAiRequest, type DirectAiFetch } from "./http-direct-ai-client";
import type {
  MultimodalPlacementJudgeProvider,
  MultimodalPlacementJudgeProviderOptions,
} from "./multimodal-placement-judge-provider";

export interface HttpMultimodalPlacementJudgeProviderOptions {
  readonly endpoint?: string;
  readonly fetch?: DirectAiFetch;
}

export class HttpMultimodalPlacementJudgeProvider
implements MultimodalPlacementJudgeProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: DirectAiFetch;

  public constructor(options: HttpMultimodalPlacementJudgeProviderOptions = {}) {
    this.endpoint = options.endpoint ?? "/api/voice/direct-command/placement-judge";
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public async judge(
    request: MultimodalPlacementRequest,
    options: MultimodalPlacementJudgeProviderOptions = {},
  ): Promise<MultimodalPlacementChoice> {
    const safeRequest = parseMultimodalPlacementRequest(request);
    const value = await postDirectAiRequest(
      this.endpoint,
      safeRequest,
      this.fetchImpl,
      options.signal,
    );
    try {
      return parseMultimodalPlacementChoice(
        value,
        safeRequest.candidates.map((candidate) => candidate.alias),
      );
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (error instanceof MultimodalPlacementValidationError || error instanceof Error) {
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
