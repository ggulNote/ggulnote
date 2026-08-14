import { DirectAiProviderError } from "../../domain";
import type {
  CompletedVoiceTurn,
  DirectCommandContext,
  DirectEditorCommand,
  DirectCommandRouteResult,
} from "../../domain";
import type {
  DirectCommandContextBuilder,
  DirectCommandHistoryContext,
} from "../../application";
import type { CompletedVoiceTurnRoute } from "../../integration/direct-command-voice-turn-bridge";
import type { NoteDecisionProvider } from "../decision";
import { NoteContextAssembler } from "../context";
import type { NoteDecision, NoteDecisionInput, NoteToolId } from "../domain";
import type {
  FrozenWorldContext,
  UnifiedObjectWorld,
} from "../world";
import {
  AllEnabledActionsLoader,
  type NoteRuntimeContext,
  type NoteToolRegistry,
} from "../tools";
import { NoteRuntime, type NoteRuntimeResult } from "./note-runtime";
import {
  NoteAgentShadowTraceStore,
  type NoteAgentShadowTrace,
} from "./note-agent-trace";

export interface NoteAgentShadowRouteOptions {
  readonly contextBuilder: DirectCommandContextBuilder;
  readonly history: DirectCommandHistoryContext;
  readonly world: UnifiedObjectWorld;
  readonly registry: NoteToolRegistry;
  readonly runtime?: NoteRuntime;
  readonly contextAssembler?: NoteContextAssembler;
  readonly provider: NoteDecisionProvider;
  readonly createToolContext: (
    frozenWorld: FrozenWorldContext,
    turnId: string,
  ) => NoteRuntimeContext;
  readonly traces?: NoteAgentShadowTraceStore;
  readonly now?: () => number;
}

interface ShadowEvaluation {
  readonly trace: Omit<NoteAgentShadowTrace, "oldRouteStatus">;
}

export class NoteAgentShadowRoute {
  public readonly traces: NoteAgentShadowTraceStore;
  private readonly runtime: NoteRuntime;
  private readonly contextAssembler: NoteContextAssembler;
  private readonly now: () => number;

  public constructor(private readonly options: NoteAgentShadowRouteOptions) {
    this.runtime = options.runtime ?? new NoteRuntime({ registry: options.registry });
    this.contextAssembler = options.contextAssembler ?? new NoteContextAssembler({
      actionLoader: new AllEnabledActionsLoader(options.registry),
    });
    this.traces = options.traces ?? new NoteAgentShadowTraceStore();
    this.now = options.now ?? Date.now;
  }

  public async executeAlongside(
    turn: CompletedVoiceTurn,
    existingRoute: CompletedVoiceTurnRoute,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<DirectCommandRouteResult> {
    // Evaluation synchronously freezes its context before either provider can mutate.
    const shadow = this.evaluateSafely(turn, options);
    const oldResult = await existingRoute.execute(turn, options);
    const evaluation = await shadow;
    this.traces.record({ ...evaluation.trace, oldRouteStatus: oldResult.status });
    return oldResult;
  }

  public async execute(
    turn: CompletedVoiceTurn,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<NoteAgentShadowTrace> {
    const evaluation = await this.evaluateSafely(turn, options);
    this.traces.record(evaluation.trace);
    return evaluation.trace;
  }

  private async evaluateSafely(
    turn: CompletedVoiceTurn,
    options: { readonly signal?: AbortSignal },
  ): Promise<ShadowEvaluation> {
    const startedAt = this.now();
    try {
      return await this.evaluate(turn, options);
    } catch (error) {
      return {
        trace: {
          ...baseFailureTrace(
            turn,
            startedAt,
            this.now(),
            "CONTEXT_FAILED",
            "SHADOW_EVALUATION_FAILED",
          ),
          errorCode: decisionErrorCode(error),
        },
      };
    }
  }

  private async evaluate(
    turn: CompletedVoiceTurn,
    options: { readonly signal?: AbortSignal },
  ): Promise<ShadowEvaluation> {
    const startedAt = this.now();
    const contextResult = this.options.contextBuilder.build(turn, {
      historySnapshot: this.options.history.snapshot(),
    });
    if (contextResult.status !== "READY") {
      return {
        trace: baseFailureTrace(turn, startedAt, this.now(), "CONTEXT_FAILED", contextResult.errorCode),
      };
    }
    const directContext = contextResult.context;
    const documentId = directContext.pageTargetCatalog.documentId;
    if (
      documentId === undefined
      || this.options.world.getSnapshot(
        directContext.frozenContext.pageId,
        directContext.frozenContext.sceneRevision,
      ) === undefined
    ) {
      return {
        trace: baseFailureTrace(turn, startedAt, this.now(), "CONTEXT_FAILED", "STALE_SCENE"),
      };
    }
    const frozenWorld = buildFrozenWorldContext(documentId, directContext);
    const toolContext = this.options.createToolContext(frozenWorld, turn.id);
    const decisionInput = (await this.contextAssembler.assemble({
      turn,
      documentId,
      frozenWorld,
      world: this.options.world,
      toolContext,
    })).decisionInput;

    const decisionStartedAt = this.now();
    let decision;
    try {
      decision = await this.options.provider.decide(decisionInput, options);
    } catch (error) {
      const completedAt = this.now();
      return {
        trace: {
          ...traceIdentity(turn),
          shadowMode: true,
          resultStatus: "DECISION_FAILED",
          errorCode: decisionErrorCode(error),
          llmCallCount: 1,
          toolCallCount: 0,
          decisionMs: elapsed(decisionStartedAt, completedAt),
          runtimeMs: 0,
          totalMs: elapsed(startedAt, completedAt),
          commitAttempted: false,
          recordedAt: completedAt,
        },
      };
    }

    const runtimeStartedAt = this.now();
    const result = await this.runtime.execute(decision, toolContext);
    const completedAt = this.now();
    return {
      trace: {
        ...traceIdentity(turn),
        shadowMode: true,
        decision,
        ...primaryTool(decision),
        ...resultDiagnostics(result),
        resultStatus: result.status,
        llmCallCount: 1,
        toolCallCount: decision.status === "CALL"
          ? 1
          : decision.status === "BATCH"
            ? decision.steps.length
            : 0,
        decisionMs: elapsed(decisionStartedAt, runtimeStartedAt),
        runtimeMs: elapsed(runtimeStartedAt, completedAt),
        totalMs: elapsed(startedAt, completedAt),
        commitAttempted: false,
        recordedAt: completedAt,
      },
    };
  }
}

export function buildFrozenWorldContext(
  documentId: string,
  context: DirectCommandContext,
): FrozenWorldContext {
  const focus = context.frozenContext.focusObjectId === undefined
    ? undefined
    : { kind: "OBJECT" as const, objectId: context.frozenContext.focusObjectId };
  return {
    documentId,
    pageId: context.frozenContext.pageId,
    sceneRevision: context.frozenContext.sceneRevision,
    frozenVoiceContext: context.frozenContext,
    catalog: context.pageTargetCatalog,
    recentOperations: context.recentOperations,
    directContext: context,
    ...(focus === undefined ? {} : { focus }),
    ...(focus === undefined || context.frozenContext.focusSource !== "selection"
      ? {}
      : { selection: focus }),
    ...(context.historySnapshot?.lastReusableTarget === null
      || context.historySnapshot?.lastReusableTarget === undefined
      ? {}
      : { lastReusableTarget: context.historySnapshot.lastReusableTarget }),
  };
}

export function buildDecisionInput(
  documentId: string,
  context: DirectCommandContext,
  availableTools: NoteDecisionInput["availableTools"],
): NoteDecisionInput {
  const focus = context.plannerContext.frozenContext.focus;
  const last = context.historySnapshot?.lastSuccessfulOperation;
  return {
    turn: {
      turnId: context.turn.id,
      language: context.turn.language,
      rawFinalTranscript: context.turn.rawTranscript,
    },
    frozenContext: {
      documentId,
      pageId: context.frozenContext.pageId,
      sceneRevision: context.frozenContext.sceneRevision,
      sceneMode: context.frozenContext.sceneMode,
      ...(focus === null
        ? {}
        : {
            focus: {
              kind: focus.kind,
              ...(focus.text === undefined ? {} : { textPreview: focus.text }),
            },
          }),
      ...(focus === null || context.frozenContext.focusSource !== "selection"
        ? {}
        : {
            selection: {
              kind: focus.kind,
              ...(focus.text === undefined ? {} : { textPreview: focus.text }),
            },
          }),
      ...(last === null || last === undefined
        ? {}
        : {
            lastOperation: {
              toolId: noteToolIdFor(last.command),
              outputKind: last.target.kind === "grounded" ? last.target.type : last.target.kind,
              ...(last.target.kind !== "grounded" || last.target.textSummary === undefined
                ? {}
                : { summary: last.target.textSummary }),
            },
          }),
    },
    availableTools,
  };
}

function noteToolIdFor(command: DirectEditorCommand): NoteToolId {
  if (command.capability === "text" && command.operation === "replace_content") {
    return "text.replace";
  }
  if (command.capability === "annotation") return "annotation.apply";
  return `${command.capability}.${command.operation}` as NoteToolId;
}

function primaryTool(decision: NoteDecision): {
  readonly toolId?: NoteToolId;
} {
  const toolId = decision.status === "CALL"
    ? decision.call.toolId
    : decision.status === "BATCH"
      ? decision.steps[0]?.toolId
      : undefined;
  return toolId === undefined ? {} : { toolId };
}

function resultDiagnostics(result: NoteRuntimeResult): {
  readonly resolverStatus?: string;
  readonly placementStatus?: string;
} {
  if (result.status !== "SUCCESS") {
    return result.status === "NO_FEASIBLE_PLACEMENT"
      ? { placementStatus: result.status }
      : { resolverStatus: result.status };
  }
  const placement = result.steps.some((step) =>
    step.result.status === "SUCCESS"
    && typeof step.result.data === "object"
    && step.result.data !== null
    && "placement" in step.result.data);
  return {
    resolverStatus: "RESOLVED",
    ...(placement ? { placementStatus: "RESOLVED" } : {}),
  };
}

function baseFailureTrace(
  turn: CompletedVoiceTurn,
  startedAt: number,
  completedAt: number,
  resultStatus: "CONTEXT_FAILED",
  errorCode: string,
): Omit<NoteAgentShadowTrace, "oldRouteStatus"> {
  return {
    ...traceIdentity(turn),
    shadowMode: true,
    resultStatus,
    errorCode,
    llmCallCount: 0,
    toolCallCount: 0,
    decisionMs: 0,
    runtimeMs: 0,
    totalMs: elapsed(startedAt, completedAt),
    commitAttempted: false,
    recordedAt: completedAt,
  };
}

function traceIdentity(turn: CompletedVoiceTurn) {
  return {
    turnId: turn.id,
    pageId: turn.frozenContext.pageId,
    sceneRevision: turn.frozenContext.sceneRevision,
  };
}

function decisionErrorCode(error: unknown): string {
  if (error instanceof DirectAiProviderError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "ABORTED";
  return "DECISION_FAILED";
}

function elapsed(start: number, end: number): number {
  return Math.max(0, end - start);
}
