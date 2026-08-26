from __future__ import annotations

import json
from pathlib import Path

from agentscape.contracts import Artifact, ImageGenerationResult, ReconstructionResult
from agentscape.pipeline import TextTo3DPipeline


def glb() -> bytes:
    json_chunk = b"{}  "
    total = 20 + len(json_chunk)
    return (
        b"glTF"
        + (2).to_bytes(4, "little")
        + total.to_bytes(4, "little")
        + len(json_chunk).to_bytes(4, "little")
        + (0x4E4F534A).to_bytes(4, "little")
        + json_chunk
    )


class FakeImageProvider:
    name = "fake-image"
    output_role = "legacy-lossy"
    output_suffix = ".webp"

    def generate(self, prompt: str, destination: Path, *, model: str, seed: int | None = None) -> ImageGenerationResult:
        destination.write_bytes(b"image")
        return ImageGenerationResult(
            provider="fake-image",
            model=model,
            task_id="11",
            artifact=Artifact.from_file(destination, mime="image/webp", format="webp"),
        )


class FakeReconstructionProvider:
    name = "fake-3d"
    operation = "fake-3d.asset.image_to_3d.v1"

    def reconstruct(self, image_path: Path, destination: Path, **kwargs) -> ReconstructionResult:
        assert image_path.read_bytes() == b"image"
        destination.write_bytes(glb())
        return ReconstructionResult(
            provider="fake-3d",
            model=kwargs["model"],
            project_id="p1",
            job_id="j1",
            candidate_id="c1",
            artifact=Artifact.from_file(destination, mime="model/gltf-binary", format="glb"),
        )


def test_pipeline_writes_manifest(tmp_path: Path) -> None:
    pipeline = TextTo3DPipeline(FakeImageProvider(), FakeReconstructionProvider())
    result = pipeline.run(
        "mossy shrine",
        tmp_path,
        reconstruction_model="fastsam3d",
    )

    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert result["schema"] == "agentscape-client.result.v1"
    assert manifest["providers"]["image"]["name"] == "fake-image"
    assert manifest["jobs"] == {
        "image_task_id": "11",
        "modal_project_id": "p1",
        "modal_job_id": "j1",
    }
    assert manifest["artifacts"]["reference"]["path"] == "reference.webp"
    assert manifest["artifacts"]["reference"]["role"] == "legacy-lossy"
    assert manifest["artifacts"]["model"]["role"] == "primary-glb"
    assert manifest["artifacts"]["model"]["mime"] == "model/gltf-binary"
    assert manifest["artifacts"]["model"]["format"] == "glb"
    assert manifest["artifacts"]["model"]["bytes"] == 24
    assert manifest["artifacts"]["model"]["hash"].startswith("sha256:")
    assert manifest["request"]["provider"] == "fake-3d"
    assert manifest["request"]["operation"] == "fake-3d.asset.image_to_3d.v1"
    assert manifest["request"]["outputRoles"] == ["primary-glb"]
    assert manifest["request"]["options"] == {"model": "fastsam3d", "seed": 42}
    assert manifest["request"]["requestHash"].startswith("sha256:")
    assert manifest["request"]["idempotencyKey"].startswith("idem_")


def test_pipeline_exposes_agentscape_job_result(tmp_path: Path) -> None:
    manifest = TextTo3DPipeline(FakeImageProvider(), FakeReconstructionProvider()).run(
        "mossy shrine",
        tmp_path,
        reconstruction_model="fastsam3d",
    )

    model = manifest["artifacts"]["model"]
    reference = manifest["artifacts"]["reference"]
    assert manifest["result"] == {
        "artifacts": [
            {
                "id": model["id"],
                "role": "primary-glb",
                "mime": "model/gltf-binary",
                "bytes": model["bytes"],
                "hash": model["hash"],
            }
        ]
    }
    assert model["lineage"] == {
        "parents": [
            {
                "artifactId": reference["id"],
                "hash": reference["hash"],
                "relation": "derived_from",
            }
        ]
    }


class FakePrimaryImageProvider(FakeImageProvider):
    name = "modal-2d"
    output_role = "primary-image"
    output_suffix = ".png"

    def generate(self, prompt: str, destination: Path, *, model: str, seed: int | None = None) -> ImageGenerationResult:
        destination.write_bytes(b"image")
        return ImageGenerationResult(
            provider=self.name,
            model=model,
            task_id="job_image",
            artifact=Artifact.from_file(destination, mime="image/png", format="png"),
        )


def test_pipeline_preserves_lossless_primary_image_role(tmp_path: Path) -> None:
    manifest = TextTo3DPipeline(FakePrimaryImageProvider(), FakeReconstructionProvider()).run(
        "mossy shrine",
        tmp_path,
        reconstruction_model="fastsam3d",
    )

    reference = manifest["artifacts"]["reference"]
    assert reference["path"] == "reference.png"
    assert reference["role"] == "primary-image"
    assert reference["mime"] == "image/png"
    assert reference["format"] == "png"
