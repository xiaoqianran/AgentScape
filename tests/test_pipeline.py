from __future__ import annotations

import json
from pathlib import Path

from agentscape.pipeline import TextTo3DPipeline


class FakeImageProvider:
    def generate(self, prompt: str, destination: Path, **kwargs) -> dict:
        destination.write_bytes(b"image")
        return {"task_id": 11}


class FakeReconstructionProvider:
    def reconstruct(self, image_path: Path, destination: Path, **kwargs) -> dict:
        assert image_path.read_bytes() == b"image"
        destination.write_bytes(b"glTFmock")
        return {"project_id": "p1", "job_id": "j1"}


def test_pipeline_writes_manifest(tmp_path: Path) -> None:
    pipeline = TextTo3DPipeline(FakeImageProvider(), FakeReconstructionProvider())
    result = pipeline.run(
        "mossy shrine",
        tmp_path,
        reconstruction_model="fastsam3d",
    )

    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert result["schema"] == "agentscape.asset.v1"
    assert manifest["jobs"] == {
        "image_task_id": 11,
        "modal_project_id": "p1",
        "modal_job_id": "j1",
    }
    assert (tmp_path / "reference.webp").is_file()
    assert (tmp_path / "model.glb").is_file()
