from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
from typing import Any

import onnx
from ultralytics import YOLO
from model_catalog import MODEL_VERSION, WEB_OUTPUT, ModelConfig, get_models, sync_browser_catalog


def tensor_shape(value_info: Any) -> list[int | str | None]:
    dimensions: list[int | str | None] = []
    for dimension in value_info.type.tensor_type.shape.dim:
        if dimension.dim_value:
            dimensions.append(int(dimension.dim_value))
        elif dimension.dim_param:
            dimensions.append(str(dimension.dim_param))
        else:
            dimensions.append(None)
    return dimensions


def ordered_labels(names: dict[int, str] | list[str]) -> list[str]:
    if isinstance(names, list):
        return [str(name) for name in names]
    return [str(names[index]) for index in sorted(names)]


def infer_output_format(output_shapes: list[list[int | str | None]], label_count: int) -> tuple[str, bool, str]:
    if len(output_shapes) != 1:
        raise ValueError(f"Expected one detection output, received {len(output_shapes)}.")
    shape = output_shapes[0]
    if len(shape) != 3 or shape[0] != 1:
        raise ValueError(f"Unsupported detection output shape: {shape}")
    dimensions = {dimension for dimension in shape[1:] if isinstance(dimension, int)}
    if 4 + label_count in dimensions:
        return "raw-cxcywh-class-scores", True, "cxcywh"
    if 6 in dimensions:
        return "end-to-end-xyxy", False, "xyxy"
    raise ValueError(f"Cannot infer output format for {label_count} labels from shape {shape}.")


def export_model(config: ModelConfig, checkpoint: Path, output: Path, web_output: Path, force: bool) -> None:
    if not checkpoint.exists():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint}")
    manifest_path = output.with_name(config.manifest_filename)
    if output.exists() and manifest_path.exists() and not force:
        web_output.mkdir(parents=True, exist_ok=True)
        shutil.copy2(output, web_output / output.name)
        shutil.copy2(manifest_path, web_output / manifest_path.name)
        print(f"Reusing ONNX and manifest: {output.resolve()}")
        return

    output.parent.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(checkpoint))
    exported_path = Path(model.export(format="onnx", imgsz=config.input_size, batch=1, dynamic=False, simplify=True, opset=17, nms=False, device="cpu"))
    if exported_path.resolve() != output.resolve():
        shutil.copy2(exported_path, output)

    graph = onnx.load(str(output)).graph
    labels = ordered_labels(model.names)
    output_shapes = [tensor_shape(value) for value in graph.output]
    output_format, requires_nms, box_format = infer_output_format(output_shapes, len(labels))
    manifest = {"modelId": config.id, "version": MODEL_VERSION, "family": config.family, "variant": config.variant, "inputSize": config.input_size, "inputLayout": "NCHW", "labels": labels, "input": {"name": graph.input[0].name, "shape": tensor_shape(graph.input[0]), "dtype": "float32"}, "outputs": [{"name": value.name, "shape": tensor_shape(value), "dtype": "float32"} for value in graph.output], "outputFormat": output_format, "requiresNms": requires_nms, "postprocess": {"boxFormat": box_format, "confidenceThreshold": config.confidence_threshold, "iouThreshold": config.iou_threshold, "maxDetections": 300}}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    web_output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(output, web_output / output.name)
    shutil.copy2(manifest_path, web_output / manifest_path.name)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(f"ONNX: {output.resolve()}")
    print(f"Web: {web_output.resolve()}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export configured document-layout models to fixed-shape ONNX.")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--model")
    selection.add_argument("--all", action="store_true")
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--web-output", type=Path, default=WEB_OUTPUT)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    models = get_models(args.model, args.all)
    if len(models) != 1 and (args.checkpoint or args.output):
        parser.error("--checkpoint and --output can only be used with --model.")
    for config in models:
        export_model(config, args.checkpoint or config.checkpoint_path, args.output or config.onnx_path, args.web_output, args.force)
    catalog_path = sync_browser_catalog()
    print(f"Catalog: {catalog_path.resolve()}")


if __name__ == "__main__":
    main()
