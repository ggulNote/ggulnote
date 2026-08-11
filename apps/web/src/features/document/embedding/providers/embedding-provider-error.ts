export type EmbeddingProviderErrorCode =
  | "EMBEDDING_UNAVAILABLE"
  | "EMBEDDING_TIMEOUT"
  | "EMBEDDING_ABORTED"
  | "EMBEDDING_INVALID_RESPONSE"
  | "EMBEDDING_CONFIG_MISMATCH";

export class EmbeddingProviderError extends Error {
  public constructor(
    public readonly code: EmbeddingProviderErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "EmbeddingProviderError";
  }
}
