import { describe, expect, it, vi } from "vitest";
import { createServerEmbeddingProvider } from "./embedding-server";
import { OpenAiEmbeddingProvider } from "./openai-embedding-provider";

describe("OpenAiEmbeddingProvider", () => {
  it("chunks batches internally and restores input order", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return Response.json({
        data: body.input.map((_text, index) => ({ index, embedding: [index, 1] })).reverse(),
      });
    });
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "test-key",
      model: "model-a",
      dimensions: 2,
      batchSize: 2,
      fetch,
    });

    const result = await provider.embed(["a", "b", "c"]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.map((vector) => Array.from(vector))).toEqual([[0, 1], [1, 1], [0, 1]]);
  });

  it("rejects response count and dimension mismatch", async () => {
    const countMismatch = new OpenAiEmbeddingProvider({
      apiKey: "test-key",
      model: "model-a",
      dimensions: 2,
      fetch: async () => Response.json({ data: [] }),
    });
    await expect(countMismatch.embed(["a"]))
      .rejects.toMatchObject({ code: "EMBEDDING_INVALID_RESPONSE" });

    const dimensionMismatch = new OpenAiEmbeddingProvider({
      apiKey: "test-key",
      model: "model-a",
      dimensions: 2,
      fetch: async () => Response.json({ data: [{ index: 0, embedding: [1] }] }),
    });
    await expect(dimensionMismatch.embed(["a"]))
      .rejects.toMatchObject({ code: "EMBEDDING_INVALID_RESPONSE" });
  });

  it("keeps API keys server-only and reports missing configuration", () => {
    expect(() => createServerEmbeddingProvider({}))
      .toThrowError(expect.objectContaining({ code: "EMBEDDING_UNAVAILABLE" }));
    const provider = createServerEmbeddingProvider({ OPENAI_API_KEY: "server-key" });
    expect(provider.descriptor).toEqual({ model: "text-embedding-3-small", dimensions: 1536 });
  });
});
