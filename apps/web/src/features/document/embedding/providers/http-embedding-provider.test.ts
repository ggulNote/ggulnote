import { describe, expect, it, vi } from "vitest";
import { EmbeddingProviderError } from "./embedding-provider-error";
import { HttpEmbeddingProvider, type EmbeddingFetch } from "./http-embedding-provider";

describe("HttpEmbeddingProvider", () => {
  it("sends one same-origin batch and returns Float32Array vectors", async () => {
    const fetch = vi.fn<EmbeddingFetch>().mockResolvedValue(Response.json({
      model: "model-a",
      dimensions: 2,
      vectors: [[1, 0], [0, 1]],
    }));
    const provider = new HttpEmbeddingProvider({ model: "model-a", dimensions: 2, fetch });

    const result = await provider.embed(["first", "second"]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/voice/embeddings");
    expect(result.every((vector) => vector instanceof Float32Array)).toBe(true);
    expect(Array.from(result[1] ?? [])).toEqual([0, 1]);
  });

  it("does not call the server for empty input", async () => {
    const fetch = vi.fn<EmbeddingFetch>();
    const provider = new HttpEmbeddingProvider({ model: "model-a", dimensions: 2, fetch });
    await expect(provider.embed([])).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { vectors: [[1, 0]], label: "count" },
    { vectors: [[1], [0, 1]], label: "dimension" },
  ])("rejects $label mismatch", async ({ vectors }) => {
    const provider = new HttpEmbeddingProvider({
      model: "model-a",
      dimensions: 2,
      fetch: async () => Response.json({ model: "model-a", dimensions: 2, vectors }),
    });
    await expect(provider.embed(["first", "second"]))
      .rejects.toMatchObject({ code: "EMBEDDING_INVALID_RESPONSE" });
  });

  it("normalizes HTTP failure, abort, and timeout", async () => {
    const unavailable = new HttpEmbeddingProvider({
      model: "model-a",
      dimensions: 2,
      fetch: async () => Response.json({ error: { code: "EMBEDDING_UNAVAILABLE" } }, { status: 503 }),
    });
    await expect(unavailable.embed(["text"]))
      .rejects.toMatchObject({ code: "EMBEDDING_UNAVAILABLE" });

    const aborted = new HttpEmbeddingProvider({
      model: "model-a",
      dimensions: 2,
      fetch: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    });
    const controller = new AbortController();
    const abortResult = aborted.embed(["text"], { signal: controller.signal });
    controller.abort();
    await expect(abortResult).rejects.toMatchObject({ code: "EMBEDDING_ABORTED" });

    const timedOut = new HttpEmbeddingProvider({
      model: "model-a",
      dimensions: 2,
      timeoutMs: 1,
      fetch: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    });
    await expect(timedOut.embed(["text"]))
      .rejects.toMatchObject({ code: "EMBEDDING_TIMEOUT" });
  });

  it("rejects missing model configuration", () => {
    expect(() => new HttpEmbeddingProvider({ model: "", dimensions: 2 }))
      .toThrow(RangeError);
    expect(new EmbeddingProviderError("EMBEDDING_UNAVAILABLE", "offline").code)
      .toBe("EMBEDDING_UNAVAILABLE");
  });
});
