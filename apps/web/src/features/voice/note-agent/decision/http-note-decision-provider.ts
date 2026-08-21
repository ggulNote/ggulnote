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
      (telemetry) => options.onTelemetry?.(parseTelemetry(telemetry)),
    );
    try {
      const result = parseNoteDecision(value);
      const available = new Set(safeInput.availableTools.map((tool) => tool.id));
      const calls = result.status === "CALL"
        ? [result.call]
        : result.status === "BATCH"
          ? result.steps
          : result.status === "READY"
            ? result.steps.map((step) => ({ toolId: step.action }))
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

function parseTelemetry(value: unknown): Parameters<NonNullable<NoteDecisionProviderOptions["onTelemetry"]>>[0] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DirectAiProviderError("PLANNER_INVALID_OUTPUT", "INVALID_OUTPUT");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "openaiTtfbMs", "openaiBodyReadMs", "decisionJsonParseMs",
    "inputTokens", "cachedInputTokens", "outputTokens",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new DirectAiProviderError("PLANNER_INVALID_OUTPUT", "INVALID_OUTPUT");
  }
  return {
    openaiTtfbMs: nonNegativeMetric(record.openaiTtfbMs),
    openaiBodyReadMs: nonNegativeMetric(record.openaiBodyReadMs),
    decisionJsonParseMs: nonNegativeMetric(record.decisionJsonParseMs),
    ...optionalTelemetryMetric("inputTokens", record.inputTokens),
    ...optionalTelemetryMetric("cachedInputTokens", record.cachedInputTokens),
    ...optionalTelemetryMetric("outputTokens", record.outputTokens),
  };
}

function nonNegativeMetric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new DirectAiProviderError("PLANNER_INVALID_OUTPUT", "INVALID_OUTPUT");
  }
  return value;
}

function optionalTelemetryMetric(
  key: "inputTokens" | "cachedInputTokens" | "outputTokens",
  value: unknown,
): Partial<Record<"inputTokens" | "cachedInputTokens" | "outputTokens", number>> {
  if (value === undefined) return {};
  return { [key]: nonNegativeMetric(value) };
}
