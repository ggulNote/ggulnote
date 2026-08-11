import type { DirectCommandContext, ResolvedTarget } from "./target-grounding-types";
import type { DirectCommandPlanningDiagnostics } from "./direct-command-diagnostics-types";
import type {
  DirectCommandRouteErrorCode,
  DirectCommandTurnId,
  ExecutableDirectPlan,
} from "./direct-command-types";

export interface DirectCommandPlanningTimestamps {
  routeReceivedAt: number;
  speechRefinerRequestedAt?: number;
  speechRefinerCompletedAt?: number;
  plannerRequestedAt?: number;
  plannerCompletedAt?: number;
  resolverStartedAt?: number;
  resolverCompletedAt?: number;
  disambiguatorRequestedAt?: number;
  disambiguatorCompletedAt?: number;
  recoveryRequestedAt?: number;
  recoveryCompletedAt?: number;
  validationStartedAt?: number;
  validatedAt?: number;
}

interface DirectCommandPlanningResultBase {
  turnId: DirectCommandTurnId;
  timestamps: DirectCommandPlanningTimestamps;
  diagnostics?: DirectCommandPlanningDiagnostics;
}

export type DirectCommandPlanningResult =
  | (DirectCommandPlanningResultBase & {
      status: "READY_FOR_EXECUTION";
      context: DirectCommandContext;
      plan: ExecutableDirectPlan;
      target?: ResolvedTarget;
      spatialAnchorTarget?: ResolvedTarget;
      disambiguationUsed: boolean;
    })
  | (DirectCommandPlanningResultBase & {
      status:
        | "DEFERRED_SPATIAL"
        | "NEEDS_CLARIFICATION"
        | "TARGET_NOT_FOUND"
        | "TARGET_AMBIGUOUS"
        | "UNSUPPORTED"
        | "CANCELLED";
    })
  | (DirectCommandPlanningResultBase & {
      status: "ERROR";
      errorCode: DirectCommandRouteErrorCode;
    });
