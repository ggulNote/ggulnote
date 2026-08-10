import type { EmbeddingProvider } from "../embedding-types";
import { EmbeddingProviderError } from "../providers/embedding-provider-error";
import { OpenAiEmbeddingProvider } from "./openai-embedding-provider";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;

export interface EmbeddingServerEnvironment {
  OPENAI_API_KEY?: string;
  OPENAI_EMBEDDING_MODEL?: string;
  OPENAI_EMBEDDING_DIMENSIONS?: string;
}

export function createServerEmbeddingProvider(
  environment?: EmbeddingServerEnvironment,
): EmbeddingProvider {
  const resolvedEnvironment = environment ?? process.env;
  const apiKey = resolvedEnvironment.OPENAI_API_KEY?.trim() ?? "";
  if (apiKey.length === 0) {
    throw new EmbeddingProviderError("EMBEDDING_UNAVAILABLE", "Embedding API key is not configured.");
  }
  const model = resolvedEnvironment.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_MODEL;
  const dimensions = parseDimensions(resolvedEnvironment.OPENAI_EMBEDDING_DIMENSIONS);
  return new OpenAiEmbeddingProvider({ apiKey, model, dimensions });
}

function parseDimensions(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) return DEFAULT_DIMENSIONS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new EmbeddingProviderError("EMBEDDING_UNAVAILABLE", "Embedding dimensions configuration is invalid.");
  }
  return parsed;
}
