import type { InteractionClock } from "@ggulnote/interaction-core";
import {
  DirectAiProviderError,
  type CompletedVoiceTurn,
  type DirectCommandContext,
  type DirectCommandHistorySnapshot,
  type DirectCommandPlanningDiagnostics,
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
import {
  isRecoverableTargetResolution,
  type GroundedTargetRecoveryPort,
} from "./grounded-target-recovery";

export interface DirectCommandPlanningOptions {
  signal?: AbortSignal;
  historySnapshot?: DirectCommandHistorySnapshot;
  routeReceivedAt?: number;
}

export interface DirectCommandPlanningPipelineOptions {
  contextBuilder: DirectCommandContextBuilder;
  planner: DirectCommandPlannerProvider;
  resolver: FrozenTargetResolver;
  disambiguator?: DirectTargetDisambiguatorProvider;
  recovery?: GroundedTargetRecoveryPort;
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
      routeReceivedAt: options.routeReceivedAt ?? this.now(),
    };
    const diagnostics: DirectCommandPlanningDiagnostics = {
      disambiguationUsed: false,
      targetRecoveryUsed: false,
      guardStatus: "NOT_RUN",
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
        diagnostics,
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
      return this.aiError(
        turn.id,
        timestamps,
        error,
        options.signal,
        diagnostics,
      );
    }
    timestamps.plannerCompletedAt = this.now();
    diagnostics.plannerStatus = plannerResult.status;

    if (plannerResult.status !== "EXECUTABLE") {
      const terminal = terminalPlannerResult(
        plannerResult,
        timestamps,
        diagnostics,
      );
      if (terminal === null) {
        throw new Error("Unreachable executable planner result.");
      }
      return terminal;
    }
    const plan = plannerResult;
    Object.assign(diagnostics, {
      planId: plan.planId,
      capability: plan.command.capability,
      operation: plan.command.operation,
      relation: plan.relation,
      targetQueryKind: plan.command.target.kind,
    });
    if (isControlCommand(plan.command)) {
      return this.guardReady(
        context,
        plan,
        undefined,
        false,
        timestamps,
        diagnostics,
      );
    }

    const resolutionInput = toResolutionInput(context, plan.command.target);
    timestamps.resolverStartedAt = this.now();
    let resolution = await this.options.resolver.resolveAsync(resolutionInput, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    timestamps.resolverCompletedAt = this.now();
    diagnostics.resolutionStatus = resolution.status;
    diagnostics.initialResolutionStatus = resolution.status;
    if ("reasonCode" in resolution) {
      diagnostics.initialResolutionReason = resolution.reasonCode;
    }
    if (resolution.diagnostics !== undefined) {
      Object.assign(diagnostics, resolution.diagnostics);
    }

    if (resolution.status === "NOT_FOUND") {
      const recovery = this.options.recovery;
      if (
        recovery === undefined
        || !isRecoverableTargetResolution(resolutionInput, resolution)
      ) {
        diagnostics.finalResolutionStatus = resolution.status;
        return {
          status: "TARGET_NOT_FOUND",
          turnId: turn.id,
          timestamps,
          diagnostics,
        };
      }
      timestamps.recoveryRequestedAt = this.now();
      const attempt = await recovery.recover({
        context,
        plan,
        resolutionInput,
        initialResolution: resolution,
      }, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      timestamps.recoveryCompletedAt = this.now();
      diagnostics.targetRecoveryUsed = attempt.providerCalled;
      diagnostics.targetRecoveryKind = attempt.kind;
      diagnostics.recoveryCandidateCount = attempt.candidateCount;
      if (attempt.status === "ERROR") {
        diagnostics.recoveryResult = "ERROR";
        diagnostics.recoveryErrorCode = attempt.errorCode;
        diagnostics.finalResolutionStatus = "NOT_FOUND";
        if (attempt.errorCode === "RECOVERY_ABORTED") {
          return {
            status: "ERROR",
            turnId: turn.id,
            errorCode: "ABORTED",
            timestamps,
            diagnostics,
          };
        }
        return {
          status: "TARGET_NOT_FOUND",
          turnId: turn.id,
          timestamps,
          diagnostics,
        };
      }
      if (attempt.status !== "RESOLVED") {
        diagnostics.recoveryResult = attempt.status;
        diagnostics.finalResolutionStatus = "NOT_FOUND";
        return {
          status: "TARGET_NOT_FOUND",
          turnId: turn.id,
          timestamps,
          diagnostics,
        };
      }
      diagnostics.recoveryResult = "SELECTED";
      resolution = attempt.resolution;
    }
    let disambiguationUsed = false;
    if (resolution.status === "AMBIGUOUS") {
      diagnostics.candidateCount = resolution.candidates.length;
      const disambiguator = this.options.disambiguator;
      if (disambiguator === undefined) {
        return {
          status: "TARGET_AMBIGUOUS",
          turnId: turn.id,
          timestamps,
          diagnostics,
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
        return this.aiError(
          turn.id,
          timestamps,
          error,
          options.signal,
          diagnostics,
        );
      }
      timestamps.disambiguatorCompletedAt = this.now();
      disambiguationUsed = true;
      diagnostics.disambiguationUsed = true;
      if (selection.status === "NONE") {
        diagnostics.disambiguationResult = "NONE";
        return {
          status: "TARGET_AMBIGUOUS",
          turnId: turn.id,
          timestamps,
          diagnostics,
        };
      }
      diagnostics.disambiguationResult = "SELECTED";
      const selected = disambiguation.candidatesByLabel.get(
        selection.candidateLabel,
      );
      if (selected === undefined) {
        return {
          status: "ERROR",
          turnId: turn.id,
          errorCode: "PLANNER_INVALID_OUTPUT",
          timestamps,
          diagnostics,
        };
      }
      resolution = this.options.resolver.resolveRankedCandidate(
        resolutionInput,
        selected,
      );
      if (resolution.status !== "RESOLVED") {
        diagnostics.resolutionStatus = resolution.status;
        return {
          status: "TARGET_NOT_FOUND",
          turnId: turn.id,
          timestamps,
          diagnostics,
        };
      }
    }
    diagnostics.resolutionStatus = resolution.status;
    diagnostics.finalResolutionStatus = resolution.status;
    diagnostics.resolvedTargetKind = resolution.target.kind;
    diagnostics.resolverConfidence = resolution.confidence;

    return this.guardReady(
      context,
      plan,
      resolution,
      disambiguationUsed,
      timestamps,
      diagnostics,
    );
  }

  private guardReady(
    context: DirectCommandContext,
    plan: ExecutableDirectPlan,
    resolution: TargetResolutionResult | undefined,
    disambiguationUsed: boolean,
    timestamps: DirectCommandPlanningTimestamps,
    diagnostics: DirectCommandPlanningDiagnostics,
  ): DirectCommandPlanningResult {
    timestamps.validationStartedAt = this.now();
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
      diagnostics.guardStatus = "REJECTED";
      return {
        status: "ERROR",
        turnId: context.turn.id,
        errorCode: guarded.errorCode,
        timestamps,
        diagnostics,
      };
    }
    diagnostics.guardStatus = "PASSED";
    return {
      status: "READY_FOR_EXECUTION",
      turnId: context.turn.id,
      context,
      plan: guarded.plan,
      ...(guarded.target === undefined ? {} : { target: guarded.target }),
      disambiguationUsed,
      timestamps,
      diagnostics,
    };
  }

  private aiError(
    turnId: string,
    timestamps: DirectCommandPlanningTimestamps,
    error: unknown,
    signal: AbortSignal | undefined,
    diagnostics: DirectCommandPlanningDiagnostics,
  ): DirectCommandPlanningResult {
    const errorCode = error instanceof DirectAiProviderError
      ? error.code
      : signal?.aborted
        ? "ABORTED"
        : "PLANNER_ERROR";
    return { status: "ERROR", turnId, errorCode, timestamps, diagnostics };
  }

  private now(): number {
    return Number(this.options.clock.now());
  }
}

function terminalPlannerResult(
  result: DirectPlannerResult,
  timestamps: DirectCommandPlanningTimestamps,
  diagnostics: DirectCommandPlanningDiagnostics,
): DirectCommandPlanningResult | null {
  switch (result.status) {
    case "EXECUTABLE":
      return null;
    case "DEFER_SPATIAL":
      return {
        status: "DEFERRED_SPATIAL",
        turnId: result.turnId,
        timestamps,
        diagnostics,
      };
    case "NEEDS_CLARIFICATION":
      return {
        status: "NEEDS_CLARIFICATION",
        turnId: result.turnId,
        timestamps,
        diagnostics,
      };
    case "UNSUPPORTED":
      return {
        status: "UNSUPPORTED",
        turnId: result.turnId,
        timestamps,
        diagnostics,
      };
    case "CANCELLED":
      return {
        status: "CANCELLED",
        turnId: result.turnId,
        timestamps,
        diagnostics,
      };
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
    ...(context.speechGroundingEvidence === undefined
      ? {}
      : { speechGroundingEvidence: context.speechGroundingEvidence }),
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
