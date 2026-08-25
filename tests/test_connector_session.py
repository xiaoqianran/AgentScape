from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest

from agentscape.connector_session import (
    CONNECTOR_SESSION_SCOPES,
    ConnectorSession,
    normalize_client_origin,
    normalize_connector_endpoint,
    normalize_requested_scopes,
)
from agentscape.errors import ConnectionRequiredError, ContractError


NOW = datetime(2026, 8, 25, 6, 0, tzinfo=UTC)


def session_response(**overrides) -> dict[str, object]:
    session: dict[str, object] = {
        "connector": {"id": "unified-connector", "instance": "instance_01", "version": "1.0.0"},
        "contractVersion": "1",
        "clientIdentity": "agentscape",
        "tokenId": "token_01",
        "scopes": list(CONNECTOR_SESSION_SCOPES),
        "issuedAt": "2026-08-25T05:30:00.000Z",
        "expiresAt": "2026-08-25T07:30:00.000Z",
        "allowedOrigins": ["http://localhost:3000"],
        "capabilityRevision": "caprev_01",
        "capabilityHash": "sha256:cap01",
        "revokeEndpoint": "/connector/v1/session",
    }
    session.update(overrides)
    return {"token": "session-secret", "session": session}


def make_session(handler=lambda request: httpx.Response(200, json={"ok": True})) -> ConnectorSession:
    return ConnectorSession.from_response(
        "http://127.0.0.1:39001",
        session_response(),
        origin="http://localhost:3000",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        now=lambda: NOW,
    )


def test_session_response_matches_agentscape_v1_contract_without_exposing_token() -> None:
    session = make_session()
    snapshot = session.snapshot()

    assert snapshot == {
        "connector": {"id": "unified-connector", "instance": "instance_01", "version": "1.0.0"},
        "contractVersion": "1",
        "clientIdentity": "agentscape",
        "tokenId": "token_01",
        "scopes": CONNECTOR_SESSION_SCOPES,
        "issuedAt": "2026-08-25T05:30:00.000Z",
        "expiresAt": "2026-08-25T07:30:00.000Z",
        "allowedOrigins": ("http://localhost:3000",),
        "capabilityRevision": "caprev_01",
        "capabilityHash": "sha256:cap01",
        "revokeEndpoint": "/connector/v1/session",
        "status": "paired",
    }
    assert "session-secret" not in repr(snapshot)



def test_session_snapshot_cannot_mutate_internal_identity() -> None:
    session = make_session()
    first = session.snapshot()
    first["connector"]["id"] = "tampered"

    assert session.snapshot()["connector"]["id"] == "unified-connector"

def test_session_request_uses_bearer_header_and_scope_without_body_leak() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/connector/v1/capabilities"
        assert request.headers["Authorization"] == "Bearer session-secret"
        assert "session-secret" not in request.content.decode()
        return httpx.Response(200, json={"ok": True})

    response = make_session(handler).request(
        "GET",
        "/connector/v1/capabilities",
        scope="capabilities.read",
    )
    assert response.status_code == 200


def test_session_missing_scope_fails_before_http_call() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200)

    payload = session_response(scopes=["jobs.read"])
    session = ConnectorSession.from_response(
        "http://127.0.0.1:39001",
        payload,
        origin="http://localhost:3000",
        requested_scopes=["jobs.read"],
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        now=lambda: NOW,
    )

    with pytest.raises(ContractError, match="capabilities.read"):
        session.request("GET", "/connector/v1/capabilities", scope="capabilities.read")
    assert called is False


def test_session_expiry_and_revoke_fail_before_http() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200)

    session = make_session(handler)
    session.revoke()
    with pytest.raises(ConnectionRequiredError, match="不可用"):
        session.request("GET", "/connector/v1/capabilities", scope="capabilities.read")
    assert called is False

    with pytest.raises(ConnectionRequiredError, match="过期"):
        ConnectorSession.from_response(
            "http://127.0.0.1:39001",
            session_response(expiresAt="2026-08-25T05:59:59.000Z"),
            origin="http://localhost:3000",
            now=lambda: NOW,
        )


def test_session_rejects_scope_escalation_origin_and_identity_mismatch() -> None:
    with pytest.raises(ContractError, match="scope escalation"):
        ConnectorSession.from_response(
            "http://127.0.0.1:39001",
            session_response(scopes=["jobs.read", "jobs.cancel"]),
            origin="http://localhost:3000",
            requested_scopes=["jobs.read"],
            now=lambda: NOW,
        )

    with pytest.raises(ContractError, match="client origin"):
        ConnectorSession.from_response(
            "http://127.0.0.1:39001",
            session_response(),
            origin="http://127.0.0.1:3000",
            now=lambda: NOW,
        )

    with pytest.raises(ContractError, match="clientIdentity"):
        ConnectorSession.from_response(
            "http://127.0.0.1:39001",
            session_response(clientIdentity="other-client"),
            origin="http://localhost:3000",
            now=lambda: NOW,
        )


def test_session_rejects_non_v1_revoke_endpoint_and_contract() -> None:
    with pytest.raises(ContractError, match="revokeEndpoint"):
        ConnectorSession.from_response(
            "http://127.0.0.1:39001",
            session_response(revokeEndpoint="/custom/revoke"),
            origin="http://localhost:3000",
            now=lambda: NOW,
        )

    with pytest.raises(ContractError, match="contractVersion"):
        ConnectorSession.from_response(
            "http://127.0.0.1:39001",
            session_response(contractVersion="2"),
            origin="http://localhost:3000",
            now=lambda: NOW,
        )


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://example.com:443",
        "http://127.0.0.1:39001/path",
        "http://user:pass@127.0.0.1:39001",
        "file:///tmp/connector.sock",
        "http://127.0.0.1:99999",
    ],
)
def test_session_endpoint_fails_closed_outside_bare_loopback_origin(endpoint: str) -> None:
    with pytest.raises(ContractError, match="Connector endpoint"):
        normalize_connector_endpoint(endpoint)


def test_origin_and_scope_normalization_match_connector_surface() -> None:
    assert normalize_client_origin("http://localhost:3000/path?q=1") == "http://localhost:3000"
    assert normalize_requested_scopes(["jobs.read", "jobs.read", "jobs.cancel"]) == ("jobs.read", "jobs.cancel")
    with pytest.raises(ContractError, match="未知 scope"):
        normalize_requested_scopes(["credentials.read"])


def test_default_ports_are_normalized_like_url_origin() -> None:
    assert normalize_connector_endpoint("http://localhost:80") == "http://localhost"
    assert normalize_connector_endpoint("https://localhost:443") == "https://localhost"
