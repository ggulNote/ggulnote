import {
  DirectAiInputValidationError,
  DirectAiProviderError,
  DirectPlannerResultValidationError,
  DirectTargetDisambiguationValidationError,
  MultimodalPlacementValidationError,
  SpeechRefinementValidationError,
} from "../domain";
import { NoteAgentValidationError } from "../note-agent/domain";

export async function readDirectAiRouteInput(request: Request): Promise<unknown> {
  let value: unknown;
  try {
    value = await request.json() as unknown;
  } catch (error) {
    throw new DirectAiProviderError(
      "PLANNER_INVALID_OUTPUT",
      "INVALID_OUTPUT",
      { cause: error },
    );
  }
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "input")) {
    throw new DirectAiProviderError(
      "PLANNER_INVALID_OUTPUT",
      "INVALID_OUTPUT",
    );
  }
  return value.input;
}

export function directAiRouteErrorResponse(error: unknown): Response {
  const normalized = normalizeRouteError(error);
  return Response.json({
    error: { code: normalized.code, reason: normalized.reason },
  }, { status: httpStatusForError(normalized) });
}

function normalizeRouteError(error: unknown): DirectAiProviderError {
  if (error instanceof DirectAiProviderError) return error;
  if (
    error instanceof DirectAiInputValidationError
    || error instanceof DirectPlannerResultValidationError
    || error instanceof DirectTargetDisambiguationValidationError
    || error instanceof MultimodalPlacementValidationError
    || error instanceof SpeechRefinementValidationError
    || error instanceof NoteAgentValidationError
  ) {
    return new DirectAiProviderError(
      "PLANNER_INVALID_OUTPUT",
      "INVALID_OUTPUT",
      { cause: error },
    );
  }
  return new DirectAiProviderError(
    "PLANNER_UNAVAILABLE",
    "NETWORK_FAILURE",
    { cause: error },
  );
}

function httpStatusForError(error: DirectAiProviderError): number {
  switch (error.code) {
    case "PLANNER_INVALID_OUTPUT":
      return 502;
    case "PLANNER_TIMEOUT":
      return 504;
    case "ABORTED":
      return 408;
    case "PLANNER_UNAVAILABLE":
      return 503;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
