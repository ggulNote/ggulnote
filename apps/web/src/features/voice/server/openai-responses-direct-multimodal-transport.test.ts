import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectMultimodalModelRequest } from "../providers/direct-multimodal-model-transport";
import { OpenAiResponsesDirectMultimodalTransport } from "./openai-responses-direct-multimodal-transport";

const REQUEST: DirectMultimodalModelRequest = {
  instructions: "choose one alias",
  inputText: "{\"candidates\":[{\"alias\":\"S1\"},{\"alias\":\"S2\"}]}",
  images: [
    { dataUrl: "data:image/png;base64,AA==", detail: "low" },
    { dataUrl: "data:image/png;base64,AQ==", detail: "high" },
  ],
  allowedChoices: ["S1", "S2", "NONE"],
  maxOutputTokens: 32,
};

function openAiResponse(text: string): Response {
  return Response.json({
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("OpenAiResponsesDirectMultimodalTransport", () => {
  it("uses configured server-only model and two image inputs", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(_input).toBe("https://api.openai.com/v1/responses");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer server-secret");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.model).toBe("configured-model");
      expect(JSON.stringify(body)).toContain("input_image");
      expect(JSON.stringify(body)).toContain("spatial_placement_choice");
      expect(JSON.stringify(body)).toContain('"enum":["S1","S2","NONE"]');
      return openAiResponse('{"choice":"S2"}');
    });
    const transport = new OpenAiResponsesDirectMultimodalTransport({
      apiKey: "server-secret",
      model: "configured-model",
      timeoutMs: 1_000,
      fetch: fetchMock,
    });
    await expect(transport.generate(REQUEST)).resolves.toBe('{"choice":"S2"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes caller abort", async () => {
    const controller = new AbortController();
    const transport = new OpenAiResponsesDirectMultimodalTransport({
      apiKey: "secret",
      model: "configured-model",
      timeoutMs: 1_000,
      fetch: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    });
    const pending = transport.generate(REQUEST, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("normalizes the configured timeout without retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }));
    const transport = new OpenAiResponsesDirectMultimodalTransport({
      apiKey: "secret",
      model: "configured-model",
      timeoutMs: 50,
      fetch: fetchMock,
    });
    const pending = transport.generate(REQUEST);
    const expectation = expect(pending).rejects.toMatchObject({
      code: "PLANNER_TIMEOUT",
      reason: "TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
