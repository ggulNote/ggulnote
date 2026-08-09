import type { InteractionClock } from "@ggulnote/interaction-core";
import {
  DirectAiProviderError,
  type CompletedVoiceTurn,
  type DirectCommandContext,
  type DirectCommandHistorySnapshot,
  type DirectCommandPlanningResult,
  type DirectCommandPlanningTimestamps,
  type DirectEditorCommand,
  type DirectPlannerResult,
  type ExecutableDirectPlan,
  type TargetQuery,
  type TargetResolutionInput,
  type TargetResolutionResult,
} from "../domain";
import type {
  DirectCommandPlannerProvider,
  DirectTargetDisambiguatorProvider,
} from "../providers";
import { DirectCommandContextBuilder } from "./direct-command-context-builder";
import { guardDirectCommandPlan } from "./direct-command-guard";
import { buildDirectTargetDisambiguationContext } from "./direct-target-disambiguation-context";
import { FrozenTargetResolver } from "./frozen-target-resolver";

export interface DirectCommandPlanningOptions {
  signal?: AbortSignal;
  historySnapshot?: DirectCommandHistorySnapshot;
}

export interface DirectCommandPlanningPipelineOptions {
  contextBuilder: DirectCommandContextBuilder;
  planner: DirectCommandPlannerProvider;
  resolver: FrozenTargetResolver;
  disambiguator?: DirectTargetDisambiguatorProvider;
  clock: Pick<InteractionClock, "now">;
  getCurrentSceneRevision: () => number;
}

export class DirectCommandPlanningPipeline {
  public constructor(private readonly options: DirectCommandPlanningPipelineOptions) {}

  public async plan(
    turn: CompletedVoiceTurn,
    options: DirectCommandPlanningOptions = {},
  ): Promise<DirectCommandPlanningResult> {
    const timestamps: DirectCommandPlanningTimestamps = {
      routeReceivedAt: this.now(),
    };
    const built = this.options.contextBuilder.build(turn, {
      ...(options.historySnapshot === undefined
        ? {}
        : { historySnapshot: options.historySnapshot }),
    });
    if (built.status === "ERROR") {
      return {
        status: "ERROR",
        turnId: turn.id,
        errorCode: built.errorCode,
        timestamps,
      };
    }
    const context = built.context;

    let plannerResult: DirectPlannerResult;
    timestamps.plannerRequestedAt = this.now();
    try {
      plannerResult = await this.options.planner.plan(
        context.plannerContext,
        options,
      );
    } catch (error) {
      timestamps.plannerCompletedAt = this.now();
      return this.aiError(turn.id, timestamps, error, options.signal);
    }
    timestamps.plannerCompletedAt = this.now();

    if (plannerResult.status !== "EXECUTABLE") {
      const terminal = terminalPlannerResult(plannerResult, timestamps);
      if (terminal === null) throw new Error("Unreachable executable planner result.");
      return terminal;
    }
    const plan = plannerResult;
    if (isControlCommand(plan.command)) {
      return this.guardReady(context, plan, undefined, false, timestamps);
    }

    const resolutionInput = toResolutionInput(context, plan.command.target);
    timestamps.resolverStartedAt = this.now();
    let resolution = this.options.resolver.resolve(resolutionInput);
    timestamps.resolverCompletedAt = this.now();

    if (resolution.status === "NOT_FOUND") {
      return {
        status: "TARGET_NOT_FOUND",
        turnId: turn.id,
        timestamps,
      };
    }
    let disambiguationUsed = false;
    if (resolution.status === "AMBIGUOUS") {
      const disambiguator = this.options.disambiguator;
      if (disambiguator === undefined) {
        return {
          status: "TARGET_AMBIGUOUS",
          turnId: turn.id,
          timestamps,
        };
      }
      const disambiguation = buildDirectTargetDisambiguationContext(
        context,
        plan,
        plan.command.target,
        resolution.candidates,
      );
      timestamps.disambiguatorRequestedAt = this.now();
      let selection;
      try {
        selection = await disambiguator.disambiguate(
          disambiguation.input,
          options,
        );
      } catch (error) {
        timestamps.disambiguatorCompletedAt = this.now();
        return this.aiError(turn.id, timestamps, error, options.signal);
      }
      timestamps.disambiguatorCompletedAt = this.now();
      disambiguationUsed = true;
      if (selection.status === "NONE") {
        return {
          status: "TARGET_AMBIGUOUS",
          turnId: turn.id,
          timestamps,
        };
      }
      const selected = disambiguation.candidatesByLabel.get(
        selection.candidateLabel,
      );
      if (selected === undefined) {
        return {
          status: "ERROR",
          turnId: turn.id,
          errorCode: "PLANNER_INVALID_OUTPUT",
          timestamps,
        };
      }
      resolution = this.options.resolver.resolveRankedCandidate(
        resolutionInput,
        selected,
      );
      if (resolution.status !== "RESOLVED") {
        return {
          status: "TARGET_NOT_FOUND",
          turnId: turn.id,
          timestamps,
        };
      }
    }

    return this.guardReady(
      context,
      plan,
      resolution,
      disambiguationUsed,
      timestamps,
    );
  }

  private guardReady(
    context: DirectCommandContext,
    plan: ExecutableDirectPlan,
    resolution: TargetResolutionResult | undefined,
    disambiguationUsed: boolean,
    timestamps: DirectCommandPlanningTimestamps,
  ): DirectCommandPlanningResult {
    const guarded = guardDirectCommandPlan({
      result: plan,
      expectedTurnId: context.turn.id,
      frozenContext: context.frozenContext,
      catalog: context.pageTargetCatalog,
      currentSceneRevision: this.options.getCurrentSceneRevision(),
      ...(resolution === undefined ? {} : { resolution }),
      allowedCommands: context.plannerContext.allowedCommands,
    });
    timestamps.validatedAt = this.now();
    if (guarded.status === "REJECTED") {
      return {
        status: "ERROR",
        turnId: context.turn.id,
        errorCode: guarded.errorCode,
        timestamps,
      };
    }
    return {
      status: "READY_FOR_EXECUTION",
      turnId: context.turn.id,
      context,
      plan: guarded.plan,
      ...(guarded.target === undefined ? {} : { target: guarded.target }),
      disambiguationUsed,
      timestamps,
    };
  }

  private aiError(
    turnId: string,
    timestamps: DirectCommandPlanningTimestamps,
    error: unknown,
    signal: AbortSignal | undefined,
  ): DirectCommandPlanningResult {
    const errorCode = error instanceof DirectAiProviderError
      ? error.code
      : signal?.aborted
        ? "ABORTED"
        : "PLANNER_ERROR";
    return { status: "ERROR", turnId, errorCode, timestamps };
  }

  private now(): number {
    return Number(this.options.clock.now());
  }
}

function terminalPlannerResult(
  result: DirectPlannerResult,
  timestamps: DirectCommandPlanningTimestamps,
): DirectCommandPlanningResult | null {
  switch (result.status) {
    case "EXECUTABLE":
      return null;
    case "DEFER_SPATIAL":
      return { status: "DEFERRED_SPATIAL", turnId: result.turnId, timestamps };
    case "NEEDS_CLARIFICATION":
      return { status: "NEEDS_CLARIFICATION", turnId: result.turnId, timestamps };
    case "UNSUPPORTED":
      return { status: "UNSUPPORTED", turnId: result.turnId, timestamps };
    case "CANCELLED":
      return { status: "CANCELLED", turnId: result.turnId, timestamps };
  }
}

function toResolutionInput(
  context: DirectCommandContext,
  query: TargetQuery,
): TargetResolutionInput {
  return {
    query,
    catalog: context.pageTargetCatalog,
    frozenContext: context.frozenContext,
    recentOperations: context.recentOperations,
    ...(context.historySnapshot?.lastReusableTarget === null
      || context.historySnapshot?.lastReusableTarget === undefined
      ? {}
      : {
          lastReusableTarget: context.historySnapshot.lastReusableTarget,
        }),
  };
}

function isControlCommand(
  command: DirectEditorCommand,
): command is Extract<
  DirectEditorCommand,
  { capability: "navigation" | "history" }
> {
  return command.capability === "navigation" || command.capability === "history";
}
