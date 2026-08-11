import { describe, expect, it, vi } from "vitest";
import type { DirectTextModelRequest } from "../providers/direct-text-model-transport";
import {
  createDirectCommandAiProviders,
  readDirectCommandAiServerConfig,
} from "./direct-command-ai-server";
import {
  OpenAiResponsesDirectTextTransport,
} from "./openai-responses-direct-text-transport";

const REQUEST: DirectTextModelRequest = {
  instructions: "Return JSON only.",
  input: [{ role: "user", content: "{\"section\":\"USER_UTTERANCE\"}" }],
  maxOutputTokens: 200,
};

function openAiResponse(text: string): Response {
  return Response.json({
    status: "completed",
    output: [{
      type: "message",
      content: [{ type: "output_text", text }],
    }],
  });
}

describe("OpenAiResponsesDirectTextTransport", () => {
  it("logs only a bounded redacted summary for OpenAI HTTP failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const transport = new OpenAiResponsesDirectTextTransport({
      apiKey: "server-secret",
      model: "configured-model",
      timeoutMs: 1_000,
      fetch: async () => Response.json({
        error: {
          type: "invalid_request_error",
          code: "invalid_value",
          param: "text.format.type",
          message: "Invalid format for sk-secret-value.\nUse another value.",
          ignored: "must not be logged",
        },
      }, { status: 400 }),
    });

    try {
      await expect(transport.generate(REQUEST)).rejects.toMatchObject({
        code: "PLANNER_UNAVAILABLE",
        reason: "HTTP_FAILURE",
        httpStatus: 400,
      });
      expect(consoleError).toHaveBeenCalledWith(
        "[direct-command-ai] OpenAI HTTP failure",
        {
          status: 400,
          type: "invalid_request_error",
          code: "invalid_value",
          param: "text.format.type",
          message: "Invalid format for [REDACTED]. Use another value.",
        },
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("uses the server-only key/model config and extracts valid response text", async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => openAiResponse('{\"status\":\"NONE\"}'));
    const transport = new OpenAiResponsesDirectTextTransport({
      apiKey: "server-secret",
      model: "configured-model",
      timeoutMs: 1_000,
      fetch: fetchMock,
    });

    await expect(transport.generate(REQUEST)).resolves.toBe('{\"status\":\"NONE\"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.headers).toMatchObject({
      authorization: "Bearer server-secret",
      "content-type": "application/json",
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "configured-model",
      input: [
        {
          role: "system",
          content: "Return exactly one JSON object.",
        },
        ...REQUEST.input,
      ],
      text: { format: { type: "json_object" } },
      store: false,
      max_output_tokens: 200,
    });
    expect(body).not.toHaveProperty("tools");
  });

  it("normalizes network, HTTP, empty output, and timeout failures", async () => {
    const network = new OpenAiResponsesDirectTextTransport({
      apiKey: "secret",
      model: "model",
      timeoutMs: 1_000,
      fetch: async () => {
        throw new TypeError("network down");
      },
    });
    await expect(network.generate(REQUEST)).rejects.toMatchObject({
      code: "PLANNER_UNAVAILABLE",
      reason: "NETWORK_FAILURE",
    });

    const http = new OpenAiResponsesDirectTextTransport({
      apiKey: "secret",
      model: "model",
      timeoutMs: 1_000,
      fetch: async () => new Response("provider detail must not escape", {
        status: 429,
      }),
    });
    await expect(http.generate(REQUEST)).rejects.toMatchObject({
      code: "PLANNER_UNAVAILABLE",
      reason: "HTTP_FAILURE",
      httpStatus: 429,
    });

    const empty = new OpenAiResponsesDirectTextTransport({
      apiKey: "secret",
      model: "model",
      timeoutMs: 1_000,
      fetch: async () => openAiResponse(""),
    });
    await expect(empty.generate(REQUEST)).rejects.toMatchObject({
      code: "PLANNER_INVALID_OUTPUT",
      reason: "INVALID_OUTPUT",
    });

    const timeout = new OpenAiResponsesDirectTextTransport({
      apiKey: "secret",
      model: "model",
      timeoutMs: 5,
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    });
    await expect(timeout.generate(REQUEST)).rejects.toMatchObject({
      code: "PLANNER_TIMEOUT",
      reason: "TIMEOUT",
    });
  });

  it("handles pre-abort and in-flight abort without promoting a late response", async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
        setTimeout(() => resolve(openAiResponse('{\"status\":\"NONE\"}')), 25);
      }));
    const transport = new OpenAiResponsesDirectTextTransport({
      apiKey: "secret",
      model: "model",
      timeoutMs: 1_000,
      fetch: fetchMock,
    });

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(transport.generate(REQUEST, {
      signal: preAborted.signal,
    })).rejects.toMatchObject({ code: "ABORTED" });
    expect(fetchMock).toHaveBeenCalledTimes(0);

    const inFlight = new AbortController();
    const pending = transport.generate(REQUEST, { signal: inFlight.signal });
    inFlight.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("direct command AI server configuration", () => {
  it("requires non-public API key and model settings", () => {
    expect(() => readDirectCommandAiServerConfig({
      NEXT_PUBLIC_OPENAI_API_KEY: "must-not-be-used",
      DIRECT_COMMAND_MODEL: "configured-model",
    })).toThrowError(/configuration is unavailable/u);
    expect(() => readDirectCommandAiServerConfig({
      OPENAI_API_KEY: "secret",
    })).toThrowError(/configuration is unavailable/u);
  });

  it("creates text and multimodal providers without external network calls", () => {
    const providers = createDirectCommandAiProviders({
      OPENAI_API_KEY: "secret",
      DIRECT_COMMAND_MODEL: "configured-model",
      DIRECT_COMMAND_AI_TIMEOUT_MS: "2500",
    }, async () => openAiResponse('{\"status\":\"NONE\"}'));
    expect(providers.planner).toBeDefined();
    expect(providers.disambiguator).toBeDefined();
    expect(providers.placementJudge).toBeDefined();
  });
});
