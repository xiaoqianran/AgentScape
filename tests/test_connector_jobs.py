from __future__ import annotations

import json
from datetime import UTC, datetime

import httpx
import pytest

from agentscape.capabilities import MODAL_3D_IMAGE_TO_3D
from agentscape.connector_jobs import (
    ConnectorHttpJobTransport,
    ConnectorJobCapability,
    parse_job_state,
)
from agentscape.connector_session import ConnectorSession
from agentscape.errors import (
    ConnectionRequiredError,
    ConnectorHttpError,
    ContractError,
    IdempotencyConflictError,
)
from agentscape.job_client import JobController
from agentscape.jobs import JobRequest


REQUEST = JobRequest(
    provider="modal-3d",
    operation=MODAL_3D_IMAGE_TO_3D,
    inputs={"image": {"artifactId": "source_image"}},
    profile="recommended",
    options={"model": "fastsam3d", "seed": 42},
    output_roles=("primary-glb",),
    metadata={"source": "agentscape-client"},
)

CAPABILITY = ConnectorJobCapability(
    provider="modal-3d",
    operation=MODAL_3D_IMAGE_TO_3D,
    operation_version="1",
    contract_version="1",
    capability_hash="sha256:cap01",
    capability_revision="caprev_01",
    output_roles=("primary-glb",),
)


def job_payload(
    *,
    status: str = "accepted",
    sequence: int = 1,
    job_id: str = "job_01",
    **overrides,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": job_id,
        "provider": REQUEST.provider,
        "operation": REQUEST.operation,
        "kind": "generation",
        "requestHash": REQUEST.request_hash,
        "idempotencyKey": REQUEST.idempotency_key,
        "contractVersion": "1",
        "capabilityHash": CAPABILITY.capability_hash,
        "capabilityRevision": CAPABILITY.capability_revision,
        "status": status,
        "attempt": 1,
        "relations": [],
        "effectiveOptions": {"profile": "recommended"},
        "createdAt": "2026-08-25T06:00:00.000Z",
        "updatedAt": "2026-08-25T06:00:01.000Z",
        "eventSequence": sequence,
    }
    payload.update(overrides)
    return payload


def session(handler, *, token: str = "session-secret", scopes: tuple[str, ...] = ("capabilities.read", "jobs.submit", "jobs.read", "jobs.cancel", "artifacts.read")) -> ConnectorSession:
    return ConnectorSession(
        "http://127.0.0.1:39001",
        token,
        {
            "connector": {"id": "unified-connector", "instance": "instance_01", "version": "1.0.0"},
            "contractVersion": "1",
            "clientIdentity": "agentscape",
            "tokenId": "token_01",
            "scopes": scopes,
            "issuedAt": "2026-08-25T05:00:00.000Z",
            "expiresAt": "2026-08-25T08:00:00.000Z",
            "allowedOrigins": ("http://localhost:3000",),
            "capabilityRevision": "caprev_01",
            "capabilityHash": "sha256:cap01",
            "revokeEndpoint": "/connector/v1/session",
        },
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        now=lambda: datetime(2026, 8, 25, 6, 0, tzinfo=UTC),
    )


def transport(handler, *, token: str = "session-secret") -> ConnectorHttpJobTransport:
    return ConnectorHttpJobTransport(session(handler, token=token), CAPABILITY)


def test_submit_matches_connector_wire_contract_without_leaking_token() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/connector/v1/jobs"
        assert request.headers["Authorization"] == "Bearer session-secret"
        body = json.loads(request.content)
        assert body["provider"] == "modal-3d"
        assert body["operation"] == MODAL_3D_IMAGE_TO_3D
        assert body["operationVersion"] == "1"
        assert body["contractVersion"] == "1"
        assert body["requestHash"] == REQUEST.request_hash
        assert body["idempotencyKey"] == REQUEST.idempotency_key
        assert body["capabilityHash"] == "sha256:cap01"
        assert body["capabilityRevision"] == "caprev_01"
        assert body["outputRoles"] == ["primary-glb"]
        assert "session-secret" not in request.content.decode()
        return httpx.Response(200, json={"job": job_payload()})

    job = transport(handler).submit(REQUEST)

    assert job.id == "job_01"
    assert job.status == "accepted"



def test_submit_rejects_capability_provenance_mismatch() -> None:
    client = transport(
        lambda request: httpx.Response(
            200,
            json={"job": job_payload(capabilityHash="sha256:other")},
        )
    )

    with pytest.raises(ContractError, match="capability_hash"):
        client.submit(REQUEST)

def test_get_and_cancel_use_connector_job_paths_and_accept_bare_projection() -> None:
    calls: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        if request.method == "GET":
            return httpx.Response(200, json=job_payload(status="running", sequence=2))
        return httpx.Response(200, json=job_payload(status="cancel_requested", sequence=3))

    client = transport(handler)
    assert client.get("job_01").status == "running"
    assert client.cancel("job_01").status == "cancel_requested"
    assert calls == [
        ("GET", "/connector/v1/jobs/job_01"),
        ("POST", "/connector/v1/jobs/job_01/cancel"),
    ]


def test_get_rejects_response_for_different_job() -> None:
    client = transport(lambda request: httpx.Response(200, json={"job": job_payload(job_id="job_other")}))

    with pytest.raises(ContractError, match="identity"):
        client.get("job_01")


def test_missing_session_token_is_connection_required_without_http_call() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(500)

    with pytest.raises(ConnectionRequiredError, match="session token"):
        transport(handler, token="")
    assert called is False


def test_network_failure_maps_to_connection_required_without_secret() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Bearer session-secret must never surface", request=request)

    with pytest.raises(ConnectionRequiredError) as exc:
        transport(handler).get("job_01")

    assert "session-secret" not in str(exc.value)



def test_projection_echoing_session_token_is_rejected() -> None:
    client = transport(
        lambda request: httpx.Response(
            200,
            json={"job": job_payload(error={"code": "FAILED", "message": "session-secret"})},
        )
    )

    with pytest.raises(ContractError, match="session credential"):
        client.get("job_01")

def test_http_connection_required_maps_to_recoverable_boundary() -> None:
    client = transport(
        lambda request: httpx.Response(
            401,
            json={"code": "CONNECTION_REQUIRED", "message": "expired"},
        )
    )

    with pytest.raises(ConnectionRequiredError, match="connection required"):
        client.get("job_01")


def test_http_idempotency_conflict_has_dedicated_error_without_server_message() -> None:
    client = transport(
        lambda request: httpx.Response(
            409,
            json={"code": "JOB_IDEMPOTENCY_CONFLICT", "message": "conflict"},
        )
    )

    with pytest.raises(IdempotencyConflictError) as exc:
        client.submit(REQUEST)

    assert "session-secret" not in str(exc.value)


def test_other_http_error_exposes_only_status_and_code() -> None:
    client = transport(
        lambda request: httpx.Response(
            503,
            json={"code": "CONNECTOR_BUSY", "message": "secret internal detail"},
        )
    )

    with pytest.raises(ConnectorHttpError) as exc:
        client.get("job_01")

    assert exc.value.status == 503
    assert exc.value.code == "CONNECTOR_BUSY"
    assert "internal detail" not in str(exc.value)


def test_parser_normalizes_result_and_structured_error() -> None:
    succeeded = parse_job_state(
        job_payload(
            status="succeeded",
            sequence=5,
            result={
                "manifestId": "manifest_01",
                "artifacts": [
                    {
                        "id": "artifact_01",
                        "role": "primary-glb",
                        "mime": "model/gltf-binary",
                        "bytes": 12,
                        "hash": "sha256:" + "a" * 64,
                    }
                ],
            },
            completedAt="2026-08-25T06:00:02.000Z",
        )
    )
    failed = parse_job_state(
        job_payload(
            status="failed",
            sequence=6,
            error={"code": "REMOTE_FAILED", "message": "generation failed", "recoverable": True},
        )
    )

    assert succeeded.result is not None
    assert succeeded.result.manifest_id == "manifest_01"
    assert succeeded.result.artifacts[0].role == "primary-glb"
    assert failed.error_code == "REMOTE_FAILED"
    assert failed.error_message == "generation failed"
    assert failed.recoverable is True



def test_parser_normalizes_timestamps_before_fact_signature() -> None:
    utc = parse_job_state(job_payload(updatedAt="2026-08-25T06:00:01.000Z"))
    offset = parse_job_state(job_payload(updatedAt="2026-08-25T14:00:01.000+08:00"))

    assert utc.fact_signature == offset.fact_signature

def test_parser_rejects_secret_like_projection_data() -> None:
    with pytest.raises(ContractError, match="敏感字段"):
        parse_job_state(job_payload(effectiveOptions={"apiKey": "must-not-cross"}))


def test_parser_rejects_invalid_time_and_unsafe_artifact_bytes() -> None:
    with pytest.raises(ContractError, match="updatedAt"):
        parse_job_state(job_payload(updatedAt="not-a-time"))

    with pytest.raises(ContractError, match="安全范围"):
        parse_job_state(
            job_payload(
                status="succeeded",
                result={"artifacts": [{"id": "a", "role": "primary-glb", "bytes": 2**53}]},
            )
        )


def test_same_sequence_progress_conflict_is_detected_by_controller() -> None:
    first = parse_job_state(job_payload(status="running", sequence=4, progress={"current": 1, "total": 2}))
    conflicting = parse_job_state(job_payload(status="running", sequence=4, progress={"current": 2, "total": 2}))

    controller = JobController(transport(lambda request: httpx.Response(500)))
    controller.observe(first)

    with pytest.raises(ContractError, match="冲突事实"):
        controller.observe(conflicting)


def test_capability_rejects_unknown_output_role_before_transport() -> None:
    request = JobRequest(
        provider="modal-3d",
        operation=MODAL_3D_IMAGE_TO_3D,
        output_roles=("provider-debug-log",),
    )

    with pytest.raises(ContractError, match="output role"):
        CAPABILITY.build_submit(request)
