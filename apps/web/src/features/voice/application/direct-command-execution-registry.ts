import type {
  DirectCommandRouteResult,
  DirectCommandTurnId,
} from "../domain";

const DEFAULT_MAX_COMPLETED_TURNS = 128;

export interface DirectCommandExecutionRegistryOptions {
  maxCompletedTurns?: number;
}

export class DirectCommandExecutionRegistry {
  private readonly maxCompletedTurns: number;
  private readonly inFlight = new Map<
    DirectCommandTurnId,
    Promise<DirectCommandRouteResult>
  >();
  private readonly completed = new Map<
    DirectCommandTurnId,
    DirectCommandRouteResult
  >();

  public constructor(options: DirectCommandExecutionRegistryOptions = {}) {
    const maxCompletedTurns = options.maxCompletedTurns
      ?? DEFAULT_MAX_COMPLETED_TURNS;
    if (!Number.isInteger(maxCompletedTurns) || maxCompletedTurns <= 0) {
      throw new RangeError("maxCompletedTurns must be a positive integer.");
    }
    this.maxCompletedTurns = maxCompletedTurns;
  }

  public execute(
    turnId: DirectCommandTurnId,
    action: () => Promise<DirectCommandRouteResult>,
  ): Promise<DirectCommandRouteResult> {
    const completed = this.completed.get(turnId);
    if (completed !== undefined) {
      return Promise.resolve(completed);
    }
    const existing = this.inFlight.get(turnId);
    if (existing !== undefined) {
      return existing;
    }

    const pending = this.run(turnId, action);
    this.inFlight.set(turnId, pending);
    return pending;
  }

  public hasInFlight(turnId: DirectCommandTurnId): boolean {
    return this.inFlight.has(turnId);
  }

  public hasCompleted(turnId: DirectCommandTurnId): boolean {
    return this.completed.has(turnId);
  }

  public clear(): void {
    this.inFlight.clear();
    this.completed.clear();
  }

  private async run(
    turnId: DirectCommandTurnId,
    action: () => Promise<DirectCommandRouteResult>,
  ): Promise<DirectCommandRouteResult> {
    try {
      const result = await action();
      if (isConsumedResult(result)) {
        this.completed.set(turnId, result);
        this.trimCompleted();
      }
      return result;
    } finally {
      this.inFlight.delete(turnId);
    }
  }

  private trimCompleted(): void {
    while (this.completed.size > this.maxCompletedTurns) {
      const oldest = this.completed.keys().next().value as
        | DirectCommandTurnId
        | undefined;
      if (oldest === undefined) return;
      this.completed.delete(oldest);
    }
  }
}

function isConsumedResult(result: DirectCommandRouteResult): boolean {
  if (result.status !== "ERROR") return true;
  return result.errorCode !== "PLANNER_ERROR"
    && result.errorCode !== "PLANNER_UNAVAILABLE"
    && result.errorCode !== "PLANNER_TIMEOUT"
    && result.errorCode !== "ABORTED";
}
