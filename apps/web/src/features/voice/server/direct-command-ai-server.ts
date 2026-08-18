import { DirectAiProviderError } from "../domain";
import { LlmDirectCommandPlannerProvider } from "../providers/llm-direct-command-planner-provider";
import { LlmDirectTargetDisambiguatorProvider } from "../providers/llm-direct-target-disambiguator-provider";
import { LlmGroundedTargetRecoveryProvider } from "../providers/llm-grounded-target-recovery-provider";
import { LlmSpeechRefinerProvider } from "../providers/llm-speech-refiner-provider";
import { LlmMultimodalPlacementJudgeProvider } from "../providers/llm-multimodal-placement-judge-provider";
import { LlmNoteDecisionProvider } from "../note-agent/decision";
import {
  OpenAiResponsesDirectTextTransport,
  type OpenAiReasoningEffort,
  type OpenAiResponsesFetch,
} from "./openai-responses-direct-text-transport";
import { OpenAiResponsesDirectMultimodalTransport } from "./openai-responses-direct-multimodal-transport";

const DEFAULT_DIRECT_COMMAND_AI_TIMEOUT_MS = 15_000;

export interface DirectCommandAiServerConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  reasoningEffort?: OpenAiReasoningEffort;
}

const REASONING_EFFORTS = new Set<OpenAiReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export function readDirectCommandAiServerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): DirectCommandAiServerConfig {
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? "";
  const model = environment.DIRECT_COMMAND_MODEL?.trim() ?? "";
  if (apiKey.length === 0 || model.length === 0) {
    throw new DirectAiProviderError(
      "PLANNER_UNAVAILABLE",
      "MISSING_CONFIGURATION",
    );
  }
  const rawTimeout = environment.DIRECT_COMMAND_AI_TIMEOUT_MS?.trim();
  const timeoutMs = rawTimeout === undefined || rawTimeout.length === 0
    ? DEFAULT_DIRECT_COMMAND_AI_TIMEOUT_MS
    : Number(rawTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new DirectAiProviderError(
      "PLANNER_UNAVAILABLE",
      "MISSING_CONFIGURATION",
    );
  }
  const rawReasoningEffort = environment.DIRECT_COMMAND_REASONING_EFFORT?.trim();
  if (
    rawReasoningEffort !== undefined
    && rawReasoningEffort.length > 0
    && !REASONING_EFFORTS.has(rawReasoningEffort as OpenAiReasoningEffort)
  ) {
    throw new DirectAiProviderError(
      "PLANNER_UNAVAILABLE",
      "MISSING_CONFIGURATION",
    );
  }
  return {
    apiKey,
    model,
    timeoutMs,
    ...(rawReasoningEffort === undefined || rawReasoningEffort.length === 0
      ? {}
      : { reasoningEffort: rawReasoningEffort as OpenAiReasoningEffort }),
  };
}

export function createDirectCommandAiProviders(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl?: OpenAiResponsesFetch,
) {
  const config = readDirectCommandAiServerConfig(environment);
  const transport = new OpenAiResponsesDirectTextTransport({
    ...config,
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
  const multimodalTransport = new OpenAiResponsesDirectMultimodalTransport({
    ...config,
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
  return {
    planner: new LlmDirectCommandPlannerProvider({ transport }),
    disambiguator: new LlmDirectTargetDisambiguatorProvider(transport),
    recovery: new LlmGroundedTargetRecoveryProvider(transport),
    refiner: new LlmSpeechRefinerProvider(transport),
    placementJudge: new LlmMultimodalPlacementJudgeProvider(multimodalTransport),
    noteDecision: new LlmNoteDecisionProvider(transport),
  };
}
