from __future__ import annotations

import argparse
from pathlib import Path
import shutil

from huggingface_hub import hf_hub_download
from model_catalog import get_models


def main() -> None:
    parser = argparse.ArgumentParser(description="Download configured document-layout checkpoints.")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--model")
    selection.add_argument("--all", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    models = get_models(args.model, args.all)
    if args.output and len(models) != 1:
        parser.error("--output can only be used with --model.")
    for model in models:
        output = args.output or model.checkpoint_path
        if output.exists() and not args.force:
            print(f"Reusing checkpoint: {output.resolve()}")
            continue
        output.parent.mkdir(parents=True, exist_ok=True)
        cached_path = Path(hf_hub_download(repo_id=model.repository_id, filename=model.checkpoint_filename))
        shutil.copy2(cached_path, output)
        print(f"Downloaded checkpoint: {output.resolve()}")


if __name__ == "__main__":
    main()
