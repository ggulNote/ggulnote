import type {
  DirectCommandName,
  DirectCommandRouteErrorCode,
  DirectEditorCommand,
  DirectPlannerResult,
  ExecutableDirectPlan,
  FrozenVoiceTurnContext,
  PageTargetCatalog,
  ResolvedTarget,
  TargetResolutionResult,
} from "../domain";
import {
  DIRECT_COMMAND_NAMES,
  parseDirectPlannerResult,
} from "../domain";

export interface DirectCommandGuardInput {
  result: DirectPlannerResult;
  expectedTurnId: string;
  frozenContext: FrozenVoiceTurnContext;
  catalog: PageTargetCatalog;
  currentSceneRevision: number;
  resolution?: TargetResolutionResult;
  allowedCommands?: readonly DirectCommandName[];
}

export type DirectCommandGuardResult =
  | {
      status: "ALLOWED";
      plan: ExecutableDirectPlan;
      target?: ResolvedTarget;
    }
  | {
      status: "REJECTED";
      errorCode: DirectCommandRouteErrorCode;
    };

export function guardDirectCommandPlan(
  input: DirectCommandGuardInput,
): DirectCommandGuardResult {
  let result: DirectPlannerResult;
  try {
    result = parseDirectPlannerResult(input.result);
  } catch {
    return reject("INVALID_PLAN");
  }
  if (result.status !== "EXECUTABLE") {
    return reject(
      result.status === "DEFER_SPATIAL"
        ? "SPATIAL_REQUIRED"
        : result.status === "UNSUPPORTED"
          ? "UNSUPPORTED_COMMAND"
          : "INVALID_PLAN",
    );
  }

  if (result.turnId !== input.expectedTurnId) {
    return reject("INVALID_PLAN");
  }
  if (
    result.sceneRevision !== input.frozenContext.sceneRevision
    || input.catalog.sceneRevision !== input.frozenContext.sceneRevision
    || input.catalog.pageId !== input.frozenContext.pageId
    || input.currentSceneRevision !== input.frozenContext.sceneRevision
  ) {
    return reject("STALE_SCENE");
  }

  const commandName = directCommandName(result.command);
  const allowed = new Set(input.allowedCommands ?? DIRECT_COMMAND_NAMES);
  if (commandName === null || !allowed.has(commandName)) {
    return reject("UNSUPPORTED_COMMAND");
  }
  if (isControlCommand(result.command)) {
    return { status: "ALLOWED", plan: result };
  }

  const resolution = input.resolution;
  if (resolution === undefined) {
    return reject("INVALID_TARGET");
  }
  if (resolution.status === "AMBIGUOUS") {
    return reject("TARGET_AMBIGUOUS");
  }
  if (resolution.status === "NOT_FOUND") {
    return reject(
      resolution.reasonCode === "SUBRANGE_UNSUPPORTED"
      || resolution.reasonCode === "TARGET_KIND_UNSUPPORTED"
        ? "TARGET_KIND_UNSUPPORTED"
        : "TARGET_NOT_FOUND",
    );
  }
  const target = resolution.target;
  if (
    target.pageId !== input.frozenContext.pageId
    || target.sceneRevision !== input.frozenContext.sceneRevision
  ) {
    return reject("STALE_SCENE");
  }
  const catalogCandidate = input.catalog.candidates.find(
    (candidate) => candidate.candidateId === target.candidateId,
  );
  if (
    catalogCandidate === undefined
    || (
      target.objectId !== undefined
      && catalogCandidate.sceneObjectId !== target.objectId
    )
  ) {
    return reject("INVALID_TARGET");
  }

  if (
    result.command.capability === "annotation"
    && !target.annotatable
  ) {
    return reject("TARGET_NOT_ANNOTATABLE");
  }
  if (result.command.capability === "text") {
    if (target.source === "pdf" || !target.editable) {
      return reject("TARGET_NOT_EDITABLE");
    }
    if (target.source !== "ggulnote" || target.type !== "text") {
      return reject("TARGET_KIND_UNSUPPORTED");
    }
  }
  return { status: "ALLOWED", plan: result, target };
}

function directCommandName(
  command: DirectEditorCommand,
): DirectCommandName | null {
  const name = `${command.capability}.${command.operation}`;
  return (DIRECT_COMMAND_NAMES as readonly string[]).includes(name)
    ? name as DirectCommandName
    : null;
}

function isControlCommand(
  command: DirectEditorCommand,
): command is Extract<
  DirectEditorCommand,
  { capability: "navigation" | "history" }
> {
  return command.capability === "navigation" || command.capability === "history";
}

function reject(
  errorCode: DirectCommandRouteErrorCode,
): DirectCommandGuardResult {
  return { status: "REJECTED", errorCode };
}
