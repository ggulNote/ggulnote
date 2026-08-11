import type {
  EmbeddingModelDescriptor,
  EmbeddingProvider,
  EmbeddingProviderOptions,
} from "../../embedding-types";

export interface FakeEmbeddingProviderOptions extends EmbeddingModelDescriptor {
  vectorForText?: (text: string, index: number) => Float32Array;
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  public readonly descriptor: EmbeddingModelDescriptor;
  public readonly batches: string[][] = [];
  public error: unknown = null;
  private readonly vectorForText: (text: string, index: number) => Float32Array;

  public constructor(options: FakeEmbeddingProviderOptions) {
    this.descriptor = { model: options.model, dimensions: options.dimensions };
    this.vectorForText = options.vectorForText ?? ((_text, index) => {
      const vector = new Float32Array(options.dimensions);
      vector[index % options.dimensions] = 1;
      return vector;
    });
  }

  public async embed(
    texts: readonly string[],
    options: EmbeddingProviderOptions = {},
  ): Promise<readonly Float32Array[]> {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    this.batches.push([...texts]);
    if (this.error !== null) throw this.error;
    return texts.map((text, index) => new Float32Array(this.vectorForText(text, index)));
  }
}
