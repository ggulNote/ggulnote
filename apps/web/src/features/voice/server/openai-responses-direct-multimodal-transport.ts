import { DirectAiProviderError, isAbortError } from "../domain";
import type {
  DirectMultimodalModelRequest,
  DirectMultimodalModelTransport,
  DirectMultimodalModelTransportOptions,
} from "../providers/direct-multimodal-model-transport";
import { extractOpenAiOutputText } from "./openai-responses-direct-text-transport";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

export type OpenAiResponsesMultimodalFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface OpenAiResponsesDirectMultimodalTransportOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly fetch?: OpenAiResponsesMultimodalFetch;
}

/** Route-handler-only adapter. Browser bundles never receive the API key. */
export class OpenAiResponsesDirectMultimodalTransport
implements DirectMultimodalModelTransport {
  private readonly fetchImpl: OpenAiResponsesMultimodalFetch;

  public constructor(
    private readonly options: OpenAiResponsesDirectMultimodalTransportOptions,
  ) {
    if (options.apiKey.trim().length === 0 || options.model.trim().length === 0
      || !Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new DirectAiProviderError("PLANNER_UNAVAILABLE", "MISSING_CONFIGURATION");
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public async generate(
    request: DirectMultimodalModelRequest,
    options: DirectMultimodalModelTransportOptions = {},
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
      const response = await this.fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          instructions: request.instructions,
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: request.inputText },
              ...request.images.map((image) => ({
                type: "input_image",
                image_url: image.dataUrl,
                detail: image.detail,
              })),
            ],
          }],
          text: {
            format: {
              type: "json_schema",
              name: "spatial_placement_choice",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["choice"],
                properties: {
                  choice: { type: "string", enum: request.allowedChoices },
                },
              },
            },
          },
          max_output_tokens: request.maxOutputTokens,
          store: false,
        }),
        signal: controller.signal,
      });
      if (callerAborted || options.signal?.aborted) {
        throw new DirectAiProviderError("ABORTED", "ABORTED");
      }
      if (timedOut) {
        throw new DirectAiProviderError("PLANNER_TIMEOUT", "TIMEOUT");
      }
      if (!response.ok) {
        console.error("[direct-command-ai] OpenAI multimodal HTTP failure", {
          status: response.status,
        });
        throw new DirectAiProviderError(
          "PLANNER_UNAVAILABLE",
          "HTTP_FAILURE",
          { httpStatus: response.status },
        );
      }
      const payload = await readResponseJson(response);
      const outputText = extractOpenAiOutputText(payload);
      if (outputText.trim().length === 0) {
        throw new DirectAiProviderError("PLANNER_INVALID_OUTPUT", "INVALID_OUTPUT");
      }
      return outputText;
    } catch (error) {
      if (error instanceof DirectAiProviderError) throw error;
      if (callerAborted || options.signal?.aborted) {
        throw new DirectAiProviderError("ABORTED", "ABORTED", { cause: error });
      }
      if (timedOut) {
        throw new DirectAiProviderError("PLANNER_TIMEOUT", "TIMEOUT", { cause: error });
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
