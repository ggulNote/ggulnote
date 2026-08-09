import type {
  CompletedVoiceTurn,
  DirectCommandExecutionResult,
  DirectCommandPlanningResult,
  DirectCommandRouteResult,
  DirectOperationRecord,
  DirectReusableTargetRecord,
  ReadyForDirectCommandExecution,
  ResolvedTarget,
  TargetQuery,
} from "../domain";
import { DirectCommandExecutionRegistry } from "./direct-command-execution-registry";
import { DirectCommandHistoryContext } from "./direct-command-history-context";
import type { DirectCommandPlanningOptions } from "./direct-command-planning-pipeline";

export interface DirectCommandPlanningPort {
  plan(
    turn: CompletedVoiceTurn,
    options?: DirectCommandPlanningOptions,
  ): Promise<DirectCommandPlanningResult>;
}

export interface DirectCommandExecutionPort {
  execute(
    ready: ReadyForDirectCommandExecution,
  ): Promise<DirectCommandExecutionResult>;
  revise(
    ready: ReadyForDirectCommandExecution,
    previous: DirectOperationRecord,
  ): Promise<DirectCommandExecutionResult>;
}

export interface DirectCommandRouteOptions {
  planning: DirectCommandPlanningPort;
  executor: DirectCommandExecutionPort;
  history: DirectCommandHistoryContext;
  registry?: DirectCommandExecutionRegistry;
}

export interface DirectCommandRouteExecuteOptions {
  signal?: AbortSignal;
}

export class DirectCommandRoute {
  private readonly registry: DirectCommandExecutionRegistry;

  public constructor(private readonly options: DirectCommandRouteOptions) {
    this.registry = options.registry ?? new DirectCommandExecutionRegistry();
  }

  public execute(
    turn: CompletedVoiceTurn,
    executeOptions: DirectCommandRouteExecuteOptions = {},
  ): Promise<DirectCommandRouteResult> {
    return this.registry.execute(
      turn.id,
      () => this.executeOnce(turn, executeOptions),
    );
  }

  public getLastOperation(): DirectOperationRecord | null {
    return this.options.history.getLastSuccessfulOperation();
  }

  public getLastReusableTarget(): DirectReusableTargetRecord | null {
    return this.options.history.getLastReusableTarget();
  }

  public dispose(): void {
    this.registry.clear();
    this.options.history.clear();
  }

  private async executeOnce(
    turn: CompletedVoiceTurn,
    executeOptions: DirectCommandRouteExecuteOptions,
  ): Promise<DirectCommandRouteResult> {
    const historySnapshot = this.options.history.snapshot();
    let planning: DirectCommandPlanningResult;
    try {
      planning = await this.options.planning.plan(turn, {
        ...(executeOptions.signal === undefined
          ? {}
          : { signal: executeOptions.signal }),
        historySnapshot,
      });
    } catch {
      return {
        status: "ERROR",
        turnId: turn.id,
        errorCode: executeOptions.signal?.aborted
          ? "ABORTED"
          : "PLANNER_ERROR",
      };
    }
    if (planning.status !== "READY_FOR_EXECUTION") {
      return terminalPlanningResult(planning);
    }

    switch (planning.plan.relation) {
      case "NEW":
        return this.executeNew(planning);
      case "CONTINUE":
        return this.executeContinue(
          planning,
          historySnapshot.lastReusableTarget,
        );
      case "REVISE_LAST":
        return this.executeRevision(
          planning,
          historySnapshot.lastSuccessfulOperation,
          historySnapshot.lastReusableTarget,
        );
    }
  }

  private async executeNew(
    ready: ReadyForDirectCommandExecution,
  ): Promise<DirectCommandRouteResult> {
    let result;
    try {
      result = await this.options.executor.execute(ready);
    } catch {
      return error(ready, "COMMIT_FAILED");
    }
    if (result.status !== "ERROR") {
      this.options.history.recordSuccessfulExecution(ready, result);
    }
    return result;
  }

  private async executeContinue(
    ready: ReadyForDirectCommandExecution,
    previousTarget: DirectReusableTargetRecord | null,
  ): Promise<DirectCommandRouteResult> {
    if (
      previousTarget === null
      || ready.target === undefined
      || !isReusableCommand(ready)
      || !isLastTargetQuery(ready.plan.command.target)
    ) {
      return error(ready, "TARGET_NOT_FOUND");
    }
    if (!sameReusableTarget(previousTarget, ready.target)) {
      return error(ready, "INVALID_TARGET");
    }

    const executable = asNewExecution(ready);
    let result;
    try {
      result = await this.options.executor.execute(executable);
    } catch {
      return error(ready, "COMMIT_FAILED");
    }
    if (result.status !== "ERROR") {
      this.options.history.recordSuccessfulExecution(ready, result);
    }
    return result;
  }

  private async executeRevision(
    ready: ReadyForDirectCommandExecution,
    previous: DirectOperationRecord | null,
    previousTarget: DirectReusableTargetRecord | null,
  ): Promise<DirectCommandRouteResult> {
    if (
      previous === null
      || previousTarget === null
      || previous.target.kind !== "grounded"
      || ready.target === undefined
      || !isReusableCommand(ready)
      || !isLastTargetQuery(ready.plan.command.target)
      || !isSupportedRevision(previous, ready)
    ) {
      return error(ready, "REVISE_NOT_AVAILABLE");
    }
    if (
      !sameReusableTarget(previousTarget, ready.target)
      || !sameReusableTarget(previous.target, ready.target)
    ) {
      return error(ready, "INVALID_TARGET");
    }

    let execution;
    try {
      execution = await this.options.executor.revise(ready, previous);
    } catch {
      return error(ready, "COMMIT_FAILED");
    }
    if (execution.status === "ERROR") {
      return execution;
    }
    if (execution.status !== "COMMITTED") {
      return error(ready, "REVISE_NOT_AVAILABLE");
    }
    const revised: Extract<DirectCommandRouteResult, { status: "REVISED" }> = {
      status: "REVISED",
      turnId: execution.turnId,
      planId: execution.planId,
      operationId: execution.operationId,
      ...(execution.annotationId === undefined
        ? {}
        : { annotationId: execution.annotationId }),
    };
    this.options.history.recordSuccessfulExecution(ready, revised);
    return revised;
  }
}

function terminalPlanningResult(
  planning: Exclude<
    DirectCommandPlanningResult,
    { status: "READY_FOR_EXECUTION" }
  >,
): DirectCommandRouteResult {
  switch (planning.status) {
    case "DEFERRED_SPATIAL":
    case "NEEDS_CLARIFICATION":
    case "TARGET_NOT_FOUND":
    case "TARGET_AMBIGUOUS":
    case "UNSUPPORTED":
    case "CANCELLED":
      return { status: planning.status, turnId: planning.turnId };
    case "ERROR":
      return {
        status: "ERROR",
        turnId: planning.turnId,
        errorCode: planning.errorCode,
      };
  }
}

function isReusableCommand(
  ready: ReadyForDirectCommandExecution,
): boolean {
  return ready.plan.command.capability === "annotation"
    || ready.plan.command.capability === "text";
}

function isLastTargetQuery(
  target: ReadyForDirectCommandExecution["plan"]["command"]["target"],
): target is TargetQuery {
  return (target.kind === "relative" || target.kind === "object")
    && target.relation === "last_target";
}

function isSupportedRevision(
  previous: DirectOperationRecord,
  ready: ReadyForDirectCommandExecution,
): boolean {
  const command = ready.plan.command;
  return (
    command.capability === "annotation"
    && command.operation === "highlight"
    && previous.command.capability === "annotation"
    && previous.command.operation === "highlight"
  ) || (
    command.capability === "text"
    && previous.command.capability === "text"
  );
}

function sameReusableTarget(
  previous: DirectReusableTargetRecord,
  current: ResolvedTarget,
): boolean {
  return previous.candidateId === current.candidateId
    && previous.pageId === current.pageId
    && previous.source === current.source
    && previous.type === current.type
    && previous.objectId === current.objectId;
}

function asNewExecution(
  ready: ReadyForDirectCommandExecution,
): ReadyForDirectCommandExecution {
  return {
    ...ready,
    plan: {
      ...ready.plan,
      relation: "NEW",
    },
  };
}

function error(
  ready: ReadyForDirectCommandExecution,
  errorCode: Extract<
    DirectCommandRouteResult,
    { status: "ERROR" }
  >["errorCode"],
): DirectCommandRouteResult {
  return { status: "ERROR", turnId: ready.turnId, errorCode };
}
