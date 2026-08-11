export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) {
    throw new RangeError("Embedding vector dimensions must match.");
  }
  if (left.length === 0) {
    throw new RangeError("Embedding vectors must not be empty.");
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] as number;
    const rightValue = right[index] as number;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    throw new RangeError("Cosine similarity is undefined for a zero vector.");
  }

  const score = dot / Math.sqrt(leftMagnitude * rightMagnitude);
  if (!Number.isFinite(score)) {
    throw new RangeError("Cosine similarity must be finite.");
  }
  return Math.max(-1, Math.min(1, score));
}
