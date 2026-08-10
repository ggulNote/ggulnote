import type { DirectCommandRouteErrorCode } from "./direct-command-types";

export type DirectAiProviderErrorCode = Extract<
  DirectCommandRouteErrorCode,
  | "PLANNER_UNAVAILABLE"
  | "PLANNER_TIMEOUT"
  | "PLANNER_INVALID_OUTPUT"
  | "ABORTED"
>;

export type DirectAiProviderErrorReason =
  | "MISSING_CONFIGURATION"
  | "NETWORK_FAILURE"
  | "HTTP_FAILURE"
  | "TIMEOUT"
  | "ABORTED"
  | "INVALID_OUTPUT";

export class DirectAiProviderError extends Error {
  public constructor(
    public readonly code: DirectAiProviderErrorCode,
    public readonly reason: DirectAiProviderErrorReason,
    options?: { cause?: unknown; httpStatus?: number },
  ) {
    super(messageForReason(reason), { cause: options?.cause });
    this.name = "DirectAiProviderError";
    this.httpStatus = options?.httpStatus;
  }

  public readonly httpStatus?: number;
}

export function normalizeDirectAiProviderError(
  error: unknown,
): DirectAiProviderError {
  if (error instanceof DirectAiProviderError) return error;
  if (isAbortError(error)) {
    return new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
  }
  return new DirectAiProviderError(
    "PLANNER_UNAVAILABLE",
    "NETWORK_FAILURE",
    { cause: error },
  );
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function messageForReason(reason: DirectAiProviderErrorReason): string {
  switch (reason) {
    case "MISSING_CONFIGURATION":
      return "Direct command AI provider configuration is unavailable.";
    case "NETWORK_FAILURE":
      return "Direct command AI provider network request failed.";
    case "HTTP_FAILURE":
      return "Direct command AI provider returned an HTTP error.";
    case "TIMEOUT":
      return "Direct command AI provider request timed out.";
    case "ABORTED":
      return "Direct command AI provider request was aborted.";
    case "INVALID_OUTPUT":
      return "Direct command AI provider returned invalid output.";
  }
}
