from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from agentscape.errors import ArtifactError, ContractError, ProviderError
from agentscape.providers.kaggle import KaggleImageProvider
from agentscape.providers.modal3d import Modal3DProvider


def make_glb(payload: bytes = b"") -> bytes:
    size = 12 + len(payload)
    return b"glTF" + (2).to_bytes(4, "little") + size.to_bytes(4, "little") + payload


def test_kaggle_generate_contract(tmp_path: Path) -> None:
    image = b"RIFFxxxxWEBPmock-image"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/task":
            assert request.headers["Authorization"] == "Bearer test-token"
            return httpx.Response(202, json={"task": {"id": 7}})
        if request.method == "GET" and request.url.path == "/api/history":
            assert request.url.params["model"] == "sana-sprint-1.6b"
            return httpx.Response(
                200,
                json=[
                    {
                        "kind": "image",
                        "id": 7,
                        "model": "sana-sprint-1.6b",
                        "url": "/images/sana-sprint-1.6b/result.webp",
                    }
                ],
            )
        if request.method == "GET" and request.url.path == "/images/sana-sprint-1.6b/result.webp":
            return httpx.Response(200, content=image)
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = KaggleImageProvider("http://hub", "test-token", client=client, poll_interval=0)
    destination = tmp_path / "reference.webp"
    result = provider.generate("mossy shrine", destination)

    assert result.task_id == "7"
    assert result.provider == "kaggle-inference-hub"
    assert result.artifact.mime == "image/webp"
    assert result.artifact.hash.startswith("sha256:")
    assert destination.read_bytes() == image


def test_kaggle_missing_task_id_is_contract_error() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(202, json={"task": {}}))
    )
    provider = KaggleImageProvider("http://hub", "test-token", client=client)

    with pytest.raises(ContractError, match="task.id"):
        provider.submit("mossy shrine")


def test_modal_reconstruct_contract(tmp_path: Path) -> None:
    glb = make_glb()
    source = tmp_path / "reference.webp"
    source.write_bytes(b"RIFFxxxxWEBPmock-image")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Modal-3D-Session"] == "session-token"
        path = request.url.path
        if request.method == "POST" and path == "/v1/projects":
            return httpx.Response(200, json={"id": "p1"})
        if request.method == "POST" and path == "/v1/projects/p1/segment":
            return httpx.Response(
                200,
                json={"selection": {"selection_id": "s1", "candidates": [{"candidate_id": "c00"}]}},
            )
        if request.method == "POST" and path == "/v1/projects/p1/materialize":
            return httpx.Response(200, json={"canonical": {"canonical_path": "canonical/x.png"}})
        if request.method == "POST" and path == "/v1/projects/p1/generation":
            return httpx.Response(200, json={"job": {"id": "j1", "status": "running"}})
        if request.method == "GET" and path == "/v1/jobs/j1":
            return httpx.Response(
                200,
                json={
                    "id": "j1",
                    "status": "succeeded",
                    "result": {"artifact": {"path": "models/x.glb"}},
                },
            )
        if request.method == "GET" and path == "/v1/assets":
            assert request.url.params["path"] == "models/x.glb"
            return httpx.Response(200, content=glb)
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = Modal3DProvider("http://agent", "session-token", client=client, poll_interval=0)
    destination = tmp_path / "model.glb"
    result = provider.reconstruct(
        source,
        destination,
        concept="mossy shrine",
        model="fastsam3d",
    )

    assert result.provider == "modal-3d"
    assert result.project_id == "p1"
    assert result.job_id == "j1"
    assert result.candidate_id == "c00"
    assert result.artifact.mime == "model/gltf-binary"
    assert result.artifact.format == "glb"
    assert result.artifact.bytes == len(glb)
    assert result.artifact.hash.startswith("sha256:")
    assert destination.read_bytes() == glb


def test_modal_no_candidate_fails_before_generation(tmp_path: Path) -> None:
    source = tmp_path / "reference.webp"
    source.write_bytes(b"image")
    provider = Modal3DProvider("http://agent")
    provider.create_project = lambda _: {"id": "p1"}
    provider.segment = lambda _project_id, _concept: {"selection": {"candidates": []}}

    with pytest.raises(ProviderError, match="SAM found no candidate"):
        provider.reconstruct(source, tmp_path / "model.glb", concept="missing", model="m1")


def test_modal_failed_job_is_provider_error() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                json={"id": "j1", "status": "failed", "error": "gpu failed"},
            )
        )
    )
    provider = Modal3DProvider("http://agent", client=client, poll_interval=0)

    with pytest.raises(ProviderError, match="gpu failed"):
        provider.wait("j1", timeout=1)


def test_modal_wait_timeout() -> None:
    provider = Modal3DProvider("http://agent", poll_interval=0)

    with pytest.raises(TimeoutError, match="did not finish"):
        provider.wait("j1", timeout=0)


def test_modal_succeeded_without_artifact_is_contract_error(tmp_path: Path) -> None:
    source = tmp_path / "reference.webp"
    source.write_bytes(b"image")
    provider = Modal3DProvider("http://agent")
    provider.create_project = lambda _: {"id": "p1"}
    provider.segment = lambda *_: {"selection": {"candidates": [{"candidate_id": "c1"}]}}
    provider.materialize = lambda *_args, **_kwargs: {}
    provider.submit_generation = lambda *_args, **_kwargs: {"id": "j1"}
    provider.wait = lambda *_args, **_kwargs: {"id": "j1", "status": "succeeded", "result": {}}

    with pytest.raises(ContractError, match="result.artifact.path"):
        provider.reconstruct(source, tmp_path / "model.glb", concept="x", model="m1")


def test_modal_invalid_glb_does_not_replace_existing_file(tmp_path: Path) -> None:
    destination = tmp_path / "model.glb"
    destination.write_bytes(b"existing")
    client = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=b"not-a-glb"))
    )
    provider = Modal3DProvider("http://agent", client=client)

    with pytest.raises(ArtifactError, match="有效 GLB"):
        provider.download_artifact("models/x.glb", destination)

    assert destination.read_bytes() == b"existing"


def test_modal_glb_length_mismatch_is_rejected(tmp_path: Path) -> None:
    glb = b"glTF" + (2).to_bytes(4, "little") + (99).to_bytes(4, "little")
    client = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=glb))
    )
    provider = Modal3DProvider("http://agent", client=client)

    with pytest.raises(ArtifactError, match="长度不一致"):
        provider.download_artifact("models/x.glb", tmp_path / "model.glb")
