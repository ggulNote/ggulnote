import type {
  EmbeddingModelDescriptor,
  EmbeddingProvider,
  EmbeddingProviderOptions,
} from "../embedding-types";
import { EmbeddingProviderError } from "./embedding-provider-error";

const DEFAULT_TIMEOUT_MS = 15_000;

export type EmbeddingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpEmbeddingProviderOptions extends EmbeddingModelDescriptor {
  endpoint?: string;
  fetch?: EmbeddingFetch;
  timeoutMs?: number;
}

export class HttpEmbeddingProvider implements EmbeddingProvider {
  public readonly descriptor: EmbeddingModelDescriptor;
  private readonly endpoint: string;
  private readonly fetchImpl: EmbeddingFetch;
  private readonly timeoutMs: number;

  public constructor(options: HttpEmbeddingProviderOptions) {
    assertDescriptor(options);
    this.descriptor = { model: options.model, dimensions: options.dimensions };
    this.endpoint = options.endpoint ?? "/api/voice/embeddings";
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new RangeError("Embedding request timeout must be positive.");
    }
  }

  public async embed(
    texts: readonly string[],
    options: EmbeddingProviderOptions = {},
  ): Promise<readonly Float32Array[]> {
    if (texts.length === 0) return [];
    if (texts.some((text) => typeof text !== "string" || text.trim().length === 0)) {
      throw new RangeError("Embedding inputs must be non-empty strings.");
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          texts,
          model: this.descriptor.model,
          dimensions: this.descriptor.dimensions,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const code = await readErrorCode(response);
        throw new EmbeddingProviderError(
          normalizeServerErrorCode(code),
          "Embedding service is unavailable.",
        );
      }
      return parseEmbeddingResponse(await readJson(response), this.descriptor, texts.length);
    } catch (error) {
      if (error instanceof EmbeddingProviderError) throw error;
      if (options.signal?.aborted) {
        throw new EmbeddingProviderError("EMBEDDING_ABORTED", "Embedding request was aborted.", { cause: error });
      }
      if (timedOut) {
        throw new EmbeddingProviderError("EMBEDDING_TIMEOUT", "Embedding request timed out.", { cause: error });
      }
      if (isAbortError(error)) {
        throw new EmbeddingProviderError("EMBEDDING_ABORTED", "Embedding request was aborted.", { cause: error });
      }
      throw new EmbeddingProviderError("EMBEDDING_UNAVAILABLE", "Embedding request failed.", { cause: error });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function parseEmbeddingResponse(
  value: unknown,
  expected: EmbeddingModelDescriptor,
  expectedCount: number,
): readonly Float32Array[] {
  if (!isRecord(value) || value.model !== expected.model || value.dimensions !== expected.dimensions) {
    throw new EmbeddingProviderError("EMBEDDING_CONFIG_MISMATCH", "Embedding model response mismatch.");
  }
  if (!Array.isArray(value.vectors) || value.vectors.length !== expectedCount) {
    throw new EmbeddingProviderError("EMBEDDING_INVALID_RESPONSE", "Embedding vectors are missing.");
  }
  return value.vectors.map((raw) => {
    if (!Array.isArray(raw) || raw.length !== expected.dimensions || raw.some((item) =>
      typeof item !== "number" || !Number.isFinite(item),
    )) {
      throw new EmbeddingProviderError("EMBEDDING_INVALID_RESPONSE", "Embedding vector dimensions are invalid.");
    }
    return new Float32Array(raw as number[]);
  });
}

function assertDescriptor(value: EmbeddingModelDescriptor): void {
  if (value.model.trim().length === 0) {
    throw new RangeError("Embedding model must not be empty.");
  }
  if (!Number.isInteger(value.dimensions) || value.dimensions <= 0) {
    throw new RangeError("Embedding dimensions must be positive.");
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch (error) {
    throw new EmbeddingProviderError("EMBEDDING_INVALID_RESPONSE", "Embedding response is not JSON.", { cause: error });
  }
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const value = await response.json() as unknown;
    return isRecord(value) && isRecord(value.error) && typeof value.error.code === "string"
      ? value.error.code
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeServerErrorCode(value: string | undefined): EmbeddingProviderError["code"] {
  switch (value) {
    case "EMBEDDING_TIMEOUT":
    case "EMBEDDING_ABORTED":
    case "EMBEDDING_INVALID_RESPONSE":
    case "EMBEDDING_CONFIG_MISMATCH":
      return value;
    default:
      return "EMBEDDING_UNAVAILABLE";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
