import type {
  EmbeddingModelDescriptor,
  EmbeddingProvider,
  EmbeddingProviderOptions,
} from "../embedding-types";
import { EmbeddingProviderError } from "../providers/embedding-provider-error";

const OPENAI_EMBEDDINGS_ENDPOINT = "https://api.openai.com/v1/embeddings";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BATCH_SIZE = 64;

export interface OpenAiEmbeddingProviderOptions extends EmbeddingModelDescriptor {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  batchSize?: number;
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  public readonly descriptor: EmbeddingModelDescriptor;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly batchSize: number;

  public constructor(private readonly options: OpenAiEmbeddingProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new EmbeddingProviderError("EMBEDDING_UNAVAILABLE", "Embedding API key is missing.");
    }
    if (options.model.trim().length === 0 || !Number.isInteger(options.dimensions) || options.dimensions <= 0) {
      throw new EmbeddingProviderError("EMBEDDING_UNAVAILABLE", "Embedding model configuration is invalid.");
    }
    this.descriptor = { model: options.model, dimensions: options.dimensions };
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    if (!Number.isInteger(this.batchSize) || this.batchSize <= 0) {
      throw new RangeError("Embedding batch size must be positive.");
    }
  }

  public async embed(
    texts: readonly string[],
    options: EmbeddingProviderOptions = {},
  ): Promise<readonly Float32Array[]> {
    if (texts.length === 0) return [];
    const vectors: Float32Array[] = [];
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const chunk = texts.slice(offset, offset + this.batchSize);
      vectors.push(...await this.embedChunk(chunk, options.signal));
    }
    return vectors;
  }

  private async embedChunk(
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly Float32Array[]> {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(OPENAI_EMBEDDINGS_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.descriptor.model,
          input: texts,
          dimensions: this.descriptor.dimensions,
          encoding_format: "float",
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new EmbeddingProviderError("EMBEDDING_UNAVAILABLE", "OpenAI embedding request failed.");
      }
      return parseOpenAiEmbeddingResponse(await readJson(response), texts.length, this.descriptor.dimensions);
    } catch (error) {
      if (error instanceof EmbeddingProviderError) throw error;
      if (signal?.aborted) {
        throw new EmbeddingProviderError("EMBEDDING_ABORTED", "Embedding request was aborted.", { cause: error });
      }
      if (timedOut) {
        throw new EmbeddingProviderError("EMBEDDING_TIMEOUT", "Embedding request timed out.", { cause: error });
      }
      throw new EmbeddingProviderError("EMBEDDING_UNAVAILABLE", "Embedding request failed.", { cause: error });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function parseOpenAiEmbeddingResponse(
  value: unknown,
  expectedCount: number,
  dimensions: number,
): readonly Float32Array[] {
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length !== expectedCount) {
    throw new EmbeddingProviderError("EMBEDDING_INVALID_RESPONSE", "Embedding response count mismatch.");
  }
  const ordered = [...value.data].sort((left, right) => readIndex(left) - readIndex(right));
  return ordered.map((item, expectedIndex) => {
    if (!isRecord(item) || item.index !== expectedIndex || !Array.isArray(item.embedding)) {
      throw new EmbeddingProviderError("EMBEDDING_INVALID_RESPONSE", "Embedding response ordering is invalid.");
    }
    if (item.embedding.length !== dimensions || item.embedding.some((entry) =>
      typeof entry !== "number" || !Number.isFinite(entry),
    )) {
      throw new EmbeddingProviderError("EMBEDDING_INVALID_RESPONSE", "Embedding response dimensions are invalid.");
    }
    return new Float32Array(item.embedding as number[]);
  });
}

function readIndex(value: unknown): number {
  return isRecord(value) && typeof value.index === "number" ? value.index : Number.MAX_SAFE_INTEGER;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch (error) {
    throw new EmbeddingProviderError("EMBEDDING_INVALID_RESPONSE", "Embedding response is not JSON.", { cause: error });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
