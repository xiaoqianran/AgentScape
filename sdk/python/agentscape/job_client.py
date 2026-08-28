from __future__ import annotations

import re
from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Protocol

from .contracts import JobResult
from .errors import ConnectionRequiredError, ContractError, IdempotencyConflictError
from .jobs import JobRequest


JOB_STATUSES = frozenset(
    {
        "accepted",
        "queued",
        "running",
        "connection_required",
        "cancel_requested",
        "cancelled",
        "failed",
        "expired",
        "succeeded",
    }
)
TERMINAL_JOB_STATUSES = frozenset({"cancelled", "failed", "expired", "succeeded"})
SAFE_JOB_ID = re.compile(r"^[A-Za-z0-9_-]{1,160}$")

_ALLOWED_TRANSITIONS = {
    "accepted": {
        "queued", "running", "connection_required", "cancel_requested",
        "succeeded", "failed", "cancelled", "expired",
    },
    "queued": {
        "running", "connection_required", "cancel_requested",
        "succeeded", "failed", "cancelled", "expired",
    },
    "running": {
        "connection_required", "cancel_requested",
        "succeeded", "failed", "cancelled", "expired",
    },
    "connection_required": {
        "accepted", "queued", "running", "cancel_requested",
        "succeeded", "failed", "cancelled", "expired",
    },
    "cancel_requested": {"connection_required", "succeeded", "failed", "cancelled", "expired"},
}


@dataclass(frozen=True, slots=True)
class JobState:
    id: str
    provider: str
    operation: str
    request_hash: str
    idempotency_key: str
    status: str
    event_sequence: int
    kind: str = "generation"
    contract_version: str = "1"
    capability_hash: str = ""
    capability_revision: str = ""
    result: JobResult | None = None
    error_code: str | None = None
    error_message: str | None = None
    recoverable: bool = False
    fact_signature: str = ""

    def __post_init__(self) -> None:
        if not SAFE_JOB_ID.fullmatch(self.id):
            raise ContractError(f"Job ID 无效: {self.id!r}")
        valid_operation = (
            bool(self.provider)
            and self.operation.startswith(f"{self.provider}.")
            and re.search(r"\.v\d+$", self.operation)
        )
        if not valid_operation:
            raise ContractError("Job operation 必须是稳定的 provider-scoped operation ID")
        if self.status not in JOB_STATUSES:
            raise ContractError(f"未知 Job 状态: {self.status!r}")
        if (
            not isinstance(self.event_sequence, int)
            or isinstance(self.event_sequence, bool)
            or self.event_sequence < 0
            or self.event_sequence > 2**53 - 1
        ):
            raise ContractError("Job event_sequence 必须是 JS 安全的非负整数")
        if not self.request_hash or not self.idempotency_key:
            raise ContractError("Job state 缺少 request identity")
        if not self.contract_version or not self.capability_hash or not self.capability_revision:
            raise ContractError("Job state 缺少 capability identity")
        if not self.fact_signature:
            facts = {
                "status": self.status,
                "result": None if self.result is None else self.result.to_dict(),
                "error": None if self.error_code is None else {
                    "code": self.error_code,
                    "message": self.error_message,
                    "recoverable": self.recoverable,
                },
            }
            encoded = json.dumps(facts, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
            object.__setattr__(self, "fact_signature", sha256(encoded).hexdigest())

    @property
    def terminal(self) -> bool:
        return self.status in TERMINAL_JOB_STATUSES


@dataclass(frozen=True, slots=True)
class JobAction:
    job: JobState
    reused: bool = False
    connection_required: bool = False


class JobTransport(Protocol):
    def submit(self, request: JobRequest) -> JobState: ...

    def get(self, job_id: str) -> JobState: ...

    def cancel(self, job_id: str) -> JobState: ...


class JobController:
    """统一 Job 控制层；Transport 只负责远端 I/O。"""

    def __init__(self, transport: JobTransport) -> None:
        self.transport = transport
        self._jobs: dict[str, JobState] = {}
        self._idempotency: dict[str, tuple[str, str]] = {}

    def get_cached(self, job_id: str) -> JobState | None:
        return self._jobs.get(job_id)

    def list_cached(self) -> list[JobState]:
        return list(self._jobs.values())

    def submit(self, request: JobRequest) -> JobAction:
        request_hash = request.request_hash
        idempotency_key = request.idempotency_key
        owner = self._idempotency.get(idempotency_key)
        if owner is not None:
            owner_hash, owner_job_id = owner
            if owner_hash != request_hash:
                raise IdempotencyConflictError(
                    f"Idempotency key 已绑定其他 request hash: {idempotency_key}"
                )
            return JobAction(self._jobs[owner_job_id], reused=True)

        job = self.transport.submit(request)
        self._assert_submit_identity(job, request)
        return JobAction(self._apply(job))

    def observe(self, job: JobState) -> JobState:
        """接收轮询、事件流或重连快照中的单个 Job 状态。"""

        return self._apply(job)

    def get(self, job_id: str) -> JobAction:
        self._validate_job_id(job_id)
        try:
            job = self.transport.get(job_id)
        except ConnectionRequiredError:
            cached = self._jobs.get(job_id)
            if cached is None:
                raise
            return JobAction(cached, reused=True, connection_required=True)
        return JobAction(self._apply(job))

    def cancel(self, job_id: str) -> JobAction:
        self._validate_job_id(job_id)
        cached = self._jobs.get(job_id)
        if cached is not None and (cached.terminal or cached.status == "cancel_requested"):
            return JobAction(cached, reused=True)
        job = self.transport.cancel(job_id)
        return JobAction(self._apply(job))

    def _apply(self, job: JobState) -> JobState:
        owner = self._idempotency.get(job.idempotency_key)
        if owner is not None:
            owner_hash, owner_job_id = owner
            if owner_hash != job.request_hash or owner_job_id != job.id:
                raise IdempotencyConflictError(
                    f"Idempotency key 不能绑定多个 Job/request: {job.idempotency_key}"
                )

        previous = self._jobs.get(job.id)
        if previous is None:
            self._jobs[job.id] = job
            self._idempotency[job.idempotency_key] = (job.request_hash, job.id)
            return job

        self._assert_identity(previous, job)
        if job.event_sequence < previous.event_sequence:
            return previous
        if job.event_sequence == previous.event_sequence:
            if job.fact_signature != previous.fact_signature:
                raise ContractError(
                    f"同一 Job event_sequence 出现冲突事实: {job.id}@{job.event_sequence}"
                )
            return previous

        self._assert_transition(previous.status, job.status)
        self._jobs[job.id] = job
        return job

    @staticmethod
    def _assert_submit_identity(job: JobState, request: JobRequest) -> None:
        expected = {
            "provider": request.provider.strip(),
            "operation": request.operation.strip(),
            "request_hash": request.request_hash,
            "idempotency_key": request.idempotency_key,
        }
        for field, value in expected.items():
            if getattr(job, field) != value:
                raise ContractError(f"Job submit response identity 不一致: {field}")

    @staticmethod
    def _assert_identity(previous: JobState, current: JobState) -> None:
        for field in (
            "id",
            "provider",
            "operation",
            "request_hash",
            "idempotency_key",
            "contract_version",
            "capability_hash",
            "capability_revision",
            "kind",
        ):
            if getattr(previous, field) != getattr(current, field):
                raise ContractError(f"Job immutable identity 发生变化: {field}")

    @staticmethod
    def _assert_transition(previous: str, current: str) -> None:
        if previous == current:
            return
        if previous in TERMINAL_JOB_STATUSES or current not in _ALLOWED_TRANSITIONS.get(previous, set()):
            raise ContractError(f"非法 Job 状态迁移: {previous} -> {current}")

    @staticmethod
    def _validate_job_id(job_id: str) -> None:
        if not SAFE_JOB_ID.fullmatch(job_id):
            raise ContractError(f"Job ID 无效: {job_id!r}")
