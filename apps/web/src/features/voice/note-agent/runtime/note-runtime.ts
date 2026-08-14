import {
  NoteAgentValidationError,
  type NoteActionPrepareResult,
  type NoteDecision,
  type NoteToolId,
  type NoteToolResult,
} from "../domain";
import type {
  NoteTool,
  NoteToolContext,
  NoteRuntimeContext,
  NoteToolRegistry,
  NoteTransactionReceipt,
  NoteTransactionResult,
} from "../tools";

export interface NoteRuntimeStepResult {
  readonly stepId: string;
  readonly toolId: NoteToolId;
  readonly result: NoteToolResult;
}

export type NoteRuntimeResult =
  | {
      readonly status: "SUCCESS";
      readonly steps: readonly NoteRuntimeStepResult[];
      readonly receipt?: NoteTransactionReceipt;
      readonly commitAttempted: boolean;
    }
  | {
      readonly status: "AMBIGUOUS";
      readonly stepId: string;
      readonly toolId: NoteToolId;
      readonly candidates: readonly unknown[];
      readonly commitAttempted: false;
    }
  | { readonly status: "NOT_FOUND"; readonly commitAttempted: boolean }
  | { readonly status: "NEEDS_INPUT"; readonly missing: readonly string[]; readonly commitAttempted: false }
  | { readonly status: "NOT_ALLOWED"; readonly reasonCode: string; readonly commitAttempted: boolean }
  | { readonly status: "NO_FEASIBLE_PLACEMENT"; readonly commitAttempted: boolean }
  | { readonly status: "STALE_SCENE"; readonly commitAttempted: boolean }
  | { readonly status: "FAILED"; readonly reasonCode: string; readonly commitAttempted: boolean }
  | { readonly status: "UNSUPPORTED"; readonly reasonCode: string; readonly commitAttempted: false }
  | { readonly status: "NO_OP"; readonly commitAttempted: false };

export interface NoteRuntimeOptions {
  readonly registry: NoteToolRegistry;
}

interface PreparedCall {
  readonly stepId: string;
  readonly toolId: NoteToolId;
  readonly rawInput: unknown;
  readonly tool: NoteTool;
}

/**
 * Two-phase runtime: every tool is validated and prepared before the optional
 * production transaction port is invoked. Tools never receive editor mutation
 * authority directly.
 */
export class NoteRuntime {
  public constructor(private readonly options: NoteRuntimeOptions) {}

  public async execute(
    decision: NoteDecision,
    context: NoteRuntimeContext,
  ): Promise<NoteRuntimeResult> {
    if (decision.status === "NEEDS_INPUT") {
      return { status: "NEEDS_INPUT", missing: decision.missing, commitAttempted: false };
    }
    if (decision.status === "UNSUPPORTED") {
      return { status: "UNSUPPORTED", reasonCode: decision.reasonCode, commitAttempted: false };
    }
    if (decision.status === "NO_OP") return { status: "NO_OP", commitAttempted: false };

    const calls = decision.status === "CALL" ? [decision.call] : decision.steps;
    const callsToPrepare: PreparedCall[] = [];
    for (const call of calls) {
      const tool = this.options.registry.get(call.toolId);
      if (tool === undefined) return failed("UNKNOWN_TOOL");
      if (!tool.isAvailable(context)) return notAllowed("TOOL_UNAVAILABLE");
      callsToPrepare.push({
        stepId: call.stepId,
        toolId: call.toolId,
        rawInput: call.input,
        tool,
      });
    }

    const steps: NoteRuntimeStepResult[] = [];
    const values = new Map<string, unknown>();
    const transactionSteps: import("../tools").NoteTransactionStep[] = [];
    for (const call of callsToPrepare) {
      if (isStale(context)) return { status: "STALE_SCENE", commitAttempted: false };
      let input: unknown;
      try {
        input = call.tool.inputSchema.parse(
          bindStepResults(call.rawInput, values),
          `tool.${call.toolId}.input`,
        );
      } catch {
        return failed("INVALID_TOOL_INPUT");
      }
      let prepared: NoteActionPrepareResult;
      const prepareStartedAt = context.metrics?.now();
      try {
        prepared = await call.tool.prepare(
          input,
          prepareContext(context, call.stepId),
        );
      } catch (error) {
        if (error instanceof NoteAgentValidationError) return failed("INVALID_TOOL_INPUT");
        return failed("ACTION_PREPARE_FAILED");
      } finally {
        if (prepareStartedAt !== undefined) {
          context.metrics?.add("prepareMs", context.metrics.now() - prepareStartedAt);
        }
      }
      if (prepared.status === "READY") {
        let value: unknown;
        try {
          value = call.tool.outputSchema.parse(prepared.value, `tool.${call.toolId}.output`);
        } catch {
          return failed("INVALID_TOOL_OUTPUT");
        }
        if (call.tool.kind === "MUTATION" && prepared.operations.length === 0) {
          return failed("MUTATION_PREPARED_WITHOUT_OPERATION");
        }
        if (call.tool.kind !== "MUTATION" && prepared.operations.length !== 0) {
          return failed("NON_MUTATION_PREPARED_OPERATION");
        }
        values.set(call.stepId, value);
        prepared.operations.forEach((operation) => transactionSteps.push({
          stepId: call.stepId,
          toolId: call.toolId,
          operation,
        }));
        steps.push({
          stepId: call.stepId,
          toolId: call.toolId,
          result: { status: "SUCCESS", data: value },
        });
      } else {
        return mapPrepareFailure(call, prepared);
      }
      if (isStale(context)) return { status: "STALE_SCENE", commitAttempted: false };
    }

    if (context.mode === "SHADOW" || transactionSteps.length === 0) {
      return { status: "SUCCESS", steps: Object.freeze(steps), commitAttempted: false };
    }
    if (context.transaction === undefined) return notAllowed("TRANSACTION_UNAVAILABLE");
    if (isStale(context)) return { status: "STALE_SCENE", commitAttempted: false };

    const transaction = await context.transaction.commit({
      turnId: context.turnId,
      frozenWorld: context.frozenWorld,
      steps: transactionSteps,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    });
    return mapTransactionResult(steps, transaction);
  }
}

function prepareContext(
  context: NoteRuntimeContext,
  stepId: string,
): NoteToolContext {
  return {
    mode: context.mode,
    turnId: context.turnId,
    frozenWorld: context.frozenWorld,
    world: context.world,
    resolver: context.resolver,
    getCurrentSceneRevision: context.getCurrentSceneRevision,
    stepId,
    ...(context.placement === undefined ? {} : { placement: context.placement }),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    ...(context.candidateSelection === undefined
      ? {}
      : { candidateSelection: context.candidateSelection }),
    ...(context.metrics === undefined ? {} : { metrics: context.metrics }),
    ...(context.productionPlacementAvailable === undefined
      ? {}
      : { productionPlacementAvailable: context.productionPlacementAvailable }),
    ...(context.preparePlacement === undefined
      ? {}
      : { preparePlacement: context.preparePlacement }),
  };
}

function isStale(context: NoteRuntimeContext): boolean {
  return context.getCurrentSceneRevision() !== context.frozenWorld.sceneRevision;
}

function mapPrepareFailure(
  call: Pick<PreparedCall, "stepId" | "toolId">,
  result: Exclude<NoteActionPrepareResult, { status: "READY" }>,
): NoteRuntimeResult {
  switch (result.status) {
    case "AMBIGUOUS":
      return {
        ...result,
        stepId: call.stepId,
        toolId: call.toolId,
        commitAttempted: false,
      };
    case "NEEDS_INPUT": return { ...result, commitAttempted: false };
    case "NOT_ALLOWED": return { ...result, commitAttempted: false };
    case "FAILED": return { ...result, commitAttempted: false };
    case "NOT_FOUND": return { status: "NOT_FOUND", commitAttempted: false };
    case "NO_FEASIBLE_PLACEMENT": return { status: "NO_FEASIBLE_PLACEMENT", commitAttempted: false };
    case "STALE_SCENE": return { status: "STALE_SCENE", commitAttempted: false };
  }
}

function bindStepResults(
  value: unknown,
  completed: ReadonlyMap<string, unknown>,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => bindStepResults(entry, completed));
  const record = value as Record<string, unknown>;
  if ("fromStep" in record) {
    if (
      Object.keys(record).some((key) => key !== "fromStep" && key !== "path")
      || typeof record.fromStep !== "string"
      || !completed.has(record.fromStep)
      || (record.path !== undefined
        && (!Array.isArray(record.path)
          || record.path.some((entry) => typeof entry !== "string" || entry.length === 0)))
    ) throw new NoteAgentValidationError("stepRef", "invalid or forward step reference");
    let resolved = completed.get(record.fromStep);
    for (const segment of record.path ?? []) {
      if (typeof resolved !== "object" || resolved === null || !(segment in resolved)) {
        throw new NoteAgentValidationError("stepRef.path", "step result path not found");
      }
      resolved = (resolved as Record<string, unknown>)[segment];
    }
    return resolved;
  }
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [
    key,
    bindStepResults(entry, completed),
  ]));
}

function mapTransactionResult(
  steps: readonly NoteRuntimeStepResult[],
  transaction: NoteTransactionResult,
): NoteRuntimeResult {
  switch (transaction.status) {
    case "SUCCESS":
      return {
        status: "SUCCESS",
        steps: Object.freeze([...steps]),
        receipt: transaction.receipt,
        commitAttempted: transaction.commitAttempted,
      };
    case "NEEDS_INPUT": return { ...transaction };
    case "NOT_ALLOWED": return { ...transaction };
    case "FAILED": return { ...transaction };
    case "NOT_FOUND": return { ...transaction };
    case "NO_FEASIBLE_PLACEMENT": return { ...transaction };
    case "STALE_SCENE": return { ...transaction };
  }
}

function failed(reasonCode: string): NoteRuntimeResult {
  return { status: "FAILED", reasonCode, commitAttempted: false };
}

function notAllowed(reasonCode: string): NoteRuntimeResult {
  return { status: "NOT_ALLOWED", reasonCode, commitAttempted: false };
}
