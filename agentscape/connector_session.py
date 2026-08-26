from __future__ import annotations

import copy
import json
from datetime import UTC, datetime
from typing import Any, Callable
from urllib.parse import urlsplit

import httpx

from .errors import ConnectionRequiredError, ContractError


CONNECTOR_CONTRACT_VERSION = "1"
CONNECTOR_CLIENT_ID = "agentscape"
CONNECTOR_SESSION_PATH = "/connector/v1/session"
CONNECTOR_SESSION_SCOPES = (
    "capabilities.read",
    "jobs.submit",
    "jobs.read",
    "jobs.cancel",
    "artifacts.read",
)
_ALLOWED_SCOPES = frozenset(CONNECTOR_SESSION_SCOPES)
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def _origin(value: str, field: str, *, loopback: bool) -> str:
    try:
        parsed = urlsplit(str(value).strip())
        port = parsed.port
    except ValueError as exc:
        raise ContractError(f"{field} 必须是有效 URL") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ContractError(f"{field} 必须使用 http/https")
    if loopback and parsed.hostname.lower() not in _LOOPBACK_HOSTS:
        raise ContractError(f"{field} 必须绑定 loopback host")
    if loopback and (parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}):
        raise ContractError(f"{field} 必须是纯 loopback origin")
    host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
    default_port = 80 if parsed.scheme == "http" else 443
    suffix = f":{port}" if port is not None and port != default_port else ""
    return f"{parsed.scheme}://{host}{suffix}"


def normalize_connector_endpoint(value: str) -> str:
    return _origin(value, "Connector endpoint", loopback=True)


def normalize_client_origin(value: str) -> str:
    return _origin(value, "Connector client origin", loopback=False)


def normalize_requested_scopes(scopes: str | tuple[str, ...] | list[str] = CONNECTOR_SESSION_SCOPES) -> tuple[str, ...]:
    raw = [scopes] if isinstance(scopes, str) else scopes
    values = tuple(dict.fromkeys(str(scope).strip() for scope in raw if str(scope).strip()))
    if not values:
        raise ContractError("Connector session 至少需要一个 scope")
    invalid = [scope for scope in values if scope not in _ALLOWED_SCOPES]
    if invalid:
        raise ContractError(f"Connector session 包含未知 scope: {invalid}")
    return values


def normalize_time(value: Any, field: str) -> tuple[str, datetime]:
    text = str(value or "").strip()
    if not text:
        raise ContractError(f"Connector 缺少 {field}")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError(f"Connector {field} 时间无效") from exc
    if parsed.tzinfo is None:
        raise ContractError(f"Connector {field} 必须包含时区")
    normalized = parsed.astimezone(UTC)
    return normalized.isoformat(timespec="milliseconds").replace("+00:00", "Z"), normalized


def _text(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ContractError(f"Connector 缺少 {field}")
    return text


class ConnectorSession:
    """已配对 Connector 会话；token 只存在内存，不进入 snapshot。"""

    def __init__(
        self,
        endpoint: str,
        token: str,
        descriptor: dict[str, object],
        *,
        client: httpx.Client | None = None,
        now: Callable[[], datetime] | None = None,
        origin: str | None = None,
    ) -> None:
        self.endpoint = normalize_connector_endpoint(endpoint)
        if not str(token).strip():
            raise ConnectionRequiredError("Connector session token 不可用")
        if not isinstance(descriptor, dict):
            raise ContractError("Connector session descriptor 必须是对象")

        connector = descriptor.get("connector")
        if not isinstance(connector, dict):
            raise ContractError("Connector session 缺少 connector identity")
        contract_version = _text(descriptor.get("contractVersion"), "session.contractVersion")
        client_identity = _text(descriptor.get("clientIdentity"), "session.clientIdentity")
        if contract_version != CONNECTOR_CONTRACT_VERSION:
            raise ContractError("Connector session contractVersion 不兼容")
        if client_identity != CONNECTOR_CLIENT_ID:
            raise ContractError("Connector session clientIdentity 不匹配")

        scopes = normalize_requested_scopes(descriptor.get("scopes") or [])
        issued_at, issued = normalize_time(descriptor.get("issuedAt"), "session.issuedAt")
        expires_at, expires = normalize_time(descriptor.get("expiresAt"), "session.expiresAt")
        current_now = now or (lambda: datetime.now(UTC))
        if expires <= issued or expires <= current_now().astimezone(UTC):
            raise ConnectionRequiredError("Connector session 已过期")

        allowed_raw = descriptor.get("allowedOrigins")
        if not isinstance(allowed_raw, (list, tuple)):
            raise ContractError("Connector session allowedOrigins 必须是数组")
        allowed_origins = tuple(normalize_client_origin(str(item)) for item in allowed_raw)
        if not allowed_origins:
            raise ContractError("Connector session allowedOrigins 不能为空")
        selected_origin = normalize_client_origin(origin) if origin is not None else allowed_origins[0]
        if selected_origin not in allowed_origins:
            raise ContractError("Connector session 不允许当前 client origin")
        revoke_endpoint = str(descriptor.get("revokeEndpoint") or CONNECTOR_SESSION_PATH)
        if revoke_endpoint != CONNECTOR_SESSION_PATH:
            raise ContractError("Connector session revokeEndpoint 不符合 v1 契约")

        self._descriptor = {
            "connector": {
                "id": _text(connector.get("id"), "session.connector.id"),
                "instance": _text(connector.get("instance"), "session.connector.instance"),
                "version": _text(connector.get("version"), "session.connector.version"),
            },
            "contractVersion": contract_version,
            "clientIdentity": client_identity,
            "tokenId": _text(descriptor.get("tokenId"), "session.tokenId"),
            "scopes": scopes,
            "issuedAt": issued_at,
            "expiresAt": expires_at,
            "allowedOrigins": allowed_origins,
            "capabilityRevision": _text(descriptor.get("capabilityRevision"), "session.capabilityRevision"),
            "capabilityHash": _text(descriptor.get("capabilityHash"), "session.capabilityHash"),
            "revokeEndpoint": revoke_endpoint,
        }
        self._token = str(token)
        self._origin = selected_origin
        self.client = client or httpx.Client(timeout=60.0, follow_redirects=False)
        self._now = current_now
        self._revoked = False

    @classmethod
    def pair(
        cls,
        endpoint: str,
        approval_token: str,
        *,
        origin: str,
        requested_scopes: str | tuple[str, ...] | list[str] = CONNECTOR_SESSION_SCOPES,
        client: httpx.Client | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> "ConnectorSession":
        normalized_endpoint = normalize_connector_endpoint(endpoint)
        normalized_origin = normalize_client_origin(origin)
        scopes = normalize_requested_scopes(requested_scopes)
        approval = str(approval_token or "").strip()
        if not approval:
            raise ConnectionRequiredError("Connector pairing approval 不可用")
        http_client = client or httpx.Client(timeout=60.0, follow_redirects=False)
        body = {
            "clientIdentity": CONNECTOR_CLIENT_ID,
            "contractVersion": CONNECTOR_CONTRACT_VERSION,
            "origin": normalized_origin,
            "scopes": list(scopes),
        }
        try:
            request = http_client.build_request(
                "POST",
                f"{normalized_endpoint}{CONNECTOR_SESSION_PATH}",
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Origin": normalized_origin,
                    "X-Connector-Pairing": approval,
                },
                content=json.dumps(body, ensure_ascii=False, separators=(",", ":")),
            )
            response = http_client.send(request, follow_redirects=False)
        except httpx.RequestError as exc:
            raise ConnectionRequiredError("Connector 不可达") from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise ContractError("Connector pairing 返回无效 JSON") from exc
        if not isinstance(payload, dict):
            raise ContractError("Connector pairing response 必须是对象")
        if approval in json.dumps(payload, ensure_ascii=False):
            raise ContractError("Connector pairing response 回显了 approval credential")
        if not response.is_success:
            code = str(payload.get("code") or "CONNECTOR_PAIRING_HTTP_ERROR")
            if code in {"PAIRING_REQUIRED", "CONNECTION_REQUIRED"}:
                raise ConnectionRequiredError(f"Connector pairing required (HTTP {response.status_code})")
            from .errors import ConnectorHttpError

            raise ConnectorHttpError(code=code, status=response.status_code)
        return cls.from_response(
            normalized_endpoint,
            payload,
            origin=normalized_origin,
            requested_scopes=scopes,
            client=http_client,
            now=now,
        )

    @classmethod
    def from_response(
        cls,
        endpoint: str,
        payload: Any,
        *,
        origin: str,
        requested_scopes: str | tuple[str, ...] | list[str] = CONNECTOR_SESSION_SCOPES,
        client: httpx.Client | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> "ConnectorSession":
        if not isinstance(payload, dict):
            raise ContractError("Connector session response 必须是对象")
        token = _text(payload.get("token"), "token")
        session = payload.get("session")
        if not isinstance(session, dict):
            raise ContractError("Connector response 缺少 session")

        requested = normalize_requested_scopes(requested_scopes)
        raw_scopes = session.get("scopes")
        granted_raw = raw_scopes if isinstance(raw_scopes, list) else [raw_scopes]
        granted = tuple(dict.fromkeys(str(scope).strip() for scope in granted_raw if str(scope or "").strip()))
        if not granted:
            raise ContractError("Connector session 缺少 scopes")
        escalation = [scope for scope in granted if scope not in _ALLOWED_SCOPES or scope not in requested]
        if escalation:
            raise ContractError(f"Connector session scope escalation: {escalation}")

        allowed_raw = session.get("allowedOrigins")
        if not isinstance(allowed_raw, list):
            raise ContractError("Connector session allowedOrigins 必须是数组")
        normalized_origin = normalize_client_origin(origin)
        if normalized_origin not in tuple(normalize_client_origin(str(item)) for item in allowed_raw):
            raise ContractError("Connector session 不允许当前 client origin")
        return cls(endpoint, token, session, client=client, now=now, origin=normalized_origin)

    def snapshot(self) -> dict[str, object]:
        expires_at = datetime.fromisoformat(str(self._descriptor["expiresAt"]).replace("Z", "+00:00"))
        status = "revoked" if self._revoked else "expired" if expires_at <= self._now().astimezone(UTC) else "paired"
        descriptor = copy.deepcopy(self._descriptor)
        descriptor["status"] = status
        return descriptor

    def assert_active(self, scope: str | None = None) -> None:
        snapshot = self.snapshot()
        if snapshot["status"] != "paired":
            raise ConnectionRequiredError("Connector session 不可用")
        if scope and scope not in snapshot["scopes"]:
            raise ContractError(f"Connector session 缺少 scope: {scope}")

    def request(
        self,
        method: str,
        path: str,
        *,
        scope: str,
        json_body: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
        stream: bool = False,
    ) -> httpx.Response:
        self.assert_active(scope)
        if not path.startswith("/") or "://" in path or "?" in path or "#" in path:
            raise ContractError("Connector request path 必须是同源绝对路径")
        extra = {str(key): str(value) for key, value in (headers or {}).items()}
        if any(key.lower() == "authorization" for key in extra):
            raise ContractError("Connector request 禁止覆盖 Authorization header")
        request_headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
            "Origin": self._origin,
            **extra,
        }
        if json_body is not None:
            request_headers["Content-Type"] = "application/json"
        try:
            request = self.client.build_request(
                method,
                f"{self.endpoint}{path}",
                headers=request_headers,
                content=None if json_body is None else json.dumps(json_body, ensure_ascii=False, separators=(",", ":")),
            )
            return self.client.send(request, stream=stream, follow_redirects=False)
        except httpx.RequestError as exc:
            raise ConnectionRequiredError("Connector 不可达") from exc

    def assert_no_token_echo(self, payload: object) -> None:
        if self._token and self._token in json.dumps(payload, ensure_ascii=False):
            raise ContractError("Connector response 回显了 session credential")

    def revoke_remote(self) -> None:
        scopes = tuple(self._descriptor["scopes"])
        if not scopes:
            raise ContractError("Connector session 缺少 revoke 可用 scope")
        response = self.request("DELETE", CONNECTOR_SESSION_PATH, scope=str(scopes[0]))
        if not response.is_success:
            try:
                payload = response.json()
            except ValueError:
                payload = {}
            code = str(payload.get("code") or "CONNECTOR_REVOKE_HTTP_ERROR") if isinstance(payload, dict) else "CONNECTOR_REVOKE_HTTP_ERROR"
            from .errors import ConnectorHttpError

            raise ConnectorHttpError(code=code, status=response.status_code)
        self.revoke()

    def revoke(self) -> None:
        self._revoked = True
        self._token = ""
