import type {
  MultimodalPlacementChoice,
  MultimodalPlacementRequest,
} from "../domain";

export interface MultimodalPlacementJudgeProviderOptions {
  readonly signal?: AbortSignal;
}

export interface MultimodalPlacementJudgeProvider {
  judge(
    request: MultimodalPlacementRequest,
    options?: MultimodalPlacementJudgeProviderOptions,
  ): Promise<MultimodalPlacementChoice>;
}
