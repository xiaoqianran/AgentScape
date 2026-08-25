from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from typing import Any
from urllib.parse import urlsplit

import httpx

from .contracts import ArtifactSummary, JobResult
from .errors import (
    ConnectionRequiredError,
    ConnectorHttpError,
    ContractError,
    IdempotencyConflictError,
)
from .job_client import JOB_STATUSES, SAFE_JOB_ID, JobState
from .jobs import JS_MAX_SAFE_INTEGER, JobRequest, sanitize_job_data


JOBS_PATH = "/connector/v1/jobs"
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
RELATION_TYPES = {"parent", "child", "retry_of", "fallback_of"}


@dataclass(frozen=True, slots=True)
class ConnectorJobCapability:
    provider: str
    operation: str
    operation_version: str
    contract_version: str
    capability_hash: str
    capability_revision: str
    output_roles: tuple[str, ...]

    def __post_init__(self) -> None:
        valid_operation = (
            bool(self.provider)
            and self.operation.startswith(f"{self.provider}.")
            and re.search(r"\.v\d+$", self.operation)
        )
        if not valid_operation:
            raise ContractError("Connector capability operation 无效")
        for field in (
            "operation_version",
            "contract_version",
            "capability_hash",
            "capability_revision",
        ):
            if not str(getattr(self, field)).strip():
                raise ContractError(f"Connector capability 缺少 {field}")
        if not self.output_roles:
            raise ContractError("Connector capability 必须声明 output role")

    def build_submit(self, request: JobRequest) -> dict[str, object]:
        if request.provider.strip() != self.provider or request.operation.strip() != self.operation:
            raise ContractError("Job request 与 Connector capability identity 不一致")

        body = request.to_dict()
        requested_roles = tuple(body["outputRoles"])
        invalid = [role for role in requested_roles if role not in self.output_roles]
        if invalid:
            raise ContractError(f"Job request 包含 capability 未声明的 output role: {invalid}")
        return {
            "provider": self.provider,
            "operation": self.operation,
            "operationVersion": self.operation_version,
            "contractVersion": self.contract_version,
            "idempotencyKey": body["idempotencyKey"],
            "requestHash": body["requestHash"],
            "inputs": body["inputs"],
            "profile": body["profile"],
            "options": body["options"],
            "outputRoles": list(requested_roles),
            "parent": body["parent"],
            "retention": body["retention"],
            "metadata": body["metadata"],
            "capabilityHash": self.capability_hash,
            "capabilityRevision": self.capability_revision,
        }


def normalize_connector_endpoint(value: str) -> str:
    try:
        parsed = urlsplit(str(value).strip())
    except ValueError as exc:
        raise ContractError("Connector endpoint 必须是有效 URL") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ContractError("Connector endpoint 必须使用 http/https")
    if parsed.hostname.lower() not in LOOPBACK_HOSTS:
        raise ContractError("Connector endpoint 必须绑定 loopback host")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ContractError("Connector endpoint 必须是纯 loopback origin")
    host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
    try:
        parsed_port = parsed.port
    except ValueError as exc:
        raise ContractError("Connector endpoint 端口无效") from exc
    port = f":{parsed_port}" if parsed_port is not None else ""
    return f"{parsed.scheme}://{host}{port}"


def _text(value: Any, field: str, *, optional: bool = False) -> str | None:
    if value is None or value == "":
        if optional:
            return None
        raise ContractError(f"Connector Job 缺少 {field}")
    text = str(value).strip()
    if not text and not optional:
        raise ContractError(f"Connector Job 缺少 {field}")
    return text or None


def _safe_int(value: Any, field: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool):
        raise ContractError(f"Connector Job {field} 必须是安全整数")
    if isinstance(value, int):
        number = value
    elif isinstance(value, float) and value.is_integer():
        number = int(value)
    elif isinstance(value, str) and re.fullmatch(r"-?\d+", value.strip()):
        number = int(value)
    else:
        raise ContractError(f"Connector Job {field} 必须是安全整数")
    if number < minimum or number > JS_MAX_SAFE_INTEGER:
        raise ContractError(f"Connector Job {field} 超出 JS 安全范围")
    return number


def _time(value: Any, field: str, *, required: bool = False) -> str | None:
    if value is None or value == "":
        if required:
            raise ContractError(f"Connector Job 缺少 {field}")
        return None
    text = str(value).strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError(f"Connector Job {field} 时间无效") from exc
    if parsed.tzinfo is None:
        raise ContractError(f"Connector Job {field} 必须包含时区")
    return parsed.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _versioned_ref(value: Any, field: str) -> dict[str, str | None] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ContractError(f"Connector Job {field} 必须是对象")
    return {
        "id": _text(value.get("id"), f"{field}.id", optional=True),
        "version": _text(value.get("version"), f"{field}.version", optional=True),
        "revision": _text(value.get("revision"), f"{field}.revision", optional=True),
    }


def _progress(value: Any) -> dict[str, object] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ContractError("Connector Job progress 必须是对象")
    return {
        key: sanitize_job_data(value[key], f"progress.{key}")
        for key in ("kind", "current", "total", "unit", "label")
        if value.get(key) is not None
    }


def _relations(value: Any) -> list[dict[str, str]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ContractError("Connector Job relations 必须是数组")
    result = []
    for index, relation in enumerate(value):
        if not isinstance(relation, dict):
            raise ContractError(f"Connector Job relations[{index}] 必须是对象")
        relation_type = _text(relation.get("type"), f"relations[{index}].type")
        job_id = _text(relation.get("jobId"), f"relations[{index}].jobId")
        if relation_type not in RELATION_TYPES or not SAFE_JOB_ID.fullmatch(job_id or ""):
            raise ContractError(f"Connector Job relations[{index}] 无效")
        result.append({"type": relation_type, "jobId": job_id or ""})
    return result


def _error(value: Any) -> dict[str, object] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ContractError("Connector Job error 必须是对象")
    return {
        "code": _text(value.get("code"), "error.code"),
        "message": _text(value.get("message"), "error.message", optional=True),
        "recoverable": bool(value.get("recoverable")),
    }


def _result(value: Any) -> tuple[JobResult | None, dict[str, object] | None]:
    if value is None:
        return None, None
    if not isinstance(value, dict):
        raise ContractError("Connector Job result 必须是对象")
    artifacts_raw = value.get("artifacts", [])
    if not isinstance(artifacts_raw, list):
        raise ContractError("Connector Job result.artifacts 必须是数组")

    summaries: list[ArtifactSummary] = []
    normalized: list[dict[str, object]] = []
    for index, artifact in enumerate(artifacts_raw):
        if not isinstance(artifact, dict):
            raise ContractError(f"Connector Job result.artifacts[{index}] 必须是对象")
        bytes_value = artifact.get("bytes")
        size = None if bytes_value is None else _safe_int(bytes_value, f"result.artifacts[{index}].bytes")
        summary = ArtifactSummary(
            id=_text(artifact.get("id"), f"result.artifacts[{index}].id") or "",
            role=_text(artifact.get("role"), f"result.artifacts[{index}].role") or "",
            mime=_text(artifact.get("mime"), f"result.artifacts[{index}].mime", optional=True),
            bytes=size,
            hash=_text(artifact.get("hash"), f"result.artifacts[{index}].hash", optional=True),
        )
        summaries.append(summary)
        normalized.append(summary.to_dict())

    manifest_id = _text(value.get("manifestId"), "result.manifestId", optional=True)
    return JobResult(tuple(summaries), manifest_id=manifest_id), {
        "manifestId": manifest_id,
        "artifacts": normalized,
    }


def parse_job_state(payload: Any) -> JobState:
    if not isinstance(payload, dict):
        raise ContractError("Connector Job projection 必须是对象")

    job_id = _text(payload.get("id"), "id") or ""
    if not SAFE_JOB_ID.fullmatch(job_id):
        raise ContractError("Connector Job ID 无效")
    provider = _text(payload.get("provider"), "provider") or ""
    operation = _text(payload.get("operation"), "operation") or ""
    status = _text(payload.get("status"), "status") or ""
    if status not in JOB_STATUSES:
        raise ContractError(f"未知 Connector Job 状态: {status!r}")

    attempt = _safe_int(payload.get("attempt", 1), "attempt", minimum=1)
    event_sequence = _safe_int(payload.get("eventSequence"), "eventSequence")
    error = _error(payload.get("error"))
    result, normalized_result = _result(payload.get("result"))
    facts = {
        "status": status,
        "phase": {
            "accepted": "pending",
            "queued": "pending",
            "running": "pending",
            "connection_required": "recoverable",
            "cancel_requested": "cancelling",
            "cancelled": "terminal_non_success",
            "failed": "terminal_non_success",
            "expired": "terminal_non_success",
            "succeeded": "result_available",
        }[status],
        "stage": _text(payload.get("stage"), "stage", optional=True),
        "progress": _progress(payload.get("progress")),
        "attempt": attempt,
        "relations": _relations(payload.get("relations", [])),
        "effectiveOptions": sanitize_job_data(payload.get("effectiveOptions", {}), "effectiveOptions"),
        "model": _versioned_ref(payload.get("model"), "model"),
        "workflow": _versioned_ref(payload.get("workflow"), "workflow"),
        "submittedAt": _time(payload.get("submittedAt"), "submittedAt"),
        "startedAt": _time(payload.get("startedAt"), "startedAt"),
        "updatedAt": _time(payload.get("updatedAt"), "updatedAt", required=True),
        "completedAt": _time(payload.get("completedAt"), "completedAt"),
        "error": error,
        "result": normalized_result,
    }
    _time(payload.get("createdAt"), "createdAt", required=True)
    signature = sha256(
        json.dumps(facts, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()

    return JobState(
        id=job_id,
        provider=provider,
        operation=operation,
        request_hash=_text(payload.get("requestHash"), "requestHash") or "",
        idempotency_key=_text(payload.get("idempotencyKey"), "idempotencyKey") or "",
        status=status,
        event_sequence=event_sequence,
        kind=str(payload.get("kind") or "generation"),
        contract_version=_text(payload.get("contractVersion"), "contractVersion") or "",
        capability_hash=_text(payload.get("capabilityHash"), "capabilityHash") or "",
        capability_revision=_text(payload.get("capabilityRevision"), "capabilityRevision") or "",
        result=result,
        error_code=None if error is None else str(error["code"]),
        error_message=None if error is None else error["message"],
        recoverable=False if error is None else bool(error["recoverable"]),
        fact_signature=signature,
    )


class ConnectorHttpJobTransport:
    """只负责 Connector Job HTTP；session token 永不进入 Job 数据。"""

    def __init__(
        self,
        endpoint: str,
        session_token: str,
        capability: ConnectorJobCapability,
        *,
        client: httpx.Client | None = None,
    ) -> None:
        self.endpoint = normalize_connector_endpoint(endpoint)
        self._session_token = str(session_token)
        self.capability = capability
        self.client = client or httpx.Client(timeout=60.0, follow_redirects=False)

    def update_session_token(self, token: str) -> None:
        self._session_token = str(token)

    def submit(self, request: JobRequest) -> JobState:
        body = self.capability.build_submit(request)
        job = self._job_request("POST", JOBS_PATH, json_body=body)
        expected = {
            "provider": body["provider"],
            "operation": body["operation"],
            "request_hash": body["requestHash"],
            "idempotency_key": body["idempotencyKey"],
            "contract_version": body["contractVersion"],
            "capability_hash": body["capabilityHash"],
            "capability_revision": body["capabilityRevision"],
        }
        for field, value in expected.items():
            if getattr(job, field) != value:
                raise ContractError(f"Connector submit response identity 不一致: {field}")
        return job

    def get(self, job_id: str) -> JobState:
        self._validate_job_id(job_id)
        job = self._job_request("GET", f"{JOBS_PATH}/{job_id}")
        if job.id != job_id:
            raise ContractError("Connector GET Job response identity 不一致")
        return job

    def cancel(self, job_id: str) -> JobState:
        self._validate_job_id(job_id)
        job = self._job_request("POST", f"{JOBS_PATH}/{job_id}/cancel")
        if job.id != job_id:
            raise ContractError("Connector cancel response identity 不一致")
        return job

    def _job_request(self, method: str, path: str, *, json_body: dict[str, object] | None = None) -> JobState:
        payload = self._request(method, path, json_body=json_body)
        if self._session_token and self._session_token in json.dumps(payload, ensure_ascii=False):
            raise ContractError("Connector response 回显了 session credential")
        raw_job = payload.get("job", payload)
        return parse_job_state(raw_job)

    def _request(self, method: str, path: str, *, json_body: dict[str, object] | None = None) -> dict[str, object]:
        if not self._session_token:
            raise ConnectionRequiredError("Connector session token 不可用")
        headers = {
            "Authorization": f"Bearer {self._session_token}",
            "Accept": "application/json",
        }
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        try:
            response = self.client.request(
                method,
                f"{self.endpoint}{path}",
                headers=headers,
                content=None if json_body is None else json.dumps(json_body, ensure_ascii=False, separators=(",", ":")),
            )
        except httpx.RequestError as exc:
            raise ConnectionRequiredError("Connector 不可达") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise ContractError("Connector 返回无效 JSON") from exc
        if not isinstance(payload, dict):
            raise ContractError("Connector Job response 必须是 JSON 对象")
        if not response.is_success:
            code = str(payload.get("code") or "CONNECTOR_JOB_HTTP_ERROR")
            if code == "CONNECTION_REQUIRED":
                raise ConnectionRequiredError(f"Connector connection required (HTTP {response.status_code})")
            if response.status_code == 409 and "IDEMPOTENCY" in code.upper():
                raise IdempotencyConflictError(f"Connector idempotency conflict: {code}")
            raise ConnectorHttpError(code=code, status=response.status_code)
        return payload

    @staticmethod
    def _validate_job_id(job_id: str) -> None:
        if not SAFE_JOB_ID.fullmatch(job_id):
            raise ContractError(f"Connector Job ID 无效: {job_id!r}")
