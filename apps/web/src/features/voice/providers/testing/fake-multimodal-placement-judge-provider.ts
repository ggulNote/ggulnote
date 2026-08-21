import {
  DirectAiProviderError,
  parseMultimodalPlacementChoice,
  parseMultimodalPlacementRequest,
  type MultimodalPlacementChoice,
  type MultimodalPlacementRequest,
} from "../../domain";
import type {
  MultimodalPlacementJudgeProvider,
  MultimodalPlacementJudgeProviderOptions,
} from "../multimodal-placement-judge-provider";

export type FakeMultimodalPlacementJudgeResponse =
  | MultimodalPlacementChoice
  | Error
  | ((request: MultimodalPlacementRequest) => MultimodalPlacementChoice | Promise<MultimodalPlacementChoice>);

export class FakeMultimodalPlacementJudgeProvider
implements MultimodalPlacementJudgeProvider {
  public readonly requests: MultimodalPlacementRequest[] = [];
  public callCount = 0;
  private readonly responses: FakeMultimodalPlacementJudgeResponse[];

  public constructor(
    responses: readonly FakeMultimodalPlacementJudgeResponse[] = [],
  ) {
    this.responses = [...responses];
  }

  public async judge(
    request: MultimodalPlacementRequest,
    options: MultimodalPlacementJudgeProviderOptions = {},
  ): Promise<MultimodalPlacementChoice> {
    if (options.signal?.aborted) {
      throw new DirectAiProviderError("ABORTED", "ABORTED");
    }
    const safeRequest = parseMultimodalPlacementRequest(request);
    this.callCount += 1;
    this.requests.push(safeRequest);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new DirectAiProviderError("PLANNER_UNAVAILABLE", "MISSING_CONFIGURATION");
    }
    if (response instanceof Error) throw response;
    const choice = typeof response === "function"
      ? await response(safeRequest)
      : response;
    if (options.signal?.aborted) {
      throw new DirectAiProviderError("ABORTED", "ABORTED");
    }
    return parseMultimodalPlacementChoice(
      choice,
      safeRequest.candidates.map((candidate) => candidate.alias),
    );
  }
}
