import {
  DirectAiProviderError,
  isAbortError,
} from "../../domain";
import { parseDirectModelJsonObject } from "../../providers/direct-model-json";
import type { DirectTextModelTransport } from "../../providers/direct-text-model-transport";
import {
  NoteAgentValidationError,
  parseNoteDecision,
  parseNoteDisambiguationChoice,
  type NoteDecision,
  type NoteDecisionInput,
  type NoteDisambiguationChoice,
  type NoteDisambiguationInput,
} from "../domain";
import { buildNoteDecisionModelRequest } from "./note-decision-prompt";
import type {
  NoteDecisionProvider,
  NoteDecisionProviderOptions,
} from "./note-decision-provider";
import type { NoteDisambiguationProvider } from "./note-decision-provider";
import { buildNoteDisambiguationModelRequest } from "./note-disambiguation-prompt";

export class LlmNoteDecisionProvider
implements NoteDecisionProvider, NoteDisambiguationProvider {
  public constructor(private readonly transport: DirectTextModelTransport) {}

  public async decide(
    input: NoteDecisionInput,
    options: NoteDecisionProviderOptions = {},
  ): Promise<NoteDecision> {
    throwIfAborted(options.signal);
    let raw: string;
    let transportTelemetry:
      | import("../../providers/direct-text-model-transport").DirectTextModelTelemetry
      | undefined;
    try {
      raw = await this.transport.generate(buildNoteDecisionModelRequest(input), {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        onTelemetry: (telemetry) => {
          transportTelemetry = telemetry;
        },
      });
      throwIfAborted(options.signal);
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (isAbortError(error) || options.signal?.aborted) {
        throw new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
      }
      throw new DirectAiProviderError("PLANNER_UNAVAILABLE", "NETWORK_FAILURE", { cause: error });
    }
    try {
      const parseStartedAt = monotonicNow();
      const decision = parseNoteDecision(parseDirectModelJsonObject(raw));
      options.onTelemetry?.({
        openaiTtfbMs: transportTelemetry?.openaiTtfbMs ?? 0,
        openaiBodyReadMs: transportTelemetry?.openaiBodyReadMs ?? 0,
        decisionJsonParseMs: Math.max(0, monotonicNow() - parseStartedAt),
        ...(transportTelemetry?.inputTokens === undefined
          ? {}
          : { inputTokens: transportTelemetry.inputTokens }),
        ...(transportTelemetry?.cachedInputTokens === undefined
          ? {}
          : { cachedInputTokens: transportTelemetry.cachedInputTokens }),
        ...(transportTelemetry?.outputTokens === undefined
          ? {}
          : { outputTokens: transportTelemetry.outputTokens }),
      });
      assertToolAuthority(decision, input);
      return decision;
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (error instanceof NoteAgentValidationError || error instanceof Error) {
        throw new DirectAiProviderError("PLANNER_INVALID_OUTPUT", "INVALID_OUTPUT", { cause: error });
      }
      throw error;
    }
  }

  public async disambiguate(
    input: NoteDisambiguationInput,
    options: NoteDecisionProviderOptions = {},
  ): Promise<NoteDisambiguationChoice> {
    throwIfAborted(options.signal);
    try {
      const raw = await this.transport.generate(
        buildNoteDisambiguationModelRequest(input),
        options.signal === undefined ? {} : { signal: options.signal },
      );
      throwIfAborted(options.signal);
      const choice = parseNoteDisambiguationChoice(parseDirectModelJsonObject(raw));
      if (
        choice.status === "SELECTED"
        && !input.candidates.some((candidate) => candidate.alias === choice.alias)
      ) throw new Error("Disambiguation selected an unknown alias.");
      return choice;
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (isAbortError(error) || options.signal?.aborted) {
        throw new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
      }
      throw new DirectAiProviderError("PLANNER_INVALID_OUTPUT", "INVALID_OUTPUT", { cause: error });
    }
  }
}

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}
function assertToolAuthority(decision: NoteDecision, input: NoteDecisionInput): void {
  const available = new Set(input.availableTools.map((tool) => tool.id));
  const calls = decision.status === "CALL"
    ? [decision.call]
    : decision.status === "BATCH"
      ? decision.steps
      : decision.status === "READY"
        ? decision.steps.map((step) => ({ toolId: step.action }))
      : [];
  if (calls.some((call) => !available.has(call.toolId))) {
    throw new Error("Decision selected a tool outside the supplied registry.");
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DirectAiProviderError("ABORTED", "ABORTED");
}
