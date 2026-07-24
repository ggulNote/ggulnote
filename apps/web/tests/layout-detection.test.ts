import { describe, expect, it } from "vitest";
import { computeLetterboxGeometry, decodeModelOutput, isCurrentLayoutResult, parseLayoutModelCatalog, parseLayoutModelManifest, replaceLayoutWorkerClient, type LayoutDetectionResult, type LayoutModelCatalogEntry, type LayoutModelManifest, type LayoutWorkerClientContract } from "../src/features/document/layout-detection";

const manifest: LayoutModelManifest = { modelId: "test-layout", version: "1", family: "yolo11", variant: "test", inputSize: 1280, inputLayout: "NCHW", labels: ["Text", "Table"], input: { name: "images", shape: [1, 3, 1280, 1280], dtype: "float32" }, outputs: [{ name: "output0", shape: [1, 6, 1], dtype: "float32" }], outputFormat: "raw-cxcywh-class-scores", requiresNms: true, postprocess: { boxFormat: "cxcywh", confidenceThreshold: 0.25, iouThreshold: 0.45, maxDetections: 300 } };

describe("document layout preprocessing", () => {
  it("letterboxes without changing the source aspect ratio", () => {
    expect(computeLetterboxGeometry(1000, 500, 1280)).toEqual({ inputSize: 1280, sourceWidth: 1000, sourceHeight: 500, resizedWidth: 1280, resizedHeight: 640, scale: 1.28, padX: 0, padY: 320 });
  });
});

describe("YOLO postprocessing", () => {
  it("decodes an attributes-first raw output and reverses letterbox coordinates", () => {
    const detections = decodeModelOutput({ data: new Float32Array([640, 640, 640, 320, 0.1, 0.9]), dimensions: [1, 6, 1] }, manifest, computeLetterboxGeometry(1000, 500, 1280));
    expect(detections).toHaveLength(1);
    expect(detections[0]?.label).toBe("Table");
    expect(detections[0]?.bounds).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  });

  it("applies deterministic per-class non-maximum suppression to raw output", () => {
    const detections = decodeModelOutput({ data: new Float32Array([640, 650, 640, 650, 500, 500, 500, 500, 0.9, 0.8]), dimensions: [1, 5, 2] }, { ...manifest, labels: ["Text"], outputs: [{ name: "output0", shape: [1, 5, 2], dtype: "float32" }] }, computeLetterboxGeometry(1280, 1280, 1280));
    expect(detections).toHaveLength(1);
    expect(detections[0]?.confidence).toBeCloseTo(0.9);
  });

  it("decodes end-to-end xyxy output without applying NMS", () => {
    const endToEnd: LayoutModelManifest = { ...manifest, outputs: [{ name: "output0", shape: [1, 2, 6], dtype: "float32" }], outputFormat: "end-to-end-xyxy", requiresNms: false, postprocess: { ...manifest.postprocess, boxFormat: "xyxy" } };
    const detections = decodeModelOutput({ data: new Float32Array([100, 200, 500, 600, 0.9, 1, 110, 210, 490, 590, 0.8, 1]), dimensions: [1, 2, 6] }, endToEnd, computeLetterboxGeometry(1280, 1280, 1280));
    expect(detections).toHaveLength(2);
    expect(detections.every((detection) => detection.label === "Table")).toBe(true);
  });

  it("restores canonical normalized coordinates for page rotations 0, 90, 180, and 270", () => {
    const endToEnd: LayoutModelManifest = { ...manifest, outputs: [{ name: "output0", shape: [1, 1, 6], dtype: "float32" }], outputFormat: "end-to-end-xyxy", requiresNms: false, postprocess: { ...manifest.postprocess, boxFormat: "xyxy" } };
    for (const rotation of [0, 90, 180, 270]) {
      const sourceWidth = rotation % 180 === 0 ? 1000 : 700;
      const sourceHeight = rotation % 180 === 0 ? 700 : 1000;
      const letterbox = computeLetterboxGeometry(sourceWidth, sourceHeight, 1280);
      const values = [0.2 * sourceWidth, 0.3 * sourceHeight, 0.6 * sourceWidth, 0.5 * sourceHeight]
        .map((value, index) => value * letterbox.scale + (index % 2 === 0 ? letterbox.padX : letterbox.padY));
      const detections = decodeModelOutput({ data: new Float32Array([...values, 0.9, 0]), dimensions: [1, 1, 6] }, endToEnd, letterbox);
      expect(detections[0]?.bounds.x).toBeCloseTo(0.2);
      expect(detections[0]?.bounds.y).toBeCloseTo(0.3);
      expect(detections[0]?.bounds.width).toBeCloseTo(0.4);
      expect(detections[0]?.bounds.height).toBeCloseTo(0.2);
    }
  });

  it("rejects a tensor shape that differs from the manifest", () => {
    expect(() => decodeModelOutput({ data: new Float32Array(12), dimensions: [1, 2, 6] }, manifest, computeLetterboxGeometry(1280, 1280, 1280))).toThrow(/does not match manifest/);
  });
});

describe("layout model catalog and switching", () => {
  const model = (id: string, enabled = true): LayoutModelCatalogEntry => ({ id, family: "yolo", variant: "nano", enabled, modelUrl: `/${id}.onnx`, manifestUrl: `/${id}.json`, inputSize: 1280, fileSizeBytes: 10, inputShape: [1, 3, 1280, 1280], outputShapes: [[1, 15, 33600]], outputFormat: "raw-cxcywh-class-scores", requiresNms: true });

  it("loads six models from validated catalog data", () => {
    const catalog = parseLayoutModelCatalog({ defaultModelId: "model-a", models: [model("model-a"), model("model-b"), model("model-c"), model("model-d"), model("model-e"), model("model-f")] });
    expect(catalog.defaultModelId).toBe("model-a");
    expect(catalog.models).toHaveLength(6);
  });

  it("rejects duplicate model IDs and a missing default model", () => {
    expect(() => parseLayoutModelCatalog({ defaultModelId: "model-a", models: [model("model-a"), model("model-a")] })).toThrow(/duplicate/);
    expect(() => parseLayoutModelCatalog({ defaultModelId: "missing", models: [model("model-a")] })).toThrow(/default layout model/);
  });

  it("keeps disabled models out of the selectable model set", () => {
    const catalog = parseLayoutModelCatalog({ defaultModelId: "model-a", models: [model("model-a"), model("model-b", false)] });
    expect(catalog.models.filter((entry) => entry.enabled).map((entry) => entry.id)).toEqual(["model-a"]);
  });

  it("rejects malformed and model-mismatched manifests with explicit errors", () => {
    expect(() => parseLayoutModelManifest({ modelId: "model-a" }, "model-a")).toThrow(/manifest is invalid/);
    expect(() => parseLayoutModelManifest({ ...manifest, modelId: "model-b" }, "model-a")).toThrow(/does not match requested model/);
  });

  it("disposes the old worker session when the model changes", () => {
    let disposed = false;
    const unusedInitialize = async (): Promise<never> => { throw new Error("unused"); };
    const unusedInfer = async (): Promise<never> => { throw new Error("unused"); };
    const current = { modelId: "model-a", initialize: unusedInitialize, infer: unusedInfer, dispose: () => { disposed = true; } } satisfies LayoutWorkerClientContract;
    const replacement = replaceLayoutWorkerClient(current, model("model-b"), (entry) => ({ modelId: entry.id, initialize: unusedInitialize, infer: unusedInfer, dispose: () => undefined }));
    expect(disposed).toBe(true);
    expect(replacement.modelId).toBe("model-b");
  });

  it("rejects stale results from another model or page", () => {
    const result = { pageId: "page-1", modelId: "model-a" } as LayoutDetectionResult;
    expect(isCurrentLayoutResult(result, "page-1", "model-a")).toBe(true);
    expect(isCurrentLayoutResult(result, "page-1", "model-b")).toBe(false);
    expect(isCurrentLayoutResult(result, "page-2", "model-a")).toBe(false);
  });
});
