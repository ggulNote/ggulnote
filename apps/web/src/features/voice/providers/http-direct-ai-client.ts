import {
  DirectAiProviderError,
  isAbortError,
  type DirectAiProviderErrorCode,
  type DirectAiProviderErrorReason,
} from "../domain";

export type DirectAiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function postDirectAiRequest(
  endpoint: string,
  input: unknown,
  fetchImpl: DirectAiFetch,
  signal?: AbortSignal,
): Promise<unknown> {
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
      ...(signal === undefined ? {} : { signal }),
    });
    throwIfAborted(signal);
  } catch (error) {
    if (error instanceof DirectAiProviderError) throw error;
    if (isAbortError(error) || signal?.aborted) {
      throw new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
    }
    throw new DirectAiProviderError(
      "PLANNER_UNAVAILABLE",
      "NETWORK_FAILURE",
      { cause: error },
    );
  }

  const body = await readJson(response, signal);
  throwIfAborted(signal);
  if (!response.ok) {
    const normalized = readNormalizedServerError(body);
    if (normalized !== null) throw normalized;
    throw new DirectAiProviderError(
      "PLANNER_UNAVAILABLE",
      "HTTP_FAILURE",
      { httpStatus: response.status },
    );
  }
  if (!isRecord(body) || Object.keys(body).some((key) => key !== "result")) {
    throw new DirectAiProviderError(
      "PLANNER_INVALID_OUTPUT",
      "INVALID_OUTPUT",
    );
  }
  return body.result;
}

async function readJson(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  try {
    const value = await response.json() as unknown;
    throwIfAborted(signal);
    return value;
  } catch (error) {
    if (error instanceof DirectAiProviderError) throw error;
    if (signal?.aborted) {
      throw new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
    }
    if (response.ok) {
      throw new DirectAiProviderError(
        "PLANNER_INVALID_OUTPUT",
        "INVALID_OUTPUT",
        { cause: error },
      );
    }
    return null;
  }
}

function readNormalizedServerError(value: unknown): DirectAiProviderError | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const code = value.error.code;
  const reason = value.error.reason;
  if (!isProviderCode(code) || !isProviderReason(reason)) return null;
  return new DirectAiProviderError(code, reason);
}

function isProviderCode(value: unknown): value is DirectAiProviderErrorCode {
  return value === "PLANNER_UNAVAILABLE"
    || value === "PLANNER_TIMEOUT"
    || value === "PLANNER_INVALID_OUTPUT"
    || value === "ABORTED";
}

function isProviderReason(value: unknown): value is DirectAiProviderErrorReason {
  return value === "MISSING_CONFIGURATION"
    || value === "NETWORK_FAILURE"
    || value === "HTTP_FAILURE"
    || value === "TIMEOUT"
    || value === "ABORTED"
    || value === "INVALID_OUTPUT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DirectAiProviderError("ABORTED", "ABORTED");
}
