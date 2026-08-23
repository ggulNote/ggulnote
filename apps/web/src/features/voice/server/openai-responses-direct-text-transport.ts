import {
  DirectAiProviderError,
  isAbortError,
} from "../domain";
import type {
  DirectTextModelRequest,
  DirectTextModelTransport,
  DirectTextModelTransportOptions,
} from "../providers/direct-text-model-transport";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

export type OpenAiResponsesFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type OpenAiReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface OpenAiResponsesDirectTextTransportOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  reasoningEffort?: OpenAiReasoningEffort;
  fetch?: OpenAiResponsesFetch;
}

/** Route-handler-only adapter. It is intentionally not exported from the Voice feature root. */
export class OpenAiResponsesDirectTextTransport
implements DirectTextModelTransport {
  private readonly fetchImpl: OpenAiResponsesFetch;

  public constructor(private readonly options: OpenAiResponsesDirectTextTransportOptions) {
    if (options.apiKey.trim().length === 0 || options.model.trim().length === 0) {
      throw new DirectAiProviderError(
        "PLANNER_UNAVAILABLE",
        "MISSING_CONFIGURATION",
      );
    }
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new DirectAiProviderError(
        "PLANNER_UNAVAILABLE",
        "MISSING_CONFIGURATION",
      );
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public async generate(
    request: DirectTextModelRequest,
    options: DirectTextModelTransportOptions = {},
  ): Promise<string> {
    if (options.signal?.aborted) {
      throw new DirectAiProviderError("ABORTED", "ABORTED");
    }

    const controller = new AbortController();
    let callerAborted = false;
    let timedOut = false;
    const abortFromCaller = () => {
      callerAborted = true;
      controller.abort();
    };
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.options.timeoutMs);

    try {
      const requestStartedAt = monotonicNow();
      const response = await this.fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          ...(request.promptCacheKey === undefined
            ? {}
            : { prompt_cache_key: request.promptCacheKey }),
          ...(request.promptCacheOptions === undefined
            ? {}
            : { prompt_cache_options: request.promptCacheOptions }),
          instructions: request.instructions,
          input: [
            {
              role: "system",
              content: "Return exactly one JSON object.",
            },
            ...request.input,
          ],
          text: { format: request.responseFormat ?? { type: "json_object" } },
          ...(this.options.reasoningEffort === undefined
            ? {}
            : { reasoning: { effort: this.options.reasoningEffort } }),
          max_output_tokens: request.maxOutputTokens,
          store: false,
        }),
        signal: controller.signal,
      });
      const responseStartedAt = monotonicNow();
      if (callerAborted || options.signal?.aborted) {
        throw new DirectAiProviderError("ABORTED", "ABORTED");
      }
      if (timedOut) {
        throw new DirectAiProviderError("PLANNER_TIMEOUT", "TIMEOUT");
      }
      if (!response.ok) {
        const error = await readOpenAiHttpErrorSummary(response);
        console.error("[direct-command-ai] OpenAI HTTP failure", {
          status: response.status,
          ...error,
        });
        throw new DirectAiProviderError(
          "PLANNER_UNAVAILABLE",
          "HTTP_FAILURE",
          { httpStatus: response.status },
        );
      }
      const payload = await readResponseJson(response);
      const bodyReadAt = monotonicNow();
      options.onTelemetry?.({
        openaiTtfbMs: Math.max(0, responseStartedAt - requestStartedAt),
        openaiBodyReadMs: Math.max(0, bodyReadAt - responseStartedAt),
        ...readUsage(payload),
      });
      const outputText = extractOpenAiOutputText(payload);
      if (outputText.trim().length === 0) {
        throw new DirectAiProviderError(
          "PLANNER_INVALID_OUTPUT",
          "INVALID_OUTPUT",
        );
      }
      return outputText;
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (callerAborted || options.signal?.aborted) {
        throw new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
      }
      if (timedOut) {
        throw new DirectAiProviderError(
          "PLANNER_TIMEOUT",
          "TIMEOUT",
          { cause: error },
        );
      }
      if (isAbortError(error)) {
        throw new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
      }
      throw new DirectAiProviderError(
        "PLANNER_UNAVAILABLE",
        "NETWORK_FAILURE",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function readUsage(value: unknown): {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly outputTokens?: number;
} {
  if (!isRecord(value) || !isRecord(value.usage)) return {};
  const usage = value.usage;
  const inputDetails = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : undefined;
  return {
    ...optionalMetric("inputTokens", usage.input_tokens),
    ...optionalMetric("cachedInputTokens", inputDetails?.cached_tokens),
    ...optionalMetric("cacheWriteInputTokens", inputDetails?.cache_write_tokens),
    ...optionalMetric("outputTokens", usage.output_tokens),
  };
}

function optionalMetric(
  name: "inputTokens" | "cachedInputTokens" | "cacheWriteInputTokens" | "outputTokens",
  value: unknown,
): Partial<Record<
  "inputTokens" | "cachedInputTokens" | "cacheWriteInputTokens" | "outputTokens",
  number
>> {
  return typeof value === "number" && Number.isFinite(value) ? { [name]: value } : {};
}

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch (error) {
    throw new DirectAiProviderError(
      "PLANNER_INVALID_OUTPUT",
      "INVALID_OUTPUT",
      { cause: error },
    );
  }
}

export function extractOpenAiOutputText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.output)) return "";
  const chunks: string[] = [];
  for (const item of value.output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (
        isRecord(content)
        && content.type === "output_text"
        && typeof content.text === "string"
      ) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readOpenAiHttpErrorSummary(
  response: Response,
): Promise<Record<string, string>> {
  try {
    const payload = await response.json() as unknown;
    if (!isRecord(payload) || !isRecord(payload.error)) return {};
    const error = payload.error;
    return {
      ...readErrorString(error, "type"),
      ...readErrorString(error, "code"),
      ...readErrorString(error, "param"),
      ...readErrorString(error, "message", 500),
    };
  } catch {
    return {};
  }
}

function readErrorString(
  value: Record<string, unknown>,
  key: "type" | "code" | "param" | "message",
  maximumLength = 120,
): Record<string, string> {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.trim().length === 0) return {};
  const redacted = candidate
    .replace(/sk-[A-Za-z0-9_-]+/gu, "[REDACTED]")
    .replace(/[\r\n]+/gu, " ")
    .trim()
    .slice(0, maximumLength);
  return redacted.length === 0 ? {} : { [key]: redacted };
}
