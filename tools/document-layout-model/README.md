# Document layout model tools

This directory downloads, exports, and verifies the configured YOLO11 and YOLO26 document-layout models. Model IDs, repositories, filenames, input sizes, and postprocessing thresholds have one source of truth in `models.json`.

```powershell
py -3.10 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python download_model.py --model yolo26n-doc-layout
.\.venv\Scripts\python export_onnx.py --model yolo26n-doc-layout
.\.venv\Scripts\python verify_onnx.py --model yolo26n-doc-layout --image C:\path\to\document-page.png
```

Process all six configured models while reusing existing artifacts:

```powershell
.\.venv\Scripts\python download_model.py --all
.\.venv\Scripts\python export_onnx.py --all
.\.venv\Scripts\python verify_onnx.py --all
```

Use `--force` with download or export to replace an existing artifact. Exports use fixed `1x3x1280x1280` FP32 input, batch 1, ONNX opset 17, and simplification. Labels and tensor metadata come from the loaded model and exported graph. Output format is inferred from the actual graph shape and stored in each manifest. Browser artifacts and the generated `model-catalog.json` are copied into `apps/web/public/models/document-layout/`.

Omitting `--image` uses a generated smoke-test document. A real page image is needed for a meaningful accuracy comparison.
