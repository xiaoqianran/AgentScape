from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from .artifacts import write_atomic
from .providers.base import ImageProvider, ReconstructionProvider


class TextTo3DPipeline:
    def __init__(self, image_provider: ImageProvider, reconstruction_provider: ReconstructionProvider) -> None:
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
    ) -> dict[str, object]:
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "manifest.json").unlink(missing_ok=True)
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

        manifest: dict[str, object] = {
            "schema": "agentscape.asset.v1",
            "created_at": datetime.now(UTC).isoformat(),
            "prompt": prompt,
            "providers": {
                "image": {"name": image_result.provider, "model": image_result.model},
                "reconstruction": {
                    "name": reconstruction_result.provider,
                    "model": reconstruction_result.model,
                    "profile": profile,
                },
            },
            "artifacts": {
                "reference": image_result.artifact.to_dict(relative_to=output_dir),
                "model": reconstruction_result.artifact.to_dict(relative_to=output_dir),
            },
            "jobs": {
                "image_task_id": image_result.task_id,
                "modal_project_id": reconstruction_result.project_id,
                "modal_job_id": reconstruction_result.job_id,
            },
        }
        write_atomic(
            output_dir / "manifest.json",
            (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode(),
        )
        return manifest
