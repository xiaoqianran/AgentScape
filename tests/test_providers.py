from __future__ import annotations

from pathlib import Path

import httpx

from agentscape.providers.kaggle import KaggleImageProvider
from agentscape.providers.modal3d import Modal3DProvider


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

    assert result["task_id"] == 7
    assert destination.read_bytes() == image


def test_modal_reconstruct_contract(tmp_path: Path) -> None:
    glb = b"glTF" + b"\x02\x00\x00\x00" + b"\x0c\x00\x00\x00"
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

    assert result["project_id"] == "p1"
    assert result["job_id"] == "j1"
    assert result["candidate_id"] == "c00"
    assert destination.read_bytes() == glb
