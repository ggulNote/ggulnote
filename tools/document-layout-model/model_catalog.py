from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = ROOT.parents[1]
ARTIFACTS = ROOT / "artifacts"
WEB_OUTPUT = REPOSITORY_ROOT / "apps" / "web" / "public" / "models" / "document-layout"
MODEL_VERSION = "1"


@dataclass(frozen=True)
class ModelConfig:
    id: str
    repository_id: str
    checkpoint_filename: str
    onnx_filename: str
    manifest_filename: str
    family: str
    variant: str
    enabled: bool
    input_size: int
    confidence_threshold: float
    iou_threshold: float

    @property
    def checkpoint_path(self) -> Path:
        return ARTIFACTS / self.checkpoint_filename

    @property
    def onnx_path(self) -> Path:
        return ARTIFACTS / self.onnx_filename

    @property
    def manifest_path(self) -> Path:
        return ARTIFACTS / self.manifest_filename


def load_source_catalog() -> tuple[str, list[ModelConfig]]:
    value: Any = json.loads((ROOT / "models.json").read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("defaultModelId"), str):
        raise ValueError("models.json must define defaultModelId.")
    raw_models = value.get("models")
    if not isinstance(raw_models, list):
        raise ValueError("models.json must define a models array.")
    models: list[ModelConfig] = []
    for raw in raw_models:
        if not isinstance(raw, dict):
            raise ValueError("Every model entry must be an object.")
        models.append(
            ModelConfig(
                id=str(raw["id"]), repository_id=str(raw["repositoryId"]), checkpoint_filename=str(raw["checkpointFilename"]),
                onnx_filename=str(raw["onnxFilename"]), manifest_filename=str(raw["manifestFilename"]), family=str(raw["family"]),
                variant=str(raw["variant"]), enabled=bool(raw["enabled"]), input_size=int(raw["inputSize"]),
                confidence_threshold=float(raw["confidenceThreshold"]), iou_threshold=float(raw["iouThreshold"]),
            )
        )
    model_ids = [model.id for model in models]
    if len(model_ids) != len(set(model_ids)):
        raise ValueError("models.json contains duplicate model IDs.")
    if any(model.input_size <= 0 for model in models):
        raise ValueError("Every model inputSize must be positive.")
    if any(not 0 <= model.confidence_threshold <= 1 for model in models):
        raise ValueError("Every confidenceThreshold must be between 0 and 1.")
    if any(not 0 <= model.iou_threshold <= 1 for model in models):
        raise ValueError("Every iouThreshold must be between 0 and 1.")
    if value["defaultModelId"] not in {model.id for model in models if model.enabled}:
        raise ValueError("defaultModelId must reference an enabled model.")
    return value["defaultModelId"], models


def get_model(model_id: str) -> ModelConfig:
    _, models = load_source_catalog()
    match = next((model for model in models if model.id == model_id), None)
    if match is None:
        available = ", ".join(model.id for model in models)
        raise ValueError(f"Unknown model {model_id!r}. Available models: {available}")
    return match


def get_models(model_id: str | None, all_models: bool) -> list[ModelConfig]:
    if all_models:
        _, models = load_source_catalog()
        return models
    if model_id is None:
        raise ValueError("Specify --model MODEL_ID or --all.")
    return [get_model(model_id)]


def load_manifest(model: ModelConfig) -> dict[str, Any]:
    if not model.manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found for {model.id}: {model.manifest_path}")
    value: Any = json.loads(model.manifest_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("modelId") != model.id:
        raise ValueError(f"Manifest for {model.id} is invalid or has a mismatched modelId.")
    if not isinstance(value.get("input"), dict) or not isinstance(value.get("outputs"), list):
        raise ValueError(f"Manifest for {model.id} is missing tensor metadata.")
    return value


def sync_browser_catalog() -> Path:
    default_model_id, models = load_source_catalog()
    browser_models: list[dict[str, Any]] = []
    for model in models:
        if not model.manifest_path.exists() and not model.onnx_path.exists():
            continue
        if not model.onnx_path.exists():
            raise FileNotFoundError(f"ONNX artifact not found for {model.id}: {model.onnx_path}")
        manifest = load_manifest(model)
        browser_models.append({"id": model.id, "family": model.family, "variant": model.variant, "enabled": model.enabled, "modelUrl": f"/models/document-layout/{model.onnx_filename}", "manifestUrl": f"/models/document-layout/{model.manifest_filename}", "inputSize": manifest["inputSize"], "fileSizeBytes": model.onnx_path.stat().st_size, "inputShape": manifest["input"]["shape"], "outputShapes": [output["shape"] for output in manifest["outputs"]], "outputFormat": manifest["outputFormat"], "requiresNms": manifest["requiresNms"]})
    available_ids = {model["id"] for model in browser_models if model["enabled"]}
    if default_model_id not in available_ids:
        raise FileNotFoundError(f"The default model artifact is missing: {default_model_id}")
    catalog = {"defaultModelId": default_model_id, "models": browser_models}
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    WEB_OUTPUT.mkdir(parents=True, exist_ok=True)
    artifact_path = ARTIFACTS / "model-catalog.json"
    payload = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    artifact_path.write_text(payload, encoding="utf-8")
    (WEB_OUTPUT / "model-catalog.json").write_text(payload, encoding="utf-8")
    return artifact_path
