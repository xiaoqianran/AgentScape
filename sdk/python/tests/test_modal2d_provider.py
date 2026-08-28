from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import pytest

from agentscape.errors import ArtifactError, ContractError
from agentscape.providers.modal2d import Modal2DProvider


PNG = b"\x89PNG\r\n\x1a\nmock-png"


def descriptor(data: bytes = PNG, **overrides) -> dict[str, object]:
    value: dict[str, object] = {
        "id": "art_image_01",
        "role": "primary-image",
        "mime": "image/png",
        "format": "png",
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "width": 1024,
        "height": 1024,
    }
    value.update(overrides)
    return value


def test_modal2d_generate_contract(tmp_path: Path) -> None:
    artifact = descriptor()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Modal-2D-Session"] == "session-token"
        path = request.url.path
        if request.method == "POST" and path == "/v1/jobs":
            assert request.read().decode() == "{\"prompt\":\"mossy shrine\",\"model\":\"sana-sprint-0.6b\",\"seed\":7}"
            return httpx.Response(
                200,
                json={"id": "job_image", "model": "sana-sprint-0.6b", "status": "running"},
            )
        if request.method == "GET" and path == "/v1/jobs/job_image":
            return httpx.Response(
                200,
                json={
                    "id": "job_image",
                    "model": "sana-sprint-0.6b",
                    "status": "succeeded",
                    "result": {"artifact": artifact},
                },
            )
        if request.method == "GET" and path == "/v1/jobs/job_image/artifact":
            return httpx.Response(
                200,
                content=PNG,
                headers={
                    "Content-Type": "image/png",
                    "X-Artifact-ID": "art_image_01",
                    "X-Artifact-SHA256": str(artifact["sha256"]),
                },
            )
        raise AssertionError(f"unexpected request: {request.method} {path}")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = Modal2DProvider("http://agent", "session-token", client=client, poll_interval=0)
    destination = tmp_path / "reference.png"
    result = provider.generate(
        "mossy shrine",
        destination,
        model="sana-sprint-0.6b",
        seed=7,
    )

    assert result.provider == "modal-2d"
    assert result.task_id == "job_image"
    assert result.artifact.id == "art_image_01"
    assert result.artifact.mime == "image/png"
    assert result.artifact.format == "png"
    assert result.artifact.hash == "sha256:" + str(artifact["sha256"])
    assert destination.read_bytes() == PNG


def test_modal2d_models_unwraps_agent_response() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"models": [{"id": "sana-sprint-1.6b"}]})
        )
    )
    assert Modal2DProvider("http://agent", client=client).models() == [
        {"id": "sana-sprint-1.6b"}
    ]


def test_modal2d_cancel_uses_provider_job_endpoint() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        assert request.url.path == "/v1/jobs/job_image"
        return httpx.Response(200, json={"id": "job_image", "status": "cancel_requested"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    state = Modal2DProvider("http://agent", client=client).cancel("job_image")
    assert state["status"] == "cancel_requested"


def test_modal2d_rejects_non_primary_or_wrong_sized_descriptor() -> None:
    with pytest.raises(ContractError, match="primary-image PNG"):
        Modal2DProvider._artifact_descriptor(
            {"result": {"artifact": descriptor(role="preview")}}
        )
    with pytest.raises(ContractError, match="1024x1024"):
        Modal2DProvider._artifact_descriptor(
            {"result": {"artifact": descriptor(width=512)}}
        )


def test_modal2d_hash_mismatch_never_replaces_destination(tmp_path: Path) -> None:
    destination = tmp_path / "reference.png"
    destination.write_bytes(b"keep-me")
    bad = descriptor(sha256="0" * 64)
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, content=PNG, headers={"Content-Type": "image/png"})
        )
    )
    provider = Modal2DProvider("http://agent", client=client)

    with pytest.raises(ArtifactError, match="SHA-256"):
        provider.download_artifact("job_image", bad, destination)
    assert destination.read_bytes() == b"keep-me"



def test_modal2d_rejects_job_identity_drift_before_followup_request() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(200, json={"id": "other", "status": "running"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = Modal2DProvider("http://agent", client=client)
    with pytest.raises(ContractError, match="URL-safe"):
        provider.get_job("../escape")
    assert calls == []


def test_modal2d_submit_rejects_model_identity_drift() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                json={"id": "job_image", "model": "sana-sprint-1.6b", "status": "running"},
            )
        )
    )
    provider = Modal2DProvider("http://agent", client=client)
    with pytest.raises(ContractError, match="model identity"):
        provider.submit("mossy shrine", model="sana-sprint-0.6b")
