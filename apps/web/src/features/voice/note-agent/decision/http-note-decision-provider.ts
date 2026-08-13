import { DirectAiProviderError } from "../../domain";
import {
  postDirectAiRequest,
  type DirectAiFetch,
} from "../../providers/http-direct-ai-client";
import {
  NoteAgentValidationError,
  parseNoteDecision,
  parseNoteDecisionInput,
  type NoteDecision,
  type NoteDecisionInput,
} from "../domain";
import type {
  NoteDecisionProvider,
  NoteDecisionProviderOptions,
} from "./note-decision-provider";

export interface HttpNoteDecisionProviderOptions {
  readonly endpoint?: string;
  readonly fetch?: DirectAiFetch;
}
export class HttpNoteDecisionProvider implements NoteDecisionProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: DirectAiFetch;

  public constructor(options: HttpNoteDecisionProviderOptions = {}) {
    this.endpoint = options.endpoint ?? "/api/voice/note-decision";
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public async decide(
    input: NoteDecisionInput,
    options: NoteDecisionProviderOptions = {},
  ): Promise<NoteDecision> {
    const safeInput = parseNoteDecisionInput(input);
    const value = await postDirectAiRequest(
      this.endpoint,
      safeInput,
      this.fetchImpl,
      options.signal,
    );
    try {
      const result = parseNoteDecision(value);
      const available = new Set(safeInput.availableTools.map((tool) => tool.id));
      const calls = result.status === "CALL"
        ? [result.call]
        : result.status === "BATCH"
          ? result.steps
          : [];
      if (calls.some((call) => !available.has(call.toolId))) {
        throw new Error("Decision selected an unavailable tool.");
      }
      return result;
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (error instanceof NoteAgentValidationError || error instanceof Error) {
        throw new DirectAiProviderError("PLANNER_INVALID_OUTPUT", "INVALID_OUTPUT", { cause: error });
      }
      throw error;
    }
  }
}
