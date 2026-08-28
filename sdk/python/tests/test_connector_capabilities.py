from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest

from agentscape.capabilities import MODAL_3D_IMAGE_TO_3D
from agentscape.connector_capabilities import (
    ConnectorCapabilityClient,
    normalize_capability_snapshot,
)
from agentscape.connector_session import ConnectorSession
from agentscape.errors import ConnectionRequiredError, ConnectorHttpError, ContractError
from agentscape.jobs import JobRequest


NOW = datetime(2026, 8, 25, 6, 0, tzinfo=UTC)


def provider(**overrides) -> dict[str, object]:
    value: dict[str, object] = {
        "id": "modal-3d",
        "displayName": "Modal 3D",
        "version": "1",
        "implementationRevision": "impl-2026-08-25",
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
                "input": {"types": ["image", "rgba"], "limits": {"maxBytes": 10_000_000}},
                "output": {
                    "roles": ["primary-glb"],
                    "required": ["primary-glb"],
                    "optional": ["provider-debug-log"],
                },
                "profiles": {"recommended": {"label": "Recommended"}},
                "optionsSchema": {"type": "object"},
                "execution": {
                    "async": True,
                    "stages": ["queued", "running", "artifact"],
                    "durationClass": "long",
                    "costClass": "gpu",
                },
                # Connector adapter 会强制改成 connector-session。
                "prerequisites": {"authMode": "provider-secret", "connection": False, "license": None},
                "support": {"cancel": True, "resume": True, "idempotency": True},
                "artifactTransport": "connector-artifact",
            }
        ],
    }
    value.update(overrides)
    return value


def snapshot(**overrides) -> dict[str, object]:
    value: dict[str, object] = {
        "contractVersion": "1",
        "connector": {"id": "unified-connector", "instance": "instance_01", "version": "1.0.0"},
        "revision": "caprev_01",
        "hash": "sha256:cap01",
        "generatedAt": "2026-08-25T05:59:00.000Z",
        "expiresAt": "2026-08-25T06:30:00.000Z",
        "cachePolicy": {"maxAgeSeconds": 600},
        "providers": [provider()],
    }
    value.update(overrides)
    return value


def make_session(handler) -> ConnectorSession:
    return ConnectorSession(
        "http://127.0.0.1:39001",
        "session-secret",
        {
            "connector": {"id": "unified-connector", "instance": "instance_01", "version": "1.0.0"},
            "contractVersion": "1",
            "clientIdentity": "agentscape",
            "tokenId": "token_01",
            "scopes": ("capabilities.read", "jobs.submit", "jobs.read", "jobs.cancel", "artifacts.read"),
            "issuedAt": "2026-08-25T05:30:00.000Z",
            "expiresAt": "2026-08-25T07:30:00.000Z",
            "allowedOrigins": ("http://localhost:3000",),
            "capabilityRevision": "caprev_01",
            "capabilityHash": "sha256:cap01",
            "revokeEndpoint": "/connector/v1/session",
        },
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        now=lambda: NOW,
    )


def test_snapshot_normalization_matches_agentscape_connector_semantics() -> None:
    session = make_session(lambda request: httpx.Response(200))
    normalized = normalize_capability_snapshot(
        snapshot(providers=[provider(providerPrivateApp="must-be-stripped")]),
        session,
        now=lambda: NOW,
    )
    descriptor = normalized.providers[0]
    capability = descriptor["capabilities"][0]

    assert normalized.connector == {"id": "unified-connector", "instance": "instance_01", "version": "1.0.0"}
    assert normalized.revision == "caprev_01"
    assert normalized.hash == "sha256:cap01"
    assert normalized.generated_at == "2026-08-25T05:59:00.000Z"
    assert normalized.expires_at == "2026-08-25T06:30:00.000Z"
    assert "providerPrivateApp" not in descriptor
    assert capability["prerequisites"] == {
        "authMode": "connector-session",
        "connection": True,
        "license": None,
    }


def test_resolve_job_capability_uses_discovered_versions_roles_and_provenance() -> None:
    normalized = normalize_capability_snapshot(
        snapshot(),
        make_session(lambda request: httpx.Response(200)),
        now=lambda: NOW,
    )

    capability = normalized.resolve_job_capability("modal-3d", MODAL_3D_IMAGE_TO_3D)

    assert capability.provider == "modal-3d"
    assert capability.operation == MODAL_3D_IMAGE_TO_3D
    assert capability.operation_version == "1"
    assert capability.contract_version == "1"
    assert capability.capability_hash == "sha256:cap01"
    assert capability.capability_revision == "caprev_01"
    assert capability.output_roles == ("primary-glb",)


def test_capability_client_fetches_scoped_snapshot_without_token_leak() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/connector/v1/capabilities"
        assert request.headers["Authorization"] == "Bearer session-secret"
        assert request.content == b""
        return httpx.Response(200, json=snapshot())

    result = ConnectorCapabilityClient(make_session(handler), now=lambda: NOW).fetch_snapshot()

    assert len(result.providers) == 1
    assert result.providers[0]["id"] == "modal-3d"


def test_create_job_transport_discovers_capability_before_submit() -> None:
    calls: list[tuple[str, str]] = []
    request = JobRequest(
        provider="modal-3d",
        operation=MODAL_3D_IMAGE_TO_3D,
        inputs={"image": {"artifactId": "image_01"}},
        profile="recommended",
        options={"model": "fastsam3d", "seed": 42},
        output_roles=("primary-glb",),
    )

    def handler(http_request: httpx.Request) -> httpx.Response:
        calls.append((http_request.method, http_request.url.path))
        if http_request.url.path == "/connector/v1/capabilities":
            return httpx.Response(200, json=snapshot())
        body = __import__("json").loads(http_request.content)
        assert body["capabilityHash"] == "sha256:cap01"
        assert body["capabilityRevision"] == "caprev_01"
        assert body["operationVersion"] == "1"
        return httpx.Response(
            200,
            json={
                "job": {
                    "id": "job_01",
                    "provider": "modal-3d",
                    "operation": MODAL_3D_IMAGE_TO_3D,
                    "kind": "generation",
                    "requestHash": request.request_hash,
                    "idempotencyKey": request.idempotency_key,
                    "contractVersion": "1",
                    "capabilityHash": "sha256:cap01",
                    "capabilityRevision": "caprev_01",
                    "status": "accepted",
                    "attempt": 1,
                    "relations": [],
                    "effectiveOptions": {},
                    "createdAt": "2026-08-25T06:00:00.000Z",
                    "updatedAt": "2026-08-25T06:00:00.000Z",
                    "eventSequence": 1,
                }
            },
        )

    discovery = ConnectorCapabilityClient(make_session(handler), now=lambda: NOW)
    transport = discovery.create_job_transport("modal-3d", MODAL_3D_IMAGE_TO_3D)
    job = transport.submit(request)

    assert job.id == "job_01"
    assert calls == [
        ("GET", "/connector/v1/capabilities"),
        ("POST", "/connector/v1/jobs"),
    ]


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"revision": "stale"}, "revision"),
        ({"hash": "sha256:other"}, "hash"),
        ({"contractVersion": "2"}, "contractVersion"),
        ({"connector": {"id": "other", "instance": "instance_01", "version": "1.0.0"}}, "connector identity"),
    ],
)
def test_snapshot_rejects_session_provenance_mismatch(overrides: dict[str, object], message: str) -> None:
    with pytest.raises(ContractError, match=message):
        normalize_capability_snapshot(
            snapshot(**overrides),
            make_session(lambda request: httpx.Response(200)),
            now=lambda: NOW,
        )


def test_snapshot_rejects_expiry_duplicate_provider_and_secret_fields() -> None:
    session = make_session(lambda request: httpx.Response(200))
    with pytest.raises(ContractError, match="已过期"):
        normalize_capability_snapshot(
            snapshot(expiresAt="2026-08-25T05:59:59.000Z"),
            session,
            now=lambda: NOW,
        )
    with pytest.raises(ContractError, match="provider ID 重复"):
        normalize_capability_snapshot(
            snapshot(providers=[provider(), provider()]),
            session,
            now=lambda: NOW,
        )
    with pytest.raises(ContractError, match="敏感字段"):
        normalize_capability_snapshot(
            snapshot(providers=[provider(providerPrivate={"apiKey": "must-not-cross"})]),
            session,
            now=lambda: NOW,
        )


def test_snapshot_rejects_duplicate_operation() -> None:
    base = provider()
    base["capabilities"] = [base["capabilities"][0], dict(base["capabilities"][0])]
    with pytest.raises(ContractError, match="operation 重复"):
        normalize_capability_snapshot(
            snapshot(providers=[base]),
            make_session(lambda request: httpx.Response(200)),
            now=lambda: NOW,
        )


def test_resolve_rejects_unknown_or_unavailable_capability() -> None:
    session = make_session(lambda request: httpx.Response(200))
    normalized = normalize_capability_snapshot(snapshot(), session, now=lambda: NOW)
    with pytest.raises(ContractError, match="未发现 provider"):
        normalized.resolve_job_capability("other", MODAL_3D_IMAGE_TO_3D)
    with pytest.raises(ContractError, match="未发现 operation"):
        normalized.resolve_job_capability("modal-3d", "modal-3d.asset.other.v1")

    disabled = provider(status="disabled")
    normalized = normalize_capability_snapshot(snapshot(providers=[disabled]), session, now=lambda: NOW)
    with pytest.raises(ContractError, match="不可用"):
        normalized.resolve_job_capability("modal-3d", MODAL_3D_IMAGE_TO_3D)


def test_capability_http_errors_are_sanitized() -> None:
    client = ConnectorCapabilityClient(
        make_session(lambda request: httpx.Response(503, json={"code": "CONNECTOR_BUSY", "message": "secret internal"})),
        now=lambda: NOW,
    )
    with pytest.raises(ConnectorHttpError) as exc:
        client.fetch_snapshot()
    assert exc.value.code == "CONNECTOR_BUSY"
    assert "secret internal" not in str(exc.value)

    client = ConnectorCapabilityClient(
        make_session(lambda request: httpx.Response(401, json={"code": "CONNECTION_REQUIRED"})),
        now=lambda: NOW,
    )
    with pytest.raises(ConnectionRequiredError):
        client.fetch_snapshot()
