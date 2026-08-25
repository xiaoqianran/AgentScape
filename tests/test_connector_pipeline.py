from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from agentscape.capabilities import MODAL_2D_TEXT_TO_IMAGE, MODAL_3D_IMAGE_TO_3D
from agentscape.connector_pipeline import ConnectorJobRunner, ConnectorTextTo3DPipeline
from agentscape.contracts import Artifact, ArtifactSummary, JobResult
from agentscape.errors import ArtifactError, ProviderError
from agentscape.job_client import JobState
from agentscape.jobs import JobRequest


IMAGE_OPERATION = MODAL_2D_TEXT_TO_IMAGE
RECON_OPERATION = MODAL_3D_IMAGE_TO_3D


def summary(artifact_id: str, role: str, mime: str, digest: str) -> ArtifactSummary:
    return ArtifactSummary(
        id=artifact_id,
        role=role,
        mime=mime,
        bytes=24,
        hash=f"sha256:{digest * 64}",
    )


def state(
    job_id: str,
    request: JobRequest,
    status: str,
    sequence: int,
    artifacts: tuple[ArtifactSummary, ...] = (),
    error_code: str | None = None,
) -> JobState:
    return JobState(
        id=job_id,
        provider=request.provider,
        operation=request.operation,
        request_hash=request.request_hash,
        idempotency_key=request.idempotency_key,
        status=status,
        event_sequence=sequence,
        contract_version="1",
        capability_hash="sha256:cap",
        capability_revision="caprev_01",
        result=JobResult(artifacts) if status == "succeeded" else None,
        error_code=error_code,
    )


class SequenceTransport:
    def __init__(self, request: JobRequest, states: list[JobState]) -> None:
        self.request = request
        self.states = states
        self.index = 0
        self.submit_calls = 0
        self.get_calls = 0

    def submit(self, request: JobRequest) -> JobState:
        assert request == self.request
        self.submit_calls += 1
        return self.states[0]

    def get(self, job_id: str) -> JobState:
        self.get_calls += 1
        self.index = min(self.index + 1, len(self.states) - 1)
        return self.states[self.index]

    def cancel(self, job_id: str) -> JobState:
        current = self.states[self.index]
        return replace(current, status="cancel_requested", event_sequence=current.event_sequence + 1)


class Discovery:
    def __init__(self, transports: dict[tuple[str, str], SequenceTransport]) -> None:
        self.transports = transports
        self.calls: list[tuple[str, str]] = []

    def create_job_transport(self, provider: str, operation: str):
        self.calls.append((provider, operation))
        return self.transports[(provider, operation)]


class Artifacts:
    def __init__(self, model: ArtifactSummary) -> None:
        self.model = model
        self.downloaded: list[str] = []

    @staticmethod
    def select_job_artifact(job: JobState, *, artifact_id=None, role=None) -> ArtifactSummary:
        assert job.result is not None
        selected = next(
            (
                item
                for item in job.result.artifacts
                if (not role or item.role == role) and (not artifact_id or item.id == artifact_id)
            ),
            None,
        )
        if selected is None:
            raise ArtifactError("missing artifact")
        return selected

    @staticmethod
    def validate_summary(item: ArtifactSummary):
        if not item.id or not item.mime or item.bytes is None or not item.hash:
            raise ArtifactError("invalid summary")
        return item.id, item.mime, item.bytes, item.hash, "png"

    def download(self, item: ArtifactSummary, destination: Path) -> Artifact:
        assert item == self.model
        destination.write_bytes(b"glTFmock")
        self.downloaded.append(item.id)
        return Artifact(
            path=destination,
            mime="model/gltf-binary",
            format="glb",
            bytes=item.bytes or 0,
            hash=item.hash or "",
            id=item.id,
        )


def test_job_runner_discovers_and_polls_to_success() -> None:
    request = JobRequest(provider="modal-2d", operation=IMAGE_OPERATION)
    image = summary("image_01", "primary-image", "image/png", "a")
    transport = SequenceTransport(
        request,
        [
            state("job_image", request, "accepted", 1),
            state("job_image", request, "running", 2),
            state("job_image", request, "succeeded", 3, (image,)),
        ],
    )
    discovery = Discovery({("modal-2d", IMAGE_OPERATION): transport})

    finished = ConnectorJobRunner(discovery, poll_interval=0).run(request, timeout=10)

    assert finished.status == "succeeded"
    assert discovery.calls == [("modal-2d", IMAGE_OPERATION)]
    assert transport.submit_calls == 1
    assert transport.get_calls == 2


def test_job_runner_failure_and_timeout_are_bounded() -> None:
    request = JobRequest(provider="modal-3d", operation=RECON_OPERATION)
    failed = state("job_3d", request, "failed", 1, error_code="GPU_FAILED")
    failed = replace(failed, error_message="secret provider detail")
    runner = ConnectorJobRunner(
        Discovery({("modal-3d", RECON_OPERATION): SequenceTransport(request, [failed])}),
        poll_interval=0,
    )
    with pytest.raises(ProviderError) as exc:
        runner.run(request)
    assert "GPU_FAILED" in str(exc.value)
    assert "secret provider detail" not in str(exc.value)

    running = state("job_3d", request, "running", 1)
    now = [0.0]
    timeout_runner = ConnectorJobRunner(
        Discovery({("modal-3d", RECON_OPERATION): SequenceTransport(request, [running])}),
        poll_interval=1,
        monotonic=lambda: now[0],
        sleep=lambda seconds: now.__setitem__(0, now[0] + seconds),
    )
    with pytest.raises(TimeoutError, match="did not finish"):
        timeout_runner.run(request, timeout=2)


def _builders(prompt: str):
    image_request = JobRequest(
        provider="modal-2d",
        operation=IMAGE_OPERATION,
        inputs={"confirmedPrompt": prompt},
        output_roles=("primary-image",),
    )
    captured: dict[str, object] = {}

    def image_builder(value: str) -> JobRequest:
        assert value == prompt
        return image_request

    def reconstruction_builder(source: ArtifactSummary, parent: JobState, value: str) -> JobRequest:
        captured.update(source=source, parent=parent, prompt=value)
        return JobRequest(
            provider="modal-3d",
            operation=RECON_OPERATION,
            inputs={"sourceArtifactId": source.id},
            parent={"jobId": parent.id},
            output_roles=("primary-glb",),
        )

    return image_request, image_builder, reconstruction_builder, captured


def test_composed_pipeline_passes_opaque_image_reference_and_downloads_only_glb(tmp_path: Path) -> None:
    prompt = "mossy shrine"
    image_request, image_builder, reconstruction_builder, captured = _builders(prompt)
    image = summary("image_01", "primary-image", "image/png", "b")
    model = summary("model_01", "primary-glb", "model/gltf-binary", "c")
    image_transport = SequenceTransport(
        image_request,
        [state("job_image", image_request, "succeeded", 1, (image,))],
    )
    reconstruction_request = JobRequest(
        provider="modal-3d",
        operation=RECON_OPERATION,
        inputs={"sourceArtifactId": image.id},
        parent={"jobId": "job_image"},
        output_roles=("primary-glb",),
    )
    reconstruction_transport = SequenceTransport(
        reconstruction_request,
        [state("job_3d", reconstruction_request, "succeeded", 1, (model,))],
    )
    discovery = Discovery(
        {
            ("modal-2d", IMAGE_OPERATION): image_transport,
            ("modal-3d", RECON_OPERATION): reconstruction_transport,
        }
    )
    artifacts = Artifacts(model)
    pipeline = ConnectorTextTo3DPipeline(
        ConnectorJobRunner(discovery, poll_interval=0),
        artifacts,
        image_builder,
        reconstruction_builder,
    )

    manifest = pipeline.run(prompt, tmp_path)

    assert captured["source"] == image
    assert captured["parent"].id == "job_image"
    assert captured["prompt"] == prompt
    assert artifacts.downloaded == ["model_01"]
    assert not (tmp_path / "reference.png").exists()
    assert (tmp_path / "model.glb").exists()
    assert manifest["schema"] == "agentscape-client.connector-result.v1"
    assert manifest["strategy"] == "connector-composed-text-to-3d"
    assert manifest["jobs"] == {
        "image_job_id": "job_image",
        "reconstruction_job_id": "job_3d",
    }
    assert manifest["artifacts"]["reference"]["id"] == "image_01"
    assert manifest["artifacts"]["model"]["path"] == "model.glb"
    assert manifest["artifacts"]["model"]["lineage"]["parents"][0]["artifactId"] == "image_01"
    assert manifest["requests"]["image"] == {
        "requestHash": image_request.request_hash,
        "idempotencyKey": image_request.idempotency_key,
    }
    assert "inputs" not in manifest["requests"]["image"]


def test_composed_pipeline_rejects_lossy_primary_before_3d_submit(tmp_path: Path) -> None:
    prompt = "mossy shrine"
    image_request, image_builder, reconstruction_builder, _ = _builders(prompt)
    image = summary("image_01", "primary-image", "image/webp", "d")
    discovery = Discovery(
        {
            ("modal-2d", IMAGE_OPERATION): SequenceTransport(
                image_request,
                [state("job_image", image_request, "succeeded", 1, (image,))],
            )
        }
    )
    pipeline = ConnectorTextTo3DPipeline(
        ConnectorJobRunner(discovery, poll_interval=0),
        Artifacts(summary("model_01", "primary-glb", "model/gltf-binary", "e")),
        image_builder,
        reconstruction_builder,
    )

    with pytest.raises(ArtifactError, match="lossless"):
        pipeline.run(prompt, tmp_path)

    assert discovery.calls == [("modal-2d", IMAGE_OPERATION)]
    assert not (tmp_path / "manifest.json").exists()


def test_composed_pipeline_removes_stale_manifest_before_failure(tmp_path: Path) -> None:
    (tmp_path / "manifest.json").write_text("stale")
    prompt = "mossy shrine"
    image_request, image_builder, reconstruction_builder, _ = _builders(prompt)
    failed = state("job_image", image_request, "failed", 1, error_code="REMOTE_FAILED")
    discovery = Discovery(
        {("modal-2d", IMAGE_OPERATION): SequenceTransport(image_request, [failed])}
    )
    pipeline = ConnectorTextTo3DPipeline(
        ConnectorJobRunner(discovery, poll_interval=0),
        Artifacts(summary("model_01", "primary-glb", "model/gltf-binary", "f")),
        image_builder,
        reconstruction_builder,
    )

    with pytest.raises(ProviderError):
        pipeline.run(prompt, tmp_path)

    assert not (tmp_path / "manifest.json").exists()
