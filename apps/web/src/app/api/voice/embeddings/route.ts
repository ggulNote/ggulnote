import { EmbeddingProviderError } from "@/features/document/embedding/providers/embedding-provider-error";
import { createServerEmbeddingProvider } from "@/features/document/embedding/server/embedding-server";

const MAX_BATCH_SIZE = 256;
const MAX_INPUT_LENGTH = 12_000;

export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseRequest(await request.json() as unknown);
    const provider = createServerEmbeddingProvider();
    if (
      input.model !== provider.descriptor.model
      || input.dimensions !== provider.descriptor.dimensions
    ) {
      throw new EmbeddingProviderError("EMBEDDING_CONFIG_MISMATCH", "Embedding configuration mismatch.");
    }
    const vectors = await provider.embed(input.texts, { signal: request.signal });
    return Response.json({
      model: provider.descriptor.model,
      dimensions: provider.descriptor.dimensions,
      vectors: vectors.map((vector) => Array.from(vector)),
    });
  } catch (error) {
    const normalized = normalizeError(error);
    return Response.json(
      { error: { code: normalized.code } },
      { status: statusForError(normalized) },
    );
  }
}

function parseRequest(value: unknown): {
  texts: readonly string[];
  model: string;
  dimensions: number;
} {
  if (!isRecord(value) || Object.keys(value).some((key) =>
    key !== "texts" && key !== "model" && key !== "dimensions",
  )) {
    throw new EmbeddingProviderError("EMBEDDING_INVALID_RESPONSE", "Embedding request is invalid.");
  }
  if (
    !Array.isArray(value.texts)
    || value.texts.length === 0
    || value.texts.length > MAX_BATCH_SIZE
    || value.texts.some((text) =>
      typeof text !== "string" || text.trim().length === 0 || text.length > MAX_INPUT_LENGTH,
    )
    || typeof value.model !== "string"
    || value.model.trim().length === 0
    || !Number.isInteger(value.dimensions)
    || (value.dimensions as number) <= 0
  ) {
    throw new EmbeddingProviderError("EMBEDDING_INVALID_RESPONSE", "Embedding request is invalid.");
  }
  return {
    texts: value.texts as string[],
    model: value.model,
    dimensions: value.dimensions as number,
  };
}

function normalizeError(error: unknown): EmbeddingProviderError {
  return error instanceof EmbeddingProviderError
    ? error
    : new EmbeddingProviderError("EMBEDDING_UNAVAILABLE", "Embedding service failed.", { cause: error });
}

function statusForError(error: EmbeddingProviderError): number {
  switch (error.code) {
    case "EMBEDDING_INVALID_RESPONSE":
      return 400;
    case "EMBEDDING_CONFIG_MISMATCH":
      return 409;
    case "EMBEDDING_TIMEOUT":
      return 504;
    case "EMBEDDING_ABORTED":
      return 408;
    case "EMBEDDING_UNAVAILABLE":
      return 503;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
