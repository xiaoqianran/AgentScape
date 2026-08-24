from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from .providers import KaggleImageProvider, Modal3DProvider


class TextTo3DPipeline:
    def __init__(self, image_provider: KaggleImageProvider, reconstruction_provider: Modal3DProvider) -> None:
        self.image_provider = image_provider
        self.reconstruction_provider = reconstruction_provider

    def run(
        self,
        prompt: str,
        output_dir: Path,
        *,
        image_model: str = "sana-sprint-1.6b",
        reconstruction_model: str,
        profile: str = "recommended",
        image_seed: int | None = None,
        reconstruction_seed: int = 42,
    ) -> dict:
        output_dir.mkdir(parents=True, exist_ok=True)
        reference = output_dir / "reference.webp"
        model_path = output_dir / "model.glb"

        image_result = self.image_provider.generate(
            prompt,
            reference,
            model=image_model,
            seed=image_seed,
        )
        reconstruction_result = self.reconstruction_provider.reconstruct(
            reference,
            model_path,
            concept=prompt,
            model=reconstruction_model,
            profile=profile,
            seed=reconstruction_seed,
        )
        manifest = {
            "schema": "agentscape.asset.v1",
            "created_at": datetime.now(UTC).isoformat(),
            "prompt": prompt,
            "providers": {
                "image": {"name": "kaggle-inference-hub", "model": image_model},
                "reconstruction": {
                    "name": "modal-3D-client",
                    "model": reconstruction_model,
                    "profile": profile,
                },
            },
            "artifacts": {"reference": reference.name, "model": model_path.name},
            "jobs": {
                "image_task_id": image_result["task_id"],
                "modal_project_id": reconstruction_result["project_id"],
                "modal_job_id": reconstruction_result["job_id"],
            },
        }
        (output_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return manifest
