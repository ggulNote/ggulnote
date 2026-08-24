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
  type NoteDecisionWarmupInput,
} from "../domain";
import {
  buildNoteDecisionModelRequest,
  buildNoteDecisionWarmupModelRequest,
} from "./note-decision-prompt";
import { NOTE_DECISION_SCHEMA_VERSION } from "./note-decision-json-schema";
import type {
  NoteDecisionProvider,
  NoteDecisionProviderOptions,
} from "./note-decision-provider";

export class LlmNoteDecisionProvider
implements NoteDecisionProvider {
  public constructor(private readonly transport: DirectTextModelTransport) {}

  public async warmup(
    input: NoteDecisionWarmupInput,
    options: NoteDecisionProviderOptions = {},
  ): Promise<void> {
    throwIfAborted(options.signal);
    let telemetry:
      | import("../../providers/direct-text-model-transport").DirectTextModelTelemetry
      | undefined;
    await this.transport.generate(buildNoteDecisionWarmupModelRequest(input), {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onTelemetry: (value) => {
        telemetry = value;
      },
    });
    throwIfAborted(options.signal);
    const reported = providerTelemetry(telemetry, 0);
    options.onTelemetry?.(reported);
    tracePromptCache(input, true, reported);
  }

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
      traceNoteDecision("initialCallStarted", {
        openaiCallCount,
        requestType: "json_schema",
        schemaVersion: NOTE_DECISION_SCHEMA_VERSION,
      });
      openaiCallCount += 1;
      raw = await this.transport.generate(buildNoteDecisionModelRequest(input), {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        onTelemetry: (telemetry) => {
          transportTelemetry = telemetry;
        },
      });
      throwIfAborted(options.signal);
      traceNoteDecision("initialCallCompleted", {
        openaiCallCount,
        structuredResponseStatus: "RECEIVED",
      });
    } catch (error) {
      traceNoteDecision("failure", {
        failureStage,
        openaiCallCount,
        ...validationFailureTrace(error),
      });
      if (error instanceof DirectAiProviderError) throw error;
      if (isAbortError(error) || options.signal?.aborted) {
        throw new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
      }
      throw new DirectAiProviderError("PLANNER_UNAVAILABLE", "NETWORK_FAILURE", { cause: error });
    }
    try {
      failureStage = "INITIAL_PARSE";
      const parseStartedAt = monotonicNow();
      const decision = parseNoteDecision(parseDirectModelJsonObject(raw));
      const reported = providerTelemetry(
        transportTelemetry,
        Math.max(0, monotonicNow() - parseStartedAt),
      );
      options.onTelemetry?.(reported);
      tracePromptCache(input, false, reported);
      assertToolAuthority(decision, input);
      const initialRangeTrace = inspectTextRangeDecision(decision, input);
      traceNoteDecision("initialDecision", initialRangeTrace?.decision ?? {});
      traceNoteDecision("initialValidation", initialRangeTrace?.validation ?? {
        startExists: false,
        endExists: false,
      });
      failureStage = "INITIAL_VALIDATION";
      assertCatalogTextRangeAnchors(decision, input);
      traceNoteDecision("completed", { openaiCallCount });
      return decision;
    } catch (error) {
      traceNoteDecision("failure", {
        failureStage,
        openaiCallCount,
        ...validationFailureTrace(error),
      });
      if (error instanceof DirectAiProviderError) throw error;
      if (error instanceof NoteAgentValidationError || error instanceof Error) {
        throw new DirectAiProviderError("PLANNER_INVALID_OUTPUT", "INVALID_OUTPUT", { cause: error });
      }
      throw error;
    }
  }

}

function providerTelemetry(
  telemetry: import("../../providers/direct-text-model-transport").DirectTextModelTelemetry
    | undefined,
  decisionJsonParseMs: number,
): Parameters<NonNullable<NoteDecisionProviderOptions["onTelemetry"]>>[0] {
  return {
    openaiTtfbMs: telemetry?.openaiTtfbMs ?? 0,
    openaiBodyReadMs: telemetry?.openaiBodyReadMs ?? 0,
    decisionJsonParseMs,
    ...(telemetry?.inputTokens === undefined
      ? {} : { inputTokens: telemetry.inputTokens }),
    ...(telemetry?.cachedInputTokens === undefined
      ? {} : { cachedInputTokens: telemetry.cachedInputTokens }),
    ...(telemetry?.cacheWriteInputTokens === undefined
      ? {} : { cacheWriteInputTokens: telemetry.cacheWriteInputTokens }),
    ...(telemetry?.outputTokens === undefined
      ? {} : { outputTokens: telemetry.outputTokens }),
  };
}

function tracePromptCache(
  input: NoteDecisionInput | NoteDecisionWarmupInput,
  warmup: boolean,
  telemetry: Parameters<NonNullable<NoteDecisionProviderOptions["onTelemetry"]>>[0],
): void {
  if (process.env.NODE_ENV !== "development") return;
  const decisionInput = "decisionInput" in input ? input.decisionInput : input;
  const pageBase = decisionInput.pageBase;
  const contextRevision = "contextRevision" in input
    ? input.contextRevision
    : contextRevisionFrom(pageBase.baseRevision);
  console.info("[NOTE_PROMPT_CACHE_TRACE]", JSON.stringify({
    sessionId: pageBase.documentId,
    pageId: pageBase.pageId,
    contextRevision,
    warmup,
    warmupLevel: "decisionInput" in input ? "visual" : "page",
    cachedInputTokens: telemetry.cachedInputTokens ?? 0,
    cacheWriteInputTokens: telemetry.cacheWriteInputTokens ?? 0,
  }));
}

function contextRevisionFrom(baseRevision: string): number {
  const separator = baseRevision.lastIndexOf("@");
  const revision = Number(baseRevision.slice(separator + 1));
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
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
}

type NoteDecisionFailureStage =
  | "INITIAL_CALL"
  | "INITIAL_PARSE"
  | "INITIAL_VALIDATION";

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
    if (target.object === null) continue;
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

function validationFailureTrace(error: unknown): Readonly<Record<string, unknown>> {
  if (!(error instanceof Error)) return { errorType: "UNKNOWN" };
  const path = error instanceof NoteAgentValidationError ? error.path : undefined;
  const indexMatch = path?.match(/decision\.steps\[(\d+)\]/u);
  return {
    errorType: error.name,
    ...(path === undefined ? {} : { validationPath: path }),
    ...(indexMatch?.[1] === undefined
      ? {}
      : { actionIndex: Number(indexMatch[1]) }),
  };
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
    if (target.object === null) continue;
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
      };
    }
  }
  return undefined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DirectAiProviderError("ABORTED", "ABORTED");
}
