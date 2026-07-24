from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw
from ultralytics import YOLO
from model_catalog import ROOT, ModelConfig, get_models


def create_sample(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (1000, 1400), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((70, 70, 930, 180), outline="black", width=4)
    draw.text((100, 105), "DOCUMENT LAYOUT MODEL VERIFICATION", fill="black")
    for column_x in (80, 520):
        for row in range(12):
            y = 240 + row * 48
            draw.rectangle((column_x, y, column_x + 390, y + 20), fill="black")
    draw.rectangle((80, 860, 920, 1240), outline="black", width=3)
    for x in (80, 260, 430, 610, 770, 920):
        draw.line((x, 860, x, 1240), fill="black", width=2)
    for y in range(860, 1241, 55):
        draw.line((80, y, 920, y), fill="black", width=2)
    image.save(path)
    return path


def letterbox(image: Image.Image, size: int) -> tuple[np.ndarray, float, float, float]:
    width, height = image.size
    scale = min(size / width, size / height)
    resized_width = max(1, round(width * scale))
    resized_height = max(1, round(height * scale))
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    pad_x = (size - resized_width) / 2
    pad_y = (size - resized_height) / 2
    canvas.paste(image.resize((resized_width, resized_height), Image.Resampling.BILINEAR), (round(pad_x), round(pad_y)))
    tensor = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
    return tensor, scale, pad_x, pad_y


def iou(left: np.ndarray, right: np.ndarray) -> float:
    x1, y1 = max(float(left[0]), float(right[0])), max(float(left[1]), float(right[1]))
    x2, y2 = min(float(left[2]), float(right[2])), min(float(left[3]), float(right[3]))
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    left_area = max(0.0, float(left[2] - left[0])) * max(0.0, float(left[3] - left[1]))
    right_area = max(0.0, float(right[2] - right[0])) * max(0.0, float(right[3] - right[1]))
    union = left_area + right_area - intersection
    return intersection / union if union > 0 else 0.0


def nms(detections: list[dict[str, Any]], threshold: float) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for candidate in sorted(detections, key=lambda item: (-item["confidence"], item["classId"])):
        if any(chosen["classId"] == candidate["classId"] and iou(np.asarray(chosen["bounds"]), np.asarray(candidate["bounds"])) > threshold for chosen in selected):
            continue
        selected.append(candidate)
    return selected


def decode_raw(output: np.ndarray, manifest: dict[str, Any], image_size: tuple[int, int], scale: float, pad_x: float, pad_y: float) -> list[dict[str, Any]]:
    if output.ndim != 3 or output.shape[0] != 1:
        raise ValueError(f"Unsupported output shape: {output.shape}")
    label_count = len(manifest["labels"])
    attributes = 4 + label_count
    predictions = output[0].T if output.shape[1] == attributes else output[0]
    if predictions.shape[1] != attributes:
        raise ValueError(f"Output does not match {label_count} labels: {output.shape}")
    threshold = float(manifest["postprocess"]["confidenceThreshold"])
    decoded: list[dict[str, Any]] = []
    for prediction in predictions:
        class_id = int(np.argmax(prediction[4:]))
        score = float(prediction[4 + class_id])
        if score < threshold:
            continue
        cx, cy, width, height = map(float, prediction[:4])
        image_width, image_height = image_size
        decoded.append({"classId": class_id, "confidence": score, "bounds": [max(0.0, min(float(image_width), (cx - width / 2 - pad_x) / scale)), max(0.0, min(float(image_height), (cy - height / 2 - pad_y) / scale)), max(0.0, min(float(image_width), (cx + width / 2 - pad_x) / scale)), max(0.0, min(float(image_height), (cy + height / 2 - pad_y) / scale))]})
    return nms(decoded, float(manifest["postprocess"]["iouThreshold"]))[: int(manifest["postprocess"]["maxDetections"])]


def decode_end_to_end(output: np.ndarray, manifest: dict[str, Any], image_size: tuple[int, int], scale: float, pad_x: float, pad_y: float) -> list[dict[str, Any]]:
    if output.ndim != 3 or output.shape[0] != 1:
        raise ValueError(f"Unsupported output shape: {output.shape}")
    predictions = output[0].T if output.shape[1] == 6 else output[0]
    if predictions.shape[1] != 6:
        raise ValueError(f"End-to-end output must contain six attributes: {output.shape}")
    threshold = float(manifest["postprocess"]["confidenceThreshold"])
    image_width, image_height = image_size
    decoded: list[dict[str, Any]] = []
    for prediction in predictions:
        x1, y1, x2, y2, score, raw_class_id = map(float, prediction)
        class_id = round(raw_class_id)
        if score < threshold or abs(raw_class_id - class_id) > 1e-3 or not 0 <= class_id < len(manifest["labels"]):
            continue
        if not np.isfinite(prediction).all() or x2 <= x1 or y2 <= y1:
            continue
        decoded.append({"classId": class_id, "confidence": score, "bounds": [max(0.0, min(float(image_width), (x1 - pad_x) / scale)), max(0.0, min(float(image_height), (y1 - pad_y) / scale)), max(0.0, min(float(image_width), (x2 - pad_x) / scale)), max(0.0, min(float(image_height), (y2 - pad_y) / scale))]})
    return sorted(decoded, key=lambda item: (-item["confidence"], item["classId"]))[: int(manifest["postprocess"]["maxDetections"])]


def decode(output: np.ndarray, manifest: dict[str, Any], image_size: tuple[int, int], scale: float, pad_x: float, pad_y: float) -> list[dict[str, Any]]:
    output_format = manifest["outputFormat"]
    if output_format == "raw-cxcywh-class-scores":
        if manifest["requiresNms"] is not True:
            raise ValueError("Raw model output requires external NMS.")
        return decode_raw(output, manifest, image_size, scale, pad_x, pad_y)
    if output_format == "end-to-end-xyxy":
        if manifest["requiresNms"] is not False:
            raise ValueError("End-to-end model output must not apply external NMS.")
        return decode_end_to_end(output, manifest, image_size, scale, pad_x, pad_y)
    raise ValueError(f"Unsupported output format: {output_format}")


def verify_model(config: ModelConfig, checkpoint: Path, onnx_path: Path, manifest_path: Path, image_path: Path | None) -> dict[str, Any]:
    if not checkpoint.exists():
        raise FileNotFoundError(f"Checkpoint not found for {config.id}: {checkpoint}")
    if not onnx_path.exists():
        raise FileNotFoundError(f"ONNX artifact not found for {config.id}: {onnx_path}")
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found for {config.id}: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("modelId") != config.id:
        raise ValueError(f"Manifest modelId does not match {config.id}: {manifest.get('modelId')!r}")
    input_size, labels = int(manifest["inputSize"]), list(manifest["labels"])
    resolved_image_path = image_path or create_sample(ROOT / "outputs" / "verification-sample.png")
    image = Image.open(resolved_image_path).convert("RGB")
    pt_result = YOLO(str(checkpoint)).predict(source=str(resolved_image_path), imgsz=input_size, conf=float(manifest["postprocess"]["confidenceThreshold"]), iou=float(manifest["postprocess"]["iouThreshold"]), device="cpu", verbose=False)[0]
    pt_detections = [{"classId": int(class_id), "confidence": float(score), "bounds": [float(value) for value in bounds]} for bounds, score, class_id in zip(pt_result.boxes.xyxy.cpu().numpy(), pt_result.boxes.conf.cpu().numpy(), pt_result.boxes.cls.cpu().numpy(), strict=True)]
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    tensor, scale, pad_x, pad_y = letterbox(image, input_size)
    output = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    onnx_detections = decode(output, manifest, image.size, scale, pad_x, pad_y)
    matched = sum(any(candidate["classId"] == item["classId"] and iou(np.asarray(candidate["bounds"]), np.asarray(item["bounds"])) >= 0.5 and abs(candidate["confidence"] - item["confidence"]) <= 0.20 for candidate in onnx_detections) for item in pt_detections)
    match_ratio = matched / len(pt_detections) if pt_detections else 1.0
    report = {"modelId": config.id, "image": str(resolved_image_path.resolve()), "providers": session.get_providers(), "inputShape": list(session.get_inputs()[0].shape), "outputShapes": [list(output.shape)], "outputFormat": manifest["outputFormat"], "requiresNms": manifest["requiresNms"], "labels": labels, "ptDetectionCount": len(pt_detections), "onnxDetectionCount": len(onnx_detections), "matchedDetectionCount": matched, "matchRatio": match_ratio, "confidenceTolerance": 0.20, "status": "passed" if match_ratio >= 0.7 else "failed", "ptTop": pt_detections[:20], "onnxTop": onnx_detections[:20]}
    output_path = ROOT / "outputs" / f"{config.id}-verification-report.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["status"] != "passed":
        raise SystemExit(1)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare configured Ultralytics PT models with direct ONNX Runtime detections.")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--model")
    selection.add_argument("--all", action="store_true")
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--onnx", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--image", type=Path)
    args = parser.parse_args()
    models = get_models(args.model, args.all)
    if len(models) != 1 and (args.checkpoint or args.onnx or args.manifest):
        parser.error("--checkpoint, --onnx, and --manifest can only be used with --model.")
    reports = [verify_model(config, args.checkpoint or config.checkpoint_path, args.onnx or config.onnx_path, args.manifest or config.manifest_path, args.image) for config in models]
    if len(reports) > 1:
        print(json.dumps({"verifiedModels": [report["modelId"] for report in reports], "status": "passed"}, indent=2))


if __name__ == "__main__":
    main()
