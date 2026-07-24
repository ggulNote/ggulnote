import type { LayoutDetection, LayoutModelManifest, LetterboxGeometry } from "./layout-detection-types";

export type YoloOutput = { data: Float32Array; dimensions: readonly number[] };
export type YoloPostprocessOptions = { confidenceThreshold?: number; iouThreshold?: number; maxDetections?: number };
type PixelDetection = { sourceIndex: number; classId: number; confidence: number; x1: number; y1: number; x2: number; y2: number };
const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

function intersectionOverUnion(left: PixelDetection, right: PixelDetection): number {
  const x1 = Math.max(left.x1, right.x1);
  const y1 = Math.max(left.y1, right.y1);
  const x2 = Math.min(left.x2, right.x2);
  const y2 = Math.min(left.y2, right.y2);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const leftArea = Math.max(0, left.x2 - left.x1) * Math.max(0, left.y2 - left.y1);
  const rightArea = Math.max(0, right.x2 - right.x1) * Math.max(0, right.y2 - right.y1);
  const union = leftArea + rightArea - intersection;
  return union > 0 ? intersection / union : 0;
}

function predictionValue(output: YoloOutput, attributesFirst: boolean, predictionIndex: number, attributeIndex: number, predictionCount: number, attributeCount: number): number {
  const index = attributesFirst ? attributeIndex * predictionCount + predictionIndex : predictionIndex * attributeCount + attributeIndex;
  return output.data[index] ?? 0;
}

function validateOutputShape(output: YoloOutput, manifest: LayoutModelManifest): void {
  const expected = manifest.outputs[0]?.shape;
  if (!expected) throw new Error("The layout model manifest has no output tensor.");
  if (expected.length !== output.dimensions.length) throw new Error(`Layout output rank ${output.dimensions.length} does not match manifest rank ${expected.length}.`);
  expected.forEach((dimension, index) => {
    if (typeof dimension === "number" && dimension !== output.dimensions[index]) throw new Error(`Layout output shape ${output.dimensions.join("x")} does not match manifest shape ${expected.join("x")}.`);
  });
}

function toLayoutDetections(candidates: PixelDetection[], manifest: LayoutModelManifest, letterbox: LetterboxGeometry): LayoutDetection[] {
  return candidates.map((candidate, index) => {
    const x1 = clamp((candidate.x1 - letterbox.padX) / letterbox.scale, 0, letterbox.sourceWidth);
    const y1 = clamp((candidate.y1 - letterbox.padY) / letterbox.scale, 0, letterbox.sourceHeight);
    const x2 = clamp((candidate.x2 - letterbox.padX) / letterbox.scale, 0, letterbox.sourceWidth);
    const y2 = clamp((candidate.y2 - letterbox.padY) / letterbox.scale, 0, letterbox.sourceHeight);
    return { id: `layout:${candidate.classId}:${candidate.sourceIndex}:${index}`, classId: candidate.classId, label: manifest.labels[candidate.classId] ?? `class-${candidate.classId}`, confidence: candidate.confidence, bounds: { x: x1 / letterbox.sourceWidth, y: y1 / letterbox.sourceHeight, width: Math.max(0, x2 - x1) / letterbox.sourceWidth, height: Math.max(0, y2 - y1) / letterbox.sourceHeight } };
  });
}

function decodeRawOutput(output: YoloOutput, manifest: LayoutModelManifest, letterbox: LetterboxGeometry, options: YoloPostprocessOptions): LayoutDetection[] {
  if (!manifest.requiresNms) throw new Error("Raw YOLO output requires external NMS.");
  if (output.dimensions.length !== 3 || output.dimensions[0] !== 1) throw new Error(`Unsupported YOLO output shape: ${output.dimensions.join("x")}`);
  const attributeCount = 4 + manifest.labels.length;
  const attributesFirst = output.dimensions[1] === attributeCount;
  const predictionsFirst = output.dimensions[2] === attributeCount;
  if (!attributesFirst && !predictionsFirst) throw new Error(`YOLO output shape ${output.dimensions.join("x")} does not match ${manifest.labels.length} labels.`);
  const predictionCount = attributesFirst ? output.dimensions[2] : output.dimensions[1];
  const confidenceThreshold = options.confidenceThreshold ?? manifest.postprocess.confidenceThreshold;
  const iouThreshold = options.iouThreshold ?? manifest.postprocess.iouThreshold;
  const maxDetections = options.maxDetections ?? manifest.postprocess.maxDetections;
  const candidates: PixelDetection[] = [];

  for (let predictionIndex = 0; predictionIndex < predictionCount; predictionIndex += 1) {
    let classId = 0;
    let confidence = Number.NEGATIVE_INFINITY;
    for (let labelIndex = 0; labelIndex < manifest.labels.length; labelIndex += 1) {
      const score = predictionValue(output, attributesFirst, predictionIndex, 4 + labelIndex, predictionCount, attributeCount);
      if (score > confidence) { confidence = score; classId = labelIndex; }
    }
    if (!Number.isFinite(confidence) || confidence < confidenceThreshold) continue;
    const centerX = predictionValue(output, attributesFirst, predictionIndex, 0, predictionCount, attributeCount);
    const centerY = predictionValue(output, attributesFirst, predictionIndex, 1, predictionCount, attributeCount);
    const width = predictionValue(output, attributesFirst, predictionIndex, 2, predictionCount, attributeCount);
    const height = predictionValue(output, attributesFirst, predictionIndex, 3, predictionCount, attributeCount);
    if (![centerX, centerY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    candidates.push({ sourceIndex: predictionIndex, classId, confidence, x1: centerX - width / 2, y1: centerY - height / 2, x2: centerX + width / 2, y2: centerY + height / 2 });
  }

  const selected: PixelDetection[] = [];
  for (const candidate of candidates.sort((left, right) => right.confidence - left.confidence || left.sourceIndex - right.sourceIndex)) {
    if (selected.some((existing) => existing.classId === candidate.classId && intersectionOverUnion(existing, candidate) > iouThreshold)) continue;
    selected.push(candidate);
    if (selected.length >= maxDetections) break;
  }
  return toLayoutDetections(selected, manifest, letterbox);
}

function decodeEndToEndOutput(output: YoloOutput, manifest: LayoutModelManifest, letterbox: LetterboxGeometry, options: YoloPostprocessOptions): LayoutDetection[] {
  if (manifest.requiresNms) throw new Error("End-to-end YOLO output must not apply external NMS.");
  if (output.dimensions.length !== 3 || output.dimensions[0] !== 1) throw new Error(`Unsupported YOLO output shape: ${output.dimensions.join("x")}`);
  const attributesFirst = output.dimensions[1] === 6;
  const predictionsFirst = output.dimensions[2] === 6;
  if (!attributesFirst && !predictionsFirst) throw new Error(`End-to-end output must contain six attributes: ${output.dimensions.join("x")}`);
  const predictionCount = attributesFirst ? output.dimensions[2] : output.dimensions[1];
  const confidenceThreshold = options.confidenceThreshold ?? manifest.postprocess.confidenceThreshold;
  const maxDetections = options.maxDetections ?? manifest.postprocess.maxDetections;
  const candidates: PixelDetection[] = [];
  for (let predictionIndex = 0; predictionIndex < predictionCount; predictionIndex += 1) {
    const values = Array.from({ length: 6 }, (_, attributeIndex) => predictionValue(output, attributesFirst, predictionIndex, attributeIndex, predictionCount, 6));
    const [x1, y1, x2, y2, confidence, rawClassId] = values;
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined || confidence === undefined || rawClassId === undefined) continue;
    const classId = Math.round(rawClassId);
    if (!values.every(Number.isFinite) || confidence < confidenceThreshold || Math.abs(rawClassId - classId) > 1e-3 || classId < 0 || classId >= manifest.labels.length || x2 <= x1 || y2 <= y1) continue;
    candidates.push({ sourceIndex: predictionIndex, classId, confidence, x1, y1, x2, y2 });
  }
  candidates.sort((left, right) => right.confidence - left.confidence || left.sourceIndex - right.sourceIndex);
  return toLayoutDetections(candidates.slice(0, maxDetections), manifest, letterbox);
}

export function decodeModelOutput(output: YoloOutput, manifest: LayoutModelManifest, letterbox: LetterboxGeometry, options: YoloPostprocessOptions = {}): LayoutDetection[] {
  validateOutputShape(output, manifest);
  if (manifest.outputFormat === "raw-cxcywh-class-scores") return decodeRawOutput(output, manifest, letterbox, options);
  return decodeEndToEndOutput(output, manifest, letterbox, options);
}

export const postprocessYoloOutput = decodeModelOutput;
