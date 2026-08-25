from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from agentscape.capabilities import MODAL_2D_TEXT_TO_IMAGE, MODAL_3D_IMAGE_TO_3D
from agentscape.connector_artifacts import ConnectorArtifactTransport
from agentscape.connector_capabilities import ConnectorCapabilityClient
from agentscape.connector_pipeline import ConnectorJobRunner, ConnectorTextTo3DPipeline
from agentscape.connector_session import CONNECTOR_SESSION_SCOPES, ConnectorSession
from agentscape.errors import ContractError
from agentscape.jobs import JobRequest
from agentscape.modal2d import Modal2DTextToImageRequestBuilder


NOW = datetime(2026, 8, 25, 6, 0, tzinfo=UTC)
CAPABILITY_HASH = "sha256:" + "a" * 64
CAPABILITY_REVISION = "caprev_e2e_01"
IMAGE_ARTIFACT_ID = "artifact_image_01"
MODEL_ARTIFACT_ID = "artifact_model_01"


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


def capability_snapshot() -> dict[str, object]:
    return {
        "contractVersion": "1",
        "connector": {
            "id": "unified-connector",
            "instance": "instance_e2e",
            "version": "1.0.0",
        },
        "revision": CAPABILITY_REVISION,
        "hash": CAPABILITY_HASH,
        "generatedAt": "2026-08-25T05:59:00.000Z",
        "expiresAt": "2026-08-25T06:30:00.000Z",
        "cachePolicy": {"maxAgeSeconds": 600},
        "providers": [
            {
                "id": "modal-2d",
                "displayName": "Modal 2D",
                "version": "1",
                "health": "healthy",
                "status": "available",
                "contractVersion": "1",
                "artifactTransport": "connector-artifact",
                "capabilities": [
                    {
                        "operation": MODAL_2D_TEXT_TO_IMAGE,
                        "version": "1",
                        "displayName": "Text to Image",
                        "category": "image-generation",
                        "status": "available",
                        "input": {"types": ["text"]},
                        "output": {
                            "roles": ["primary-image"],
                            "required": ["primary-image"],
                            "optional": [],
                        },
                        "execution": {
                            "async": True,
                            "stages": ["queued", "running", "artifact"],
                            "durationClass": "medium",
                            "costClass": "gpu",
                        },
                        "prerequisites": {"authMode": "provider-secret", "connection": False},
                        "support": {"cancel": True, "resume": True, "idempotency": True},
                        "artifactTransport": "connector-artifact",
                    }
                ],
            },
            {
                "id": "modal-3d",
                "displayName": "Modal 3D",
                "version": "1",
                "health": "healthy",
                "status": "available",
                "contractVersion": "1",
                "artifactTransport": "connector-artifact",
                "capabilities": [
                    {
                        "operation": MODAL_3D_IMAGE_TO_3D,
                        "version": "1",
                        "displayName": "Image to 3D",
                        "category": "asset-generation",
                        "status": "available",
                        "input": {"types": ["image", "rgba"]},
                        "output": {
                            "roles": ["primary-glb"],
                            "required": ["primary-glb"],
                            "optional": [],
                        },
                        "execution": {
                            "async": True,
                            "stages": ["queued", "running", "artifact"],
                            "durationClass": "long",
                            "costClass": "gpu",
                        },
                        "prerequisites": {"authMode": "provider-secret", "connection": False},
                        "support": {"cancel": True, "resume": True, "idempotency": True},
                        "artifactTransport": "connector-artifact",
                    }
                ],
            },
        ],
    }


def session_response() -> dict[str, object]:
    return {
        "token": "session-e2e-secret",
        "session": {
            "connector": {
                "id": "unified-connector",
                "instance": "instance_e2e",
                "version": "1.0.0",
            },
            "contractVersion": "1",
            "clientIdentity": "agentscape",
            "tokenId": "token_e2e_01",
            "scopes": list(CONNECTOR_SESSION_SCOPES),
            "issuedAt": "2026-08-25T05:30:00.000Z",
            "expiresAt": "2026-08-25T07:30:00.000Z",
            "allowedOrigins": ["http://localhost:3000"],
            "capabilityRevision": CAPABILITY_REVISION,
            "capabilityHash": CAPABILITY_HASH,
            "revokeEndpoint": "/connector/v1/session",
        },
    }


def job_projection(
    *,
    job_id: str,
    body: dict[str, object],
    status: str,
    sequence: int,
    result: dict[str, object] | None = None,
) -> dict[str, object]:
    projection: dict[str, object] = {
        "id": job_id,
        "provider": body["provider"],
        "operation": body["operation"],
        "kind": "generation",
        "requestHash": body["requestHash"],
        "idempotencyKey": body["idempotencyKey"],
        "contractVersion": body["contractVersion"],
        "capabilityHash": body["capabilityHash"],
        "capabilityRevision": body["capabilityRevision"],
        "status": status,
        "stage": "artifact" if status == "succeeded" else status,
        "attempt": 1,
        "relations": [],
        "effectiveOptions": body.get("options") or {},
        "createdAt": "2026-08-25T06:00:00.000Z",
        "updatedAt": f"2026-08-25T06:00:0{sequence}.000Z",
        "eventSequence": sequence,
    }
    if result is not None:
        projection["result"] = result
        projection["completedAt"] = f"2026-08-25T06:00:0{sequence}.000Z"
    return projection


class OneShotStream(httpx.SyncByteStream):
    def __init__(self, data: bytes) -> None:
        self.data = data

    def __iter__(self):
        yield self.data


class ConnectorHarness:
    def __init__(self, *, drift_second_capability: bool = False) -> None:
        self.model = glb()
        self.model_hash = f"sha256:{hashlib.sha256(self.model).hexdigest()}"
        self.submit_bodies: dict[str, dict[str, object]] = {}
        self.get_counts = {"job_image": 0, "job_model": 0}
        self.calls: list[tuple[str, str]] = []
        self.capability_reads = 0
        self.drift_second_capability = drift_second_capability

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append((request.method, request.url.path))
        assert request.headers["Authorization"] == "Bearer session-e2e-secret"
        path = request.url.path

        if request.method == "GET" and path == "/connector/v1/capabilities":
            self.capability_reads += 1
            payload = capability_snapshot()
            if self.drift_second_capability and self.capability_reads >= 2:
                payload["revision"] = "caprev_e2e_02"
                payload["hash"] = "sha256:" + "d" * 64
            return httpx.Response(200, json=payload)

        if request.method == "POST" and path == "/connector/v1/jobs":
            body = json.loads(request.content)
            assert body["capabilityHash"] == CAPABILITY_HASH
            assert body["capabilityRevision"] == CAPABILITY_REVISION
            assert body["contractVersion"] == "1"
            assert body["operationVersion"] == "1"

            if body["operation"] == MODAL_2D_TEXT_TO_IMAGE:
                assert body["outputRoles"] == ["primary-image"]
                assert body["profile"] == "recommended"
                assert body["inputs"] == {
                    "prompt": "一座长满青苔的蘑菇小屋",
                    "model": "sana-sprint-0.6b",
                    "seed": 42,
                    "guidance": 4.5,
                }
                assert "steps" not in body["inputs"]
                job_id = "job_image"
            elif body["operation"] == MODAL_3D_IMAGE_TO_3D:
                assert body["outputRoles"] == ["primary-glb"]
                assert body["inputs"] == {
                    "sourceArtifact": {
                        "id": IMAGE_ARTIFACT_ID,
                        "role": "primary-image",
                        "mime": "image/png",
                    }
                }
                assert "bytes" not in json.dumps(body["inputs"])
                job_id = "job_model"
            else:
                raise AssertionError(f"unexpected operation: {body['operation']}")

            self.submit_bodies[job_id] = body
            return httpx.Response(
                200,
                json={
                    "job": job_projection(
                        job_id=job_id,
                        body=body,
                        status="accepted",
                        sequence=1,
                    )
                },
            )

        if request.method == "GET" and path in {
            "/connector/v1/jobs/job_image",
            "/connector/v1/jobs/job_model",
        }:
            job_id = path.rsplit("/", 1)[-1]
            self.get_counts[job_id] += 1
            body = self.submit_bodies[job_id]
            if self.get_counts[job_id] == 1:
                return httpx.Response(
                    200,
                    json={
                        "job": job_projection(
                            job_id=job_id,
                            body=body,
                            status="running",
                            sequence=2,
                        )
                    },
                )

            if job_id == "job_image":
                result = {
                    "manifestId": "manifest_image_01",
                    "artifacts": [
                        {
                            "id": IMAGE_ARTIFACT_ID,
                            "role": "primary-image",
                            "mime": "image/png",
                            "bytes": 4096,
                            "hash": "sha256:" + "b" * 64,
                        }
                    ],
                }
            else:
                result = {
                    "manifestId": "manifest_model_01",
                    "artifacts": [
                        {
                            "id": MODEL_ARTIFACT_ID,
                            "role": "primary-glb",
                            "mime": "model/gltf-binary",
                            "bytes": len(self.model),
                            "hash": self.model_hash,
                        }
                    ],
                }
            return httpx.Response(
                200,
                json={
                    "job": job_projection(
                        job_id=job_id,
                        body=body,
                        status="succeeded",
                        sequence=3,
                        result=result,
                    )
                },
            )

        if request.method == "GET" and path == f"/connector/v1/artifacts/{MODEL_ARTIFACT_ID}":
            assert request.headers["Accept"] == "model/gltf-binary"
            return httpx.Response(
                200,
                headers={
                    "content-type": "model/gltf-binary",
                    "content-length": str(len(self.model)),
                },
                stream=OneShotStream(self.model),
            )

        if path == f"/connector/v1/artifacts/{IMAGE_ARTIFACT_ID}":
            raise AssertionError("2D primary-image must remain an opaque remote reference")

        raise AssertionError(f"unexpected request: {request.method} {path}")


def make_pipeline(harness: ConnectorHarness, prompt: str) -> ConnectorTextTo3DPipeline:
    http_client = httpx.Client(transport=httpx.MockTransport(harness))
    session = ConnectorSession.from_response(
        "http://127.0.0.1:39001",
        session_response(),
        origin="http://localhost:3000",
        client=http_client,
        now=lambda: NOW,
    )
    capabilities = ConnectorCapabilityClient(session, now=lambda: NOW)

    image_request = Modal2DTextToImageRequestBuilder(model="sana-sprint-0.6b")

    def reconstruction_request(image, parent, value: str) -> JobRequest:
        assert parent.id == "job_image"
        assert value == prompt
        return JobRequest(
            provider="modal-3d",
            operation=MODAL_3D_IMAGE_TO_3D,
            inputs={
                "sourceArtifact": {
                    "id": image.id,
                    "role": image.role,
                    "mime": image.mime,
                }
            },
            parent={"jobId": parent.id},
            profile="recommended",
            output_roles=("primary-glb",),
        )

    return ConnectorTextTo3DPipeline(
        ConnectorJobRunner(capabilities, poll_interval=0),
        ConnectorArtifactTransport(session),
        image_request,
        reconstruction_request,
    )


def test_full_connector_contract_text_to_3d_e2e(tmp_path: Path) -> None:
    harness = ConnectorHarness()
    prompt = "一座长满青苔的蘑菇小屋"
    manifest = make_pipeline(harness, prompt).run(prompt, tmp_path)

    assert (tmp_path / "model.glb").read_bytes() == harness.model
    assert not (tmp_path / "reference.png").exists()
    assert manifest["jobs"] == {
        "image_job_id": "job_image",
        "reconstruction_job_id": "job_model",
    }
    assert manifest["artifacts"]["reference"]["id"] == IMAGE_ARTIFACT_ID
    assert manifest["artifacts"]["model"]["id"] == MODEL_ARTIFACT_ID
    assert manifest["result"]["manifestId"] == "manifest_model_01"
    assert manifest["result"]["artifacts"][0]["id"] == MODEL_ARTIFACT_ID

    paths = [path for _, path in harness.calls]
    assert paths.count("/connector/v1/capabilities") == 2
    assert f"/connector/v1/artifacts/{IMAGE_ARTIFACT_ID}" not in paths
    assert paths[-1] == f"/connector/v1/artifacts/{MODEL_ARTIFACT_ID}"


def test_full_connector_contract_stops_on_capability_drift_before_3d_submit(tmp_path: Path) -> None:
    harness = ConnectorHarness(drift_second_capability=True)
    prompt = "一座长满青苔的蘑菇小屋"

    with pytest.raises(ContractError, match="revision"):
        make_pipeline(harness, prompt).run(prompt, tmp_path)

    submitted_operations = [body["operation"] for body in harness.submit_bodies.values()]
    assert submitted_operations == [MODAL_2D_TEXT_TO_IMAGE]
    assert not (tmp_path / "model.glb").exists()
    assert not (tmp_path / "manifest.json").exists()
    assert not any(path.startswith("/connector/v1/artifacts/") for _, path in harness.calls)
