import {
  DirectAiProviderError,
  isAbortError,
} from "../../domain";
import { parseDirectModelJsonObject } from "../../providers/direct-model-json";
import type {
  DirectTextModelRequest,
  DirectTextModelTransport,
} from "../../providers/direct-text-model-transport";
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
    let openaiCallCount = 0;
    let failureStage: NoteDecisionFailureStage = "INITIAL_CALL";
    let raw: string;
    let transportTelemetry:
      | import("../../providers/direct-text-model-transport").DirectTextModelTelemetry
      | undefined;
    try {
      traceNoteDecision("initialCallStarted", { openaiCallCount });
      openaiCallCount += 1;
      raw = await this.transport.generate(buildNoteDecisionModelRequest(input), {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        onTelemetry: (telemetry) => {
          transportTelemetry = telemetry;
        },
      });
      throwIfAborted(options.signal);
      traceNoteDecision("initialCallCompleted", { openaiCallCount });
    } catch (error) {
      traceNoteDecision("failure", { failureStage, openaiCallCount });
      if (error instanceof DirectAiProviderError) throw error;
      if (isAbortError(error) || options.signal?.aborted) {
        throw new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
      }
      throw new DirectAiProviderError("PLANNER_UNAVAILABLE", "NETWORK_FAILURE", { cause: error });
    }
    try {
      failureStage = "INITIAL_PARSE";
      const parseStartedAt = monotonicNow();
      let decision = parseNoteDecision(parseDirectModelJsonObject(raw));
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
      const initialRangeTrace = inspectTextRangeDecision(decision, input);
      traceNoteDecision("initialDecision", initialRangeTrace?.decision ?? {});
      traceNoteDecision("initialValidation", initialRangeTrace?.validation ?? {
        startExists: false,
        endExists: false,
      });
      failureStage = "INITIAL_VALIDATION";
      const invalidTextRange = findInvalidCatalogTextRange(decision, input);
      const repairableTextRange = asRepairableTextRange(invalidTextRange);
      traceNoteDecision("repairAttempted", {
        repairAttempted: repairableTextRange !== undefined,
        openaiCallCount,
      });
      if (invalidTextRange !== undefined && repairableTextRange === undefined) {
        assertCatalogTextRangeAnchors(decision, input);
      }
      if (repairableTextRange !== undefined) {
        failureStage = "REPAIR_CALL";
        traceNoteDecision("repairCallStarted", { openaiCallCount });
        openaiCallCount += 1;
        const repairRaw = await this.transport.generate(
          buildTextRangeRepairRequest(input, repairableTextRange),
          options.signal === undefined ? {} : { signal: options.signal },
        );
        throwIfAborted(options.signal);
        traceNoteDecision("repairCallCompleted", { openaiCallCount });
        failureStage = "REPAIR_PARSE";
        const repair = parseTextRangeRepair(parseDirectModelJsonObject(repairRaw));
        traceNoteDecision("repairResult", {
          startText: repair.startText,
          endText: repair.endText,
        });
        decision = applyTextRangeRepair(decision, repairableTextRange.stepIndex, repair);
        const repairedRangeTrace = inspectTextRangeDecision(decision, input);
        traceNoteDecision("repairValidation", repairedRangeTrace?.validation ?? {
          startExists: false,
          endExists: false,
        });
        if (findInvalidCatalogTextRange(decision, input) !== undefined) {
          failureStage = "REPAIR_VALIDATION";
          assertCatalogTextRangeAnchors(decision, input);
        }
      }
      failureStage = "FINAL_VALIDATION";
      assertCatalogTextRangeAnchors(decision, input);
      traceNoteDecision("completed", { openaiCallCount });
      return decision;
    } catch (error) {
      traceNoteDecision("failure", { failureStage, openaiCallCount });
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

function assertCatalogTextRangeAnchors(
  decision: NoteDecision,
  input: NoteDecisionInput,
): void {
  const invalid = findInvalidCatalogTextRange(decision, input);
  if (invalid === undefined) return;
  throw new NoteAgentValidationError(
    `decision.steps[${invalid.stepIndex}].target.part`,
    "text_range anchors must be exact substrings of the selected catalog object's text",
  );
}

interface InvalidCatalogTextRange {
  readonly stepIndex: number;
  readonly action: string;
  readonly objectHandle: string;
  readonly objectText: string | undefined;
  readonly startText: string | null | undefined;
  readonly endText: string | null | undefined;
}

interface RepairableTextRange {
  readonly stepIndex: number;
  readonly objectHandle: string;
  readonly objectText: string;
  readonly startText: string;
  readonly endText: string;
}

interface TextRangeRepairResult {
  readonly startText: string;
  readonly endText: string;
}

type NoteDecisionFailureStage =
  | "INITIAL_CALL"
  | "INITIAL_PARSE"
  | "INITIAL_VALIDATION"
  | "REPAIR_CALL"
  | "REPAIR_PARSE"
  | "REPAIR_VALIDATION"
  | "FINAL_VALIDATION";

function inspectTextRangeDecision(
  decision: NoteDecision,
  input: NoteDecisionInput,
): {
  readonly decision: {
    readonly object: string;
    readonly partKind: "text_range";
    readonly startText: string | null | undefined;
    readonly endText: string | null | undefined;
  };
  readonly validation: {
    readonly startExists: boolean;
    readonly endExists: boolean;
  };
} | undefined {
  if (decision.status !== "READY") return undefined;
  for (const step of decision.steps) {
    const target = step.target;
    if (target?.part?.kind !== "text_range") continue;
    const objectText = input.objectCatalog.objects.find(
      (object) => object.handle === target.object,
    )?.text;
    return {
      decision: {
        object: target.object,
        partKind: target.part.kind,
        startText: target.part.startText,
        endText: target.part.endText,
      },
      validation: {
        startExists: typeof target.part.startText === "string"
          && objectText?.includes(target.part.startText) === true,
        endExists: typeof target.part.endText === "string"
          && objectText?.includes(target.part.endText) === true,
      },
    };
  }
  return undefined;
}

function traceNoteDecision(
  event: string,
  details: Readonly<Record<string, unknown>>,
): void {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[NOTE_DECISION_TRACE]", JSON.stringify({ event, ...details }));
}

function findInvalidCatalogTextRange(
  decision: NoteDecision,
  input: NoteDecisionInput,
): InvalidCatalogTextRange | undefined {
  if (decision.status !== "READY") return undefined;
  const objectsByHandle = new Map(
    input.objectCatalog.objects.map((object) => [object.handle, object]),
  );
  for (const [index, step] of decision.steps.entries()) {
    const target = step.target;
    if (target?.part?.kind !== "text_range") continue;
    const objectText = objectsByHandle.get(target.object)?.text;
    if (
      objectText === undefined
      || typeof target.part.startText !== "string"
      || typeof target.part.endText !== "string"
      || target.part.startText.length === 0
      || target.part.endText.length === 0
      || !objectText.includes(target.part.startText)
      || !objectText.includes(target.part.endText)
    ) {
      return {
        stepIndex: index,
        action: step.action,
        objectHandle: target.object,
        objectText,
        startText: target.part.startText,
        endText: target.part.endText,
      };
    }
  }
  return undefined;
}

function asRepairableTextRange(
  invalid: InvalidCatalogTextRange | undefined,
): RepairableTextRange | undefined {
  if (
    invalid === undefined
    || invalid.action !== "annotation.apply"
    || invalid.objectText === undefined
    || typeof invalid.startText !== "string"
    || typeof invalid.endText !== "string"
    || invalid.startText.length === 0
    || invalid.endText.length === 0
  ) return undefined;
  return {
    stepIndex: invalid.stepIndex,
    objectHandle: invalid.objectHandle,
    objectText: invalid.objectText,
    startText: invalid.startText,
    endText: invalid.endText,
  };
}

function buildTextRangeRepairRequest(
  input: NoteDecisionInput,
  invalid: RepairableTextRange,
): DirectTextModelRequest {
  return {
    instructions: `The target object is already selected and MUST NOT change.
Repair only startText and endText.
Both values MUST be copied verbatim from the provided exact object text.
Use the original transcript only to infer which span the user intended.
Do not copy ASR spellings, translations, or Korean particles unless they literally occur in the object text.
Return only the corrected anchors in the strict schema.`,
    input: [{
      role: "user",
      content: JSON.stringify({
        originalUserTranscript: input.turn.rawFinalTranscript,
        selectedObject: {
          handle: invalid.objectHandle,
          text: invalid.objectText,
        },
        invalidPreviousAnchors: {
          startText: invalid.startText,
          endText: invalid.endText,
        },
      }),
    }],
    maxOutputTokens: 100,
    responseFormat: {
      type: "json_schema",
      name: "note_text_range_repair",
      strict: true,
      schema: {
        type: "object",
        properties: {
          startText: { type: "string", minLength: 1 },
          endText: { type: "string", minLength: 1 },
        },
        required: ["startText", "endText"],
        additionalProperties: false,
      },
    },
  };
}

function parseTextRangeRepair(value: unknown): TextRangeRepairResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NoteAgentValidationError("textRangeRepair", "expected an object");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2
    || typeof record.startText !== "string"
    || record.startText.length === 0
    || typeof record.endText !== "string"
    || record.endText.length === 0
  ) {
    throw new NoteAgentValidationError(
      "textRangeRepair",
      "expected only non-empty startText and endText",
    );
  }
  return { startText: record.startText, endText: record.endText };
}

function applyTextRangeRepair(
  decision: NoteDecision,
  stepIndex: number,
  repair: TextRangeRepairResult,
): NoteDecision {
  if (decision.status !== "READY") return decision;
  return {
    ...decision,
    steps: decision.steps.map((step, index) => {
      if (index !== stepIndex || step.target?.part?.kind !== "text_range") return step;
      return {
        ...step,
        target: {
          ...step.target,
          part: {
            ...step.target.part,
            startText: repair.startText,
            endText: repair.endText,
          },
        },
      };
    }),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DirectAiProviderError("ABORTED", "ABORTED");
}
