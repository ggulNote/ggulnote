import * as ort from "onnxruntime-web/webgpu";
import { parseLayoutModelManifest } from "./model-catalog";
import { computeLetterboxGeometry } from "./preprocess-page";
import { decodeModelOutput } from "./postprocess-yolo";
import type { LayoutExecutionProvider, LayoutModelManifest, LayoutWorkerRequest, LayoutWorkerResponse } from "./layout-detection-types";

type WorkerScope = { onmessage: ((event: MessageEvent<LayoutWorkerRequest>) => void) | null; postMessage(message: LayoutWorkerResponse): void };
const workerScope = globalThis as unknown as WorkerScope;
let sessionPromise: Promise<ort.InferenceSession> | null = null;
let manifestPromise: Promise<LayoutModelManifest> | null = null;
let provider: LayoutExecutionProvider | null = null;
let initializedModelId: string | null = null;
let initializedModelUrl: string | null = null;
let initializedManifestUrl: string | null = null;
let initializationMs = 0;
ort.env.wasm.numThreads = 1;

async function loadManifest(url: string): Promise<LayoutModelManifest> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load layout model manifest (${response.status}).`);
  const value: unknown = await response.json();
  return parseLayoutModelManifest(value);
}

async function createSession(modelUrl: string): Promise<ort.InferenceSession> {
  try {
    const session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
    provider = "webgpu";
    return session;
  } catch (webGpuError: unknown) {
    try {
      const session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      provider = "wasm";
      return session;
    } catch (wasmError: unknown) {
      const detail = wasmError instanceof Error ? wasmError.message : String(wasmError);
      const webGpuDetail = webGpuError instanceof Error ? webGpuError.message : String(webGpuError);
      throw new Error(`Could not load layout model ONNX from ${modelUrl}. WASM: ${detail}. WebGPU: ${webGpuDetail}`);
    }
  }
}

async function initialize(modelId: string, modelUrl: string, manifestUrl: string): Promise<{ session: ort.InferenceSession; manifest: LayoutModelManifest; provider: LayoutExecutionProvider }> {
  if (initializedModelId && initializedModelId !== modelId) throw new Error("The layout worker is already initialized with another model ID.");
  if (initializedModelUrl && initializedModelUrl !== modelUrl) throw new Error("The layout worker is already initialized with another model.");
  if (initializedManifestUrl && initializedManifestUrl !== manifestUrl) throw new Error("The layout worker is already initialized with another manifest.");
  initializedModelId = modelId;
  initializedModelUrl = modelUrl;
  initializedManifestUrl = manifestUrl;
  const startedAt = performance.now();
  manifestPromise ??= loadManifest(manifestUrl);
  sessionPromise ??= createSession(modelUrl);
  const [session, loadedManifest] = await Promise.all([sessionPromise, manifestPromise]);
  const manifest = parseLayoutModelManifest(loadedManifest, modelId);
  initializationMs = performance.now() - startedAt;
  if (!provider) throw new Error("The layout inference provider was not selected.");
  return { session, manifest, provider };
}

function imageBitmapToTensor(bitmap: ImageBitmap, inputSize: number): { tensor: ort.Tensor; letterbox: ReturnType<typeof computeLetterboxGeometry> } {
  const letterbox = computeLetterboxGeometry(bitmap.width, bitmap.height, inputSize);
  const canvas = new OffscreenCanvas(inputSize, inputSize);
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("Could not create the layout preprocessing canvas.");
  context.fillStyle = "rgb(114, 114, 114)";
  context.fillRect(0, 0, inputSize, inputSize);
  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, letterbox.padX, letterbox.padY, letterbox.resizedWidth, letterbox.resizedHeight);
  bitmap.close();
  const rgba = context.getImageData(0, 0, inputSize, inputSize).data;
  const planeSize = inputSize * inputSize;
  const data = new Float32Array(planeSize * 3);
  for (let pixelIndex = 0; pixelIndex < planeSize; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    data[pixelIndex] = (rgba[rgbaIndex] ?? 0) / 255;
    data[planeSize + pixelIndex] = (rgba[rgbaIndex + 1] ?? 0) / 255;
    data[planeSize * 2 + pixelIndex] = (rgba[rgbaIndex + 2] ?? 0) / 255;
  }
  return { tensor: new ort.Tensor("float32", data, [1, 3, inputSize, inputSize]), letterbox };
}

workerScope.onmessage = (event) => {
  const request = event.data;
  void (async () => {
    if (request.type === "initialize") {
      const initialized = await initialize(request.modelId, request.modelUrl, request.manifestUrl);
      workerScope.postMessage({ id: request.id, type: "ready", modelId: request.modelId, provider: initialized.provider, initializationMs, manifest: initialized.manifest });
      return;
    }
    if (!sessionPromise || !manifestPromise || !provider) throw new Error("Initialize the layout worker before inference.");
    const [session, manifest] = await Promise.all([sessionPromise, manifestPromise]);
    if (request.modelId !== manifest.modelId) throw new Error(`Inference model ${request.modelId} does not match initialized model ${manifest.modelId}.`);
    const preprocessStartedAt = performance.now();
    const preprocessed = imageBitmapToTensor(request.bitmap, manifest.inputSize);
    const preprocessMs = performance.now() - preprocessStartedAt;
    const inferenceStartedAt = performance.now();
    const inputName = session.inputNames[0];
    if (!inputName) throw new Error("The layout model has no input tensor.");
    const outputMap = await session.run({ [inputName]: preprocessed.tensor });
    const inferenceMs = performance.now() - inferenceStartedAt;
    const outputName = session.outputNames[0];
    const output = outputName ? outputMap[outputName] : undefined;
    if (!output || !(output.data instanceof Float32Array)) throw new Error("The layout model did not return a float32 output tensor.");
    const postprocessStartedAt = performance.now();
    const detections = decodeModelOutput({ data: output.data, dimensions: output.dims }, manifest, preprocessed.letterbox);
    const postprocessMs = performance.now() - postprocessStartedAt;
    workerScope.postMessage({ id: request.id, type: "result", result: { pageId: request.pageId, modelId: manifest.modelId, provider, initializationMs, detections, timings: { pageRenderMs: request.pageRenderMs, preprocessMs, inferenceMs, postprocessMs }, inputShape: [...preprocessed.tensor.dims], outputShape: [...output.dims] } });
  })().catch((error: unknown) => {
    workerScope.postMessage({ id: request.id, type: "error", message: error instanceof Error ? error.message : "Document layout inference failed." });
  });
};
