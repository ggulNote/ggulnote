import type { LayoutDetectionResult, LayoutModelCatalogEntry, LayoutModelManifest, LayoutWorkerRequest, LayoutWorkerResponse } from "./layout-detection-types";

type PendingRequest = { resolve: (response: LayoutWorkerResponse) => void; reject: (error: Error) => void };
export type LayoutWorkerClientContract = Pick<LayoutWorkerClient, "modelId" | "initialize" | "infer" | "dispose">;

export class LayoutWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private initializePromise: Promise<{ provider: "webgpu" | "wasm"; initializationMs: number; manifest: LayoutModelManifest }> | null = null;
  public readonly modelId: string;

  public constructor(private readonly model: LayoutModelCatalogEntry) {
    this.modelId = model.id;
    this.worker = new Worker(new URL("./layout-inference.worker.ts", import.meta.url), { type: "module", name: `document-layout-${model.id}` });
    this.worker.onmessage = (event: MessageEvent<LayoutWorkerResponse>) => {
      const response = event.data;
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id);
      if (response.type === "error") { request.reject(new Error(response.message)); return; }
      request.resolve(response);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "Document layout worker failed.");
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
  }

  public initialize(): Promise<{ provider: "webgpu" | "wasm"; initializationMs: number; manifest: LayoutModelManifest }> {
    this.initializePromise ??= this.post({ id: this.nextRequestId++, type: "initialize", modelId: this.model.id, modelUrl: this.model.modelUrl, manifestUrl: this.model.manifestUrl }).then((response) => {
      if (response.type !== "ready") throw new Error("Unexpected layout worker initialization response.");
      if (response.modelId !== this.model.id) throw new Error("The layout worker initialized a stale model.");
      return { provider: response.provider, initializationMs: response.initializationMs, manifest: response.manifest };
    });
    return this.initializePromise;
  }

  public async infer(pageId: string, bitmap: ImageBitmap, pageRenderMs: number): Promise<LayoutDetectionResult> {
    await this.initialize();
    const response = await this.post({ id: this.nextRequestId++, type: "infer", modelId: this.model.id, pageId, bitmap, pageRenderMs }, [bitmap]);
    if (response.type !== "result") throw new Error("Unexpected layout worker inference response.");
    if (response.result.modelId !== this.model.id) throw new Error("The layout worker returned a stale model result.");
    return response.result;
  }

  public dispose(): void {
    this.worker.terminate();
    const error = new Error("Document layout worker was disposed.");
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private post(request: LayoutWorkerRequest, transfer: Transferable[] = []): Promise<LayoutWorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      this.worker.postMessage(request, transfer);
    });
  }
}

export function replaceLayoutWorkerClient(current: LayoutWorkerClientContract | null, model: LayoutModelCatalogEntry, create: (entry: LayoutModelCatalogEntry) => LayoutWorkerClientContract = (entry) => new LayoutWorkerClient(entry)): LayoutWorkerClientContract {
  if (current?.modelId === model.id) return current;
  current?.dispose();
  return create(model);
}

export function isCurrentLayoutResult(result: LayoutDetectionResult, pageId: string, modelId: string): boolean {
  return result.pageId === pageId && result.modelId === modelId;
}
