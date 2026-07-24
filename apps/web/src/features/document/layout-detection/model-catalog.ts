import type { LayoutModelCatalog, LayoutModelCatalogEntry, LayoutModelManifest } from "./layout-detection-types";

export const LAYOUT_MODEL_CATALOG_URL = "/models/document-layout/model-catalog.json";

function isCatalogEntry(value: unknown): value is LayoutModelCatalogEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LayoutModelCatalogEntry>;
  return typeof candidate.id === "string"
    && typeof candidate.family === "string"
    && typeof candidate.variant === "string"
    && typeof candidate.enabled === "boolean"
    && typeof candidate.modelUrl === "string"
    && typeof candidate.manifestUrl === "string"
    && Number.isInteger(candidate.inputSize)
    && (candidate.inputSize ?? 0) > 0
    && Number.isInteger(candidate.fileSizeBytes)
    && (candidate.fileSizeBytes ?? -1) >= 0
    && Array.isArray(candidate.inputShape)
    && Array.isArray(candidate.outputShapes)
    && candidate.outputShapes.every((shape) => Array.isArray(shape))
    && (candidate.outputFormat === "raw-cxcywh-class-scores" || candidate.outputFormat === "end-to-end-xyxy")
    && typeof candidate.requiresNms === "boolean";
}

export function parseLayoutModelCatalog(value: unknown): LayoutModelCatalog {
  if (!value || typeof value !== "object") throw new Error("The layout model catalog is invalid.");
  const candidate = value as Partial<LayoutModelCatalog>;
  if (typeof candidate.defaultModelId !== "string" || !Array.isArray(candidate.models) || !candidate.models.every(isCatalogEntry)) {
    throw new Error("The layout model catalog is invalid.");
  }
  const modelIds = candidate.models.map((model) => model.id);
  if (new Set(modelIds).size !== modelIds.length) throw new Error("The layout model catalog contains duplicate model IDs.");
  const enabledModels = candidate.models.filter((model) => model.enabled);
  if (!enabledModels.some((model) => model.id === candidate.defaultModelId)) throw new Error("The default layout model is not enabled.");
  return { defaultModelId: candidate.defaultModelId, models: candidate.models };
}

export function parseLayoutModelManifest(value: unknown, expectedModelId?: string): LayoutModelManifest {
  if (!value || typeof value !== "object") throw new Error("The layout model manifest is invalid.");
  const candidate = value as Partial<LayoutModelManifest>;
  const valid = typeof candidate.modelId === "string"
    && typeof candidate.version === "string"
    && typeof candidate.family === "string"
    && typeof candidate.variant === "string"
    && Number.isInteger(candidate.inputSize)
    && (candidate.inputSize ?? 0) > 0
    && candidate.inputLayout === "NCHW"
    && Array.isArray(candidate.labels)
    && candidate.labels.every((label) => typeof label === "string")
    && Boolean(candidate.input)
    && Array.isArray(candidate.outputs)
    && (candidate.outputFormat === "raw-cxcywh-class-scores" || candidate.outputFormat === "end-to-end-xyxy")
    && typeof candidate.requiresNms === "boolean"
    && Boolean(candidate.postprocess);
  if (!valid) throw new Error("The layout model manifest is invalid.");
  const manifest = candidate as LayoutModelManifest;
  if (expectedModelId && manifest.modelId !== expectedModelId) throw new Error(`Layout manifest model ID ${manifest.modelId} does not match requested model ${expectedModelId}.`);
  return manifest;
}

export async function loadLayoutModelCatalog(url = LAYOUT_MODEL_CATALOG_URL): Promise<LayoutModelCatalog> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load layout model catalog (${response.status}).`);
  return parseLayoutModelCatalog(await response.json() as unknown);
}
