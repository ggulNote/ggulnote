import type { NormalizedRect } from "@ggulnote/shared-types";

export type LayoutExecutionProvider = "webgpu" | "wasm";
export type LayoutDetectionStatus = "idle" | "rendering" | "initializing" | "inferencing" | "ready" | "error";
export type LayoutOutputFormat = "raw-cxcywh-class-scores" | "end-to-end-xyxy";
export type LayoutModelCatalogEntry = {
  id: string;
  family: string;
  variant: string;
  enabled: boolean;
  modelUrl: string;
  manifestUrl: string;
  inputSize: number;
  fileSizeBytes: number;
  inputShape: Array<number | string | null>;
  outputShapes: Array<Array<number | string | null>>;
  outputFormat: LayoutOutputFormat;
  requiresNms: boolean;
};
export type LayoutModelCatalog = { defaultModelId: string; models: LayoutModelCatalogEntry[] };
export type LayoutModelManifest = {
  modelId: string;
  version: string;
  family: string;
  variant: string;
  inputSize: number;
  inputLayout: "NCHW";
  labels: string[];
  input: { name: string; shape: Array<number | string | null>; dtype: "float32" };
  outputs: Array<{ name: string; shape: Array<number | string | null>; dtype: "float32" }>;
  outputFormat: LayoutOutputFormat;
  requiresNms: boolean;
  postprocess: { boxFormat: "cxcywh" | "xyxy"; confidenceThreshold: number; iouThreshold: number; maxDetections: number };
};
export type LetterboxGeometry = { inputSize: number; sourceWidth: number; sourceHeight: number; resizedWidth: number; resizedHeight: number; scale: number; padX: number; padY: number };
export type LayoutDetection = { id: string; classId: number; label: string; confidence: number; bounds: NormalizedRect };
export type LayoutDetectionTimings = { pageRenderMs: number; preprocessMs: number; inferenceMs: number; postprocessMs: number };
export type LayoutDetectionResult = { pageId: string; modelId: string; provider: LayoutExecutionProvider; initializationMs: number; detections: LayoutDetection[]; timings: LayoutDetectionTimings; inputShape: number[]; outputShape: number[] };
export type LayoutDetectionViewState = { pageId?: string; modelId?: string; status: LayoutDetectionStatus; result: LayoutDetectionResult | null; errorMessage?: string };
export type LayoutWorkerRequest =
  | { id: number; type: "initialize"; modelId: string; modelUrl: string; manifestUrl: string }
  | { id: number; type: "infer"; modelId: string; pageId: string; bitmap: ImageBitmap; pageRenderMs: number };
export type LayoutWorkerResponse =
  | { id: number; type: "ready"; modelId: string; provider: LayoutExecutionProvider; initializationMs: number; manifest: LayoutModelManifest }
  | { id: number; type: "result"; result: LayoutDetectionResult }
  | { id: number; type: "error"; message: string };
