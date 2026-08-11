import {
  DirectAiProviderError,
  MultimodalPlacementValidationError,
  isAbortError,
  parseMultimodalPlacementChoice,
  parseMultimodalPlacementRequest,
  type MultimodalPlacementChoice,
  type MultimodalPlacementRequest,
} from "../domain";
import type { DirectMultimodalModelTransport } from "./direct-multimodal-model-transport";
import { parseDirectModelJsonObject } from "./direct-model-json";
import { buildMultimodalPlacementModelRequest } from "./multimodal-placement-judge-prompt";
import type {
  MultimodalPlacementJudgeProvider,
  MultimodalPlacementJudgeProviderOptions,
} from "./multimodal-placement-judge-provider";

export class LlmMultimodalPlacementJudgeProvider
implements MultimodalPlacementJudgeProvider {
  public constructor(private readonly transport: DirectMultimodalModelTransport) {}

  public async judge(
    request: MultimodalPlacementRequest,
    options: MultimodalPlacementJudgeProviderOptions = {},
  ): Promise<MultimodalPlacementChoice> {
    throwIfAborted(options.signal);
    const safeRequest = parseMultimodalPlacementRequest(request);
    let rawOutput: string;
    try {
      rawOutput = await this.transport.generate(
        buildMultimodalPlacementModelRequest(safeRequest),
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
      return parseMultimodalPlacementChoice(
        parseDirectModelJsonObject(rawOutput),
        safeRequest.candidates.map((candidate) => candidate.alias),
      );
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (error instanceof MultimodalPlacementValidationError || error instanceof Error) {
        logInvalidChoice(error);
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

function logInvalidChoice(error: Error): void {
  console.error("[direct-command-ai] Placement choice validation failure", {
    kind: error instanceof MultimodalPlacementValidationError
      ? "SCHEMA_VALIDATION"
      : "JSON_VALIDATION",
    ...(error instanceof MultimodalPlacementValidationError
      ? { path: error.path.slice(0, 200) }
      : {}),
    message: error.message.replace(/[\r\n]+/gu, " ").slice(0, 500),
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DirectAiProviderError("ABORTED", "ABORTED");
}
