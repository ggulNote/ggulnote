import {
  NoteAgentValidationError,
  type NoteDecision,
  type NoteToolId,
  type NoteToolResult,
} from "../domain";
import type {
  NoteTool,
  NoteToolContext,
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
  readonly input: unknown;
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
    context: NoteToolContext,
  ): Promise<NoteRuntimeResult> {
    if (decision.status === "NEEDS_INPUT") {
      return { status: "NEEDS_INPUT", missing: decision.missing, commitAttempted: false };
    }
    if (decision.status === "UNSUPPORTED") {
      return { status: "UNSUPPORTED", reasonCode: decision.reasonCode, commitAttempted: false };
    }
    if (decision.status === "NO_OP") return { status: "NO_OP", commitAttempted: false };

    const calls = decision.status === "CALL" ? [decision.call] : decision.steps;
    const prepared: PreparedCall[] = [];
    for (const call of calls) {
      const tool = this.options.registry.get(call.toolId);
      if (tool === undefined) return failed("UNKNOWN_TOOL");
      if (!tool.isAvailable(context)) return notAllowed("TOOL_UNAVAILABLE");
      try {
        prepared.push({
          stepId: call.stepId,
          toolId: call.toolId,
          input: tool.inputSchema.parse(call.input, `tool.${call.toolId}.input`),
          tool,
        });
      } catch (error) {
        if (error instanceof NoteAgentValidationError) return failed("INVALID_TOOL_INPUT");
        return failed("INVALID_TOOL_INPUT");
      }
    }

    const mutationCount = prepared.filter((call) => call.tool.kind === "MUTATION").length;
    if (context.mode === "PRODUCTION" && mutationCount > 1) {
      return notAllowed("MULTI_MUTATION_BATCH_UNSUPPORTED");
    }

    const steps: NoteRuntimeStepResult[] = [];
    for (const call of prepared) {
      if (isStale(context)) return { status: "STALE_SCENE", commitAttempted: false };
      let result: NoteToolResult;
      try {
        result = await call.tool.execute(call.input, {
          ...context,
          stepId: call.stepId,
        });
      } catch (error) {
        if (error instanceof NoteAgentValidationError) return failed("INVALID_TOOL_INPUT");
        return failed("TOOL_EXECUTION_FAILED");
      }
      if (result.status === "SUCCESS") {
        try {
          result = {
            ...result,
            data: call.tool.outputSchema.parse(
              result.data,
              `tool.${call.toolId}.output`,
            ),
          };
        } catch {
          return failed("INVALID_TOOL_OUTPUT");
        }
      }
      if (isStale(context)) return { status: "STALE_SCENE", commitAttempted: false };
      steps.push({ stepId: call.stepId, toolId: call.toolId, result });
      if (result.status !== "SUCCESS") return mapToolFailure(call, result);
    }

    if (context.mode === "SHADOW" || mutationCount === 0) {
      return { status: "SUCCESS", steps: Object.freeze(steps), commitAttempted: false };
    }
    if (context.transaction === undefined) return notAllowed("TRANSACTION_UNAVAILABLE");
    if (isStale(context)) return { status: "STALE_SCENE", commitAttempted: false };

    const mutationSteps = steps.filter((step) =>
      this.options.registry.get(step.toolId)?.kind === "MUTATION"
      && step.result.status === "SUCCESS").map((step) => ({
        stepId: step.stepId,
        toolId: step.toolId,
        data: step.result.status === "SUCCESS" ? step.result.data : undefined,
      }));
    const transaction = await context.transaction.commit({
      turnId: context.turnId,
      frozenWorld: context.frozenWorld,
      steps: mutationSteps,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    });
    return mapTransactionResult(steps, transaction);
  }
}

function isStale(context: NoteToolContext): boolean {
  return context.getCurrentSceneRevision() !== context.frozenWorld.sceneRevision;
}

function mapToolFailure(
  call: Pick<PreparedCall, "stepId" | "toolId">,
  result: Exclude<NoteToolResult, { status: "SUCCESS" }>,
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
