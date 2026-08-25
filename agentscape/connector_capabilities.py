from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable

from .connector_jobs import ConnectorHttpJobTransport, ConnectorJobCapability
from .connector_session import ConnectorSession, normalize_time
from .errors import ConnectionRequiredError, ConnectorHttpError, ContractError
from .jobs import JS_MAX_SAFE_INTEGER


CONNECTOR_CAPABILITIES_PATH = "/connector/v1/capabilities"
_PROVIDER_STATUS = frozenset({"available", "experimental", "disabled", "deprecated"})
_PROVIDER_HEALTH = frozenset({"healthy", "degraded", "unknown", "unavailable"})
_SECRET_KEY = re.compile(r"authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|credential", re.I)


def _text(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ContractError(f"Capability snapshot 缺少 {field}")
    return text


def _strings(value: Any) -> list[str]:
    values = value if isinstance(value, list) else [value]
    return list(dict.fromkeys(str(item) for item in values if item))


def _assert_no_secret_fields(value: Any, path: str = "snapshot") -> None:
    if isinstance(value, list):
        for index, item in enumerate(value):
            _assert_no_secret_fields(item, f"{path}[{index}]")
        return
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        if _SECRET_KEY.search(str(key)):
            raise ContractError(f"Capability snapshot 包含敏感字段: {path}.{key}")
        _assert_no_secret_fields(item, f"{path}.{key}")


def _json_safe(value: Any, path: str) -> object:
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        if abs(value) > JS_MAX_SAFE_INTEGER:
            raise ContractError(f"Capability JSON 整数超出 JS 安全范围: {path}")
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ContractError(f"Capability JSON 包含非有限数字: {path}")
        return value
    if isinstance(value, list):
        return [_json_safe(item, f"{path}[{index}]") for index, item in enumerate(value)]
    if isinstance(value, dict):
        result: dict[str, object] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise ContractError(f"Capability JSON key 必须是字符串: {path}")
            result[key] = _json_safe(item, f"{path}.{key}")
        return result
    raise ContractError(f"Capability JSON 类型无效: {path}")


def _safe_optional(value: Any, path: str) -> object | None:
    return None if value is None else _json_safe(value, path)


def _normalize_capability(provider_id: str, value: Any) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ContractError("Capability 必须是对象")
    operation = _text(value.get("operation"), "capability.operation")
    if not operation.startswith(f"{provider_id}.") or not re.search(r"\.v\d+$", operation):
        raise ContractError(f"Capability operation 必须使用稳定 provider-scoped ID: {operation}")
    status = str(value.get("status") or "disabled")
    if status not in _PROVIDER_STATUS:
        raise ContractError(f"Capability status 无效: {status}")

    input_value = value.get("input") if isinstance(value.get("input"), dict) else {}
    output_value = value.get("output") if isinstance(value.get("output"), dict) else {}
    execution = value.get("execution") if isinstance(value.get("execution"), dict) else {}
    prerequisites = value.get("prerequisites") if isinstance(value.get("prerequisites"), dict) else {}
    support = value.get("support") if isinstance(value.get("support"), dict) else {}
    major = operation.rsplit(".v", 1)[-1]
    return {
        "operation": operation,
        "provider": provider_id,
        "version": str(value.get("version") or major or "1"),
        "displayName": str(value.get("displayName") or operation),
        "category": str(value.get("category") or "generation"),
        "status": status,
        "input": {
            "types": _strings(input_value.get("types", [])),
            "schema": _safe_optional(input_value.get("schema"), "capability.input.schema"),
            "limits": _safe_optional(input_value.get("limits"), "capability.input.limits"),
        },
        "output": {
            "roles": _strings(output_value.get("roles", [])),
            "required": _strings(output_value.get("required", [])),
            "optional": _strings(output_value.get("optional", [])),
        },
        "profiles": _safe_optional(value.get("profiles", {}), "capability.profiles") or {},
        "optionsSchema": _safe_optional(value.get("optionsSchema") or None, "capability.optionsSchema"),
        "execution": {
            "async": bool(execution.get("async")),
            "stages": _strings(execution.get("stages", [])),
            "durationClass": execution.get("durationClass") or "unknown",
            "costClass": execution.get("costClass") or "unknown",
        },
        # 统一 Connector 接管鉴权；不透传 provider 私有 authMode。
        "prerequisites": {
            "authMode": "connector-session",
            "connection": True,
            "license": _safe_optional(prerequisites.get("license") or None, "capability.prerequisites.license"),
        },
        "support": {
            "cancel": bool(support.get("cancel")),
            "resume": bool(support.get("resume")),
            "idempotency": bool(support.get("idempotency")),
        },
        "artifactTransport": value.get("artifactTransport") or "inline-json",
        "consumption": _safe_optional(value.get("consumption") or None, "capability.consumption"),
        "warnings": _strings(value.get("warnings", [])),
        "deprecation": _safe_optional(value.get("deprecation") or None, "capability.deprecation"),
    }


def _normalize_provider(value: Any) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ContractError("Capability provider 必须是对象")
    provider_id = _text(value.get("id"), "provider.id")
    status = str(value.get("status") or "disabled")
    health = str(value.get("health") or "unknown")
    if status not in _PROVIDER_STATUS:
        raise ContractError(f"Provider status 无效: {status}")
    if health not in _PROVIDER_HEALTH:
        raise ContractError(f"Provider health 无效: {health}")
    raw_capabilities = value.get("capabilities", [])
    if not isinstance(raw_capabilities, list):
        raise ContractError("Provider capabilities 必须是数组")
    capabilities = [_normalize_capability(provider_id, item) for item in raw_capabilities]
    operations = [str(item["operation"]) for item in capabilities]
    if len(set(operations)) != len(operations):
        raise ContractError(f"Provider capability operation 重复: {provider_id}")
    return {
        "id": provider_id,
        "displayName": str(value.get("displayName") or provider_id),
        "version": str(value.get("version") or "1"),
        "implementationRevision": value.get("implementationRevision") or None,
        "health": health,
        "status": status,
        "contractVersion": str(value.get("contractVersion") or "1"),
        "artifactTransport": value.get("artifactTransport") or None,
        "deprecation": _safe_optional(value.get("deprecation") or None, "provider.deprecation"),
        "capabilities": capabilities,
    }


@dataclass(frozen=True, slots=True)
class ConnectorCapabilitySnapshot:
    contract_version: str
    source_id: str
    connector: dict[str, str]
    revision: str
    hash: str
    generated_at: str
    expires_at: str | None
    cache_policy: object | None
    providers: tuple[dict[str, object], ...]

    def resolve_job_capability(self, provider: str, operation: str) -> ConnectorJobCapability:
        descriptor = next((item for item in self.providers if item["id"] == provider), None)
        if descriptor is None:
            raise ContractError(f"Connector 未发现 provider: {provider}")
        capability = next(
            (item for item in descriptor["capabilities"] if item["operation"] == operation),
            None,
        )
        if capability is None:
            raise ContractError(f"Connector 未发现 operation: {operation}")
        if descriptor["status"] != "available" or descriptor["health"] == "unavailable" or capability["status"] != "available":
            raise ContractError(f"Connector capability 当前不可用: {operation}")
        if capability["prerequisites"]["authMode"] != "connector-session":
            raise ContractError(f"Connector capability 鉴权模式无效: {operation}")
        return ConnectorJobCapability(
            provider=provider,
            operation=operation,
            operation_version=str(capability["version"]),
            contract_version=str(descriptor["contractVersion"]),
            capability_hash=self.hash,
            capability_revision=self.revision,
            output_roles=tuple(capability["output"]["roles"]),
        )


def normalize_capability_snapshot(
    payload: Any,
    session: ConnectorSession,
    *,
    now: Callable[[], datetime] | None = None,
) -> ConnectorCapabilitySnapshot:
    session_state = session.snapshot()
    if session_state["status"] != "paired":
        raise ConnectionRequiredError("Connector pairing 才能发现 capability")
    if not isinstance(payload, dict):
        raise ContractError("Capability snapshot 必须是对象")
    _assert_no_secret_fields(payload)

    contract_version = _text(payload.get("contractVersion"), "contractVersion")
    if contract_version != session_state["contractVersion"]:
        raise ContractError("Capability snapshot contractVersion 与 session 不一致")
    connector = payload.get("connector")
    if not isinstance(connector, dict):
        raise ContractError("Capability snapshot 缺少 connector identity")
    normalized_connector = {
        "id": _text(connector.get("id"), "connector.id"),
        "instance": _text(connector.get("instance"), "connector.instance"),
        "version": _text(connector.get("version"), "connector.version"),
    }
    if normalized_connector != session_state["connector"]:
        raise ContractError("Capability snapshot connector identity 与 session 不一致")

    revision = _text(payload.get("revision"), "revision")
    digest = _text(payload.get("hash"), "hash")
    if revision != session_state["capabilityRevision"]:
        raise ContractError("Capability snapshot revision 与 session 不一致")
    if digest != session_state["capabilityHash"]:
        raise ContractError("Capability snapshot hash 与 session 不一致")

    generated_at, generated = normalize_time(payload.get("generatedAt"), "capability.generatedAt")
    expires_at = None
    expires = None
    if payload.get("expiresAt") is not None:
        expires_at, expires = normalize_time(payload.get("expiresAt"), "capability.expiresAt")
        if expires <= generated:
            raise ContractError("Capability snapshot expiresAt 必须晚于 generatedAt")
        current = (now or (lambda: datetime.now(UTC)))().astimezone(UTC)
        if expires <= current:
            raise ContractError("Capability snapshot 已过期")

    raw_providers = payload.get("providers")
    if not isinstance(raw_providers, list):
        raise ContractError("Capability snapshot providers 必须是数组")
    providers = tuple(_normalize_provider(item) for item in raw_providers)
    provider_ids = [str(item["id"]) for item in providers]
    if len(set(provider_ids)) != len(provider_ids):
        raise ContractError("Capability snapshot provider ID 重复")

    return ConnectorCapabilitySnapshot(
        contract_version=contract_version,
        source_id=f"connector:{normalized_connector['id']}",
        connector=normalized_connector,
        revision=revision,
        hash=digest,
        generated_at=generated_at,
        expires_at=expires_at,
        cache_policy=_safe_optional(payload.get("cachePolicy") or None, "snapshot.cachePolicy"),
        providers=providers,
    )


class ConnectorCapabilityClient:
    def __init__(self, session: ConnectorSession, *, now: Callable[[], datetime] | None = None) -> None:
        self.session = session
        self._now = now

    def fetch_snapshot(self) -> ConnectorCapabilitySnapshot:
        response = self.session.request("GET", CONNECTOR_CAPABILITIES_PATH, scope="capabilities.read")
        try:
            payload = response.json()
        except ValueError as exc:
            raise ContractError("Connector 返回无效 capability JSON") from exc
        if not isinstance(payload, dict):
            raise ContractError("Connector capability response 必须是 JSON 对象")
        self.session.assert_no_token_echo(payload)
        if not response.is_success:
            code = str(payload.get("code") or "CONNECTOR_CAPABILITY_HTTP_ERROR")
            if code == "CONNECTION_REQUIRED":
                raise ConnectionRequiredError(f"Connector connection required (HTTP {response.status_code})")
            raise ConnectorHttpError(code=code, status=response.status_code)
        return normalize_capability_snapshot(payload, self.session, now=self._now)

    def create_job_transport(self, provider: str, operation: str) -> ConnectorHttpJobTransport:
        snapshot = self.fetch_snapshot()
        capability = snapshot.resolve_job_capability(provider, operation)
        return ConnectorHttpJobTransport(self.session, capability)
