export const EMBEDDING_INPUT_VERSION = "embedding-input-v1";

export function normalizeEmbeddingInput(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function createEmbeddingContentHash(text: string): string {
  return `${EMBEDDING_INPUT_VERSION}:${fnv1a32(`${EMBEDDING_INPUT_VERSION}\0${normalizeEmbeddingInput(text)}`)}`;
}

export function createEmbeddingSourceRevision(sourceVersion: string): number {
  return Number.parseInt(fnv1a32(sourceVersion), 16);
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
