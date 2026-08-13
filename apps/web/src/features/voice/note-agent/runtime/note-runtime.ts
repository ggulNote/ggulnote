import {
  NoteAgentValidationError,
  type NoteDecision,
  type NoteToolResult,
} from "../domain";
import type {
  NoteToolContext,
  NoteToolRegistry,
} from "../tools";

export interface NoteRuntimeStepResult {
  readonly stepId: string;
  readonly toolId: string;
  readonly result: NoteToolResult;
}

export type NoteRuntimeResult =
  | { readonly status: "SUCCESS"; readonly steps: readonly NoteRuntimeStepResult[]; readonly commitAttempted: false }
  | { readonly status: "AMBIGUOUS"; readonly candidates: readonly unknown[]; readonly commitAttempted: false }
  | { readonly status: "NOT_FOUND"; readonly commitAttempted: false }
  | { readonly status: "NEEDS_INPUT"; readonly missing: readonly string[]; readonly commitAttempted: false }
  | { readonly status: "NOT_ALLOWED"; readonly reasonCode: string; readonly commitAttempted: false }
  | { readonly status: "NO_FEASIBLE_PLACEMENT"; readonly commitAttempted: false }
  | { readonly status: "STALE_SCENE"; readonly commitAttempted: false }
  | { readonly status: "FAILED"; readonly reasonCode: string; readonly commitAttempted: false }
  | { readonly status: "UNSUPPORTED"; readonly reasonCode: string; readonly commitAttempted: false }
  | { readonly status: "NO_OP"; readonly commitAttempted: false };

export interface NoteRuntimeOptions {
  readonly registry: NoteToolRegistry;
}

/**
 * Phase 2 runtime is intentionally shadow-only. It receives no editor commit
 * port, so every result has commitAttempted=false by construction.
 */
export class NoteRuntime {
  public constructor(private readonly options: NoteRuntimeOptions) {}

  public async execute(
    decision: NoteDecision,
    context: NoteToolContext,
  ): Promise<NoteRuntimeResult> {
    if (context.mode !== "SHADOW") {
      return failed("SHADOW_MODE_REQUIRED");
    }
    if (decision.status === "NEEDS_INPUT") {
      return { status: "NEEDS_INPUT", missing: decision.missing, commitAttempted: false };
    }
    if (decision.status === "UNSUPPORTED") {
      return { status: "UNSUPPORTED", reasonCode: decision.reasonCode, commitAttempted: false };
    }
    if (decision.status === "NO_OP") return { status: "NO_OP", commitAttempted: false };
    const calls = decision.status === "CALL" ? [decision.call] : decision.steps;
    const steps: NoteRuntimeStepResult[] = [];
    for (const call of calls) {
      if (context.getCurrentSceneRevision() !== context.frozenWorld.sceneRevision) {
        return { status: "STALE_SCENE", commitAttempted: false };
      }
      const tool = this.options.registry.get(call.toolId);
      if (tool === undefined) return failed("UNKNOWN_TOOL");
      if (!tool.isAvailable(context)) {
        return notAllowed("TOOL_UNAVAILABLE");
      }
      let input: unknown;
      try {
        input = tool.inputSchema.parse(call.input, `tool.${call.toolId}.input`);
      } catch (error) {
        if (error instanceof NoteAgentValidationError) return failed("INVALID_TOOL_INPUT");
        return failed("INVALID_TOOL_INPUT");
      }
      let result: NoteToolResult;
      try {
        result = await tool.execute(input, context);
      } catch (error) {
        if (error instanceof NoteAgentValidationError) return failed("INVALID_TOOL_INPUT");
        return failed("TOOL_EXECUTION_FAILED");
      }
      if (result.status === "SUCCESS") {
        try {
          result = {
            ...result,
            data: tool.outputSchema.parse(
              result.data,
              `tool.${call.toolId}.output`,
            ),
          };
        } catch {
          return failed("INVALID_TOOL_OUTPUT");
        }
      }
      if (context.getCurrentSceneRevision() !== context.frozenWorld.sceneRevision) {
        return { status: "STALE_SCENE", commitAttempted: false };
      }
      steps.push({ stepId: call.stepId, toolId: call.toolId, result });
      if (result.status !== "SUCCESS") return mapToolFailure(result);
    }
    return { status: "SUCCESS", steps: Object.freeze(steps), commitAttempted: false };
  }
}

function mapToolFailure(result: Exclude<NoteToolResult, { status: "SUCCESS" }>): NoteRuntimeResult {
  switch (result.status) {
    case "AMBIGUOUS": return { ...result, commitAttempted: false };
    case "NEEDS_INPUT": return { ...result, commitAttempted: false };
    case "NOT_ALLOWED": return { ...result, commitAttempted: false };
    case "FAILED": return { ...result, commitAttempted: false };
    case "NOT_FOUND": return { status: "NOT_FOUND", commitAttempted: false };
    case "NO_FEASIBLE_PLACEMENT": return { status: "NO_FEASIBLE_PLACEMENT", commitAttempted: false };
    case "STALE_SCENE": return { status: "STALE_SCENE", commitAttempted: false };
  }
}

function failed(reasonCode: string): NoteRuntimeResult {
  return { status: "FAILED", reasonCode, commitAttempted: false };
}

function notAllowed(reasonCode: string): NoteRuntimeResult {
  return { status: "NOT_ALLOWED", reasonCode, commitAttempted: false };
}
