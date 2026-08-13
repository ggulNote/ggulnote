import {
  DirectAiProviderError,
  isAbortError,
} from "../../domain";
import { parseDirectModelJsonObject } from "../../providers/direct-model-json";
import type { DirectTextModelTransport } from "../../providers/direct-text-model-transport";
import {
  NoteAgentValidationError,
  parseNoteDecision,
  type NoteDecision,
  type NoteDecisionInput,
} from "../domain";
import { buildNoteDecisionModelRequest } from "./note-decision-prompt";
import type {
  NoteDecisionProvider,
  NoteDecisionProviderOptions,
} from "./note-decision-provider";

export class LlmNoteDecisionProvider implements NoteDecisionProvider {
  public constructor(private readonly transport: DirectTextModelTransport) {}

  public async decide(
    input: NoteDecisionInput,
    options: NoteDecisionProviderOptions = {},
  ): Promise<NoteDecision> {
    throwIfAborted(options.signal);
    let raw: string;
    try {
      raw = await this.transport.generate(buildNoteDecisionModelRequest(input), options);
      throwIfAborted(options.signal);
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (isAbortError(error) || options.signal?.aborted) {
        throw new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
      }
      throw new DirectAiProviderError("PLANNER_UNAVAILABLE", "NETWORK_FAILURE", { cause: error });
    }
    try {
      const decision = parseNoteDecision(parseDirectModelJsonObject(raw));
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
}
function assertToolAuthority(decision: NoteDecision, input: NoteDecisionInput): void {
  const available = new Set(input.availableTools.map((tool) => tool.id));
  const calls = decision.status === "CALL"
    ? [decision.call]
    : decision.status === "BATCH"
      ? decision.steps
      : [];
  if (calls.some((call) => !available.has(call.toolId))) {
    throw new Error("Decision selected a tool outside the supplied registry.");
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DirectAiProviderError("ABORTED", "ABORTED");
}
