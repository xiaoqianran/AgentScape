from __future__ import annotations

from dataclasses import replace

import pytest

from agentscape.capabilities import MODAL_3D_IMAGE_TO_3D
from agentscape.errors import ConnectionRequiredError, ContractError, IdempotencyConflictError
from agentscape.job_client import JobController, JobState
from agentscape.jobs import JobRequest


REQUEST = JobRequest(
    provider="modal-3d",
    operation=MODAL_3D_IMAGE_TO_3D,
    inputs={"image": {"artifactId": "artifact_01"}},
    profile="recommended",
    options={"model": "fastsam3d", "seed": 42},
    output_roles=("primary-glb",),
)


def projection(
    *,
    job_id: str = "job_01",
    status: str = "running",
    sequence: int = 1,
    request: JobRequest = REQUEST,
    **overrides,
) -> JobState:
    values = {
        "id": job_id,
        "provider": request.provider,
        "operation": request.operation,
        "request_hash": request.request_hash,
        "idempotency_key": request.idempotency_key,
        "status": status,
        "event_sequence": sequence,
        "contract_version": "1",
        "capability_hash": "sha256:cap01",
        "capability_revision": "rev_01",
    }
    values.update(overrides)
    return JobState(**values)


class FakeTransport:
    def __init__(self) -> None:
        self.submit_calls = 0
        self.get_calls = 0
        self.cancel_calls = 0
        self.submitted = projection()
        self.current = self.submitted
        self.get_error: Exception | None = None

    def submit(self, request: JobRequest) -> JobState:
        self.submit_calls += 1
        return self.submitted

    def get(self, job_id: str) -> JobState:
        self.get_calls += 1
        if self.get_error:
            raise self.get_error
        assert job_id == self.current.id
        return self.current

    def cancel(self, job_id: str) -> JobState:
        self.cancel_calls += 1
        assert job_id == self.current.id
        return replace(self.current, status="cancel_requested", event_sequence=self.current.event_sequence + 1)


def test_submit_reuses_same_idempotent_request() -> None:
    transport = FakeTransport()
    controller = JobController(transport)

    first = controller.submit(REQUEST)
    second = controller.submit(REQUEST)

    assert first.reused is False
    assert second.reused is True
    assert second.job.id == "job_01"
    assert transport.submit_calls == 1


def test_submit_rejects_remote_identity_mismatch() -> None:
    transport = FakeTransport()
    transport.submitted = replace(transport.submitted, request_hash="sha256:wrong")
    controller = JobController(transport)

    with pytest.raises(ContractError, match="request_hash"):
        controller.submit(REQUEST)

    assert controller.list_cached() == []


def test_get_connection_required_falls_back_to_cached_projection() -> None:
    transport = FakeTransport()
    controller = JobController(transport)
    submitted = controller.submit(REQUEST).job
    transport.get_error = ConnectionRequiredError("connector offline")

    action = controller.get(submitted.id)

    assert action.job == submitted
    assert action.reused is True
    assert action.connection_required is True


def test_get_connection_required_without_cache_is_not_hidden() -> None:
    transport = FakeTransport()
    transport.get_error = ConnectionRequiredError("connector offline")
    controller = JobController(transport)

    with pytest.raises(ConnectionRequiredError, match="offline"):
        controller.get("job_01")


def test_cancel_is_idempotent_after_cancel_requested() -> None:
    transport = FakeTransport()
    controller = JobController(transport)
    controller.submit(REQUEST)

    first = controller.cancel("job_01")
    second = controller.cancel("job_01")

    assert first.job.status == "cancel_requested"
    assert first.reused is False
    assert second.reused is True
    assert transport.cancel_calls == 1


def test_cancel_is_idempotent_for_terminal_job() -> None:
    transport = FakeTransport()
    transport.submitted = projection(status="succeeded", sequence=3)
    transport.current = transport.submitted
    controller = JobController(transport)
    controller.submit(REQUEST)

    action = controller.cancel("job_01")

    assert action.job.status == "succeeded"
    assert action.reused is True
    assert transport.cancel_calls == 0


def test_stale_observation_does_not_regress_cached_job() -> None:
    transport = FakeTransport()
    transport.submitted = projection(status="running", sequence=3)
    transport.current = transport.submitted
    controller = JobController(transport)
    controller.submit(REQUEST)
    transport.current = projection(status="queued", sequence=2)

    action = controller.get("job_01")

    assert action.job.status == "running"
    assert action.job.event_sequence == 3


def test_same_sequence_conflicting_fact_is_rejected() -> None:
    transport = FakeTransport()
    controller = JobController(transport)
    controller.submit(REQUEST)
    transport.current = projection(status="connection_required", sequence=1)

    with pytest.raises(ContractError, match="冲突事实"):
        controller.get("job_01")


def test_terminal_status_cannot_regress() -> None:
    transport = FakeTransport()
    transport.submitted = projection(status="succeeded", sequence=2)
    transport.current = transport.submitted
    controller = JobController(transport)
    controller.submit(REQUEST)
    transport.current = projection(status="running", sequence=3)

    with pytest.raises(ContractError, match="非法 Job 状态迁移"):
        controller.get("job_01")


def test_connection_required_can_resume_running() -> None:
    transport = FakeTransport()
    transport.submitted = projection(status="connection_required", sequence=1)
    transport.current = transport.submitted
    controller = JobController(transport)
    controller.submit(REQUEST)
    transport.current = projection(status="running", sequence=2)

    action = controller.get("job_01")

    assert action.job.status == "running"


def test_same_idempotency_key_cannot_identify_multiple_jobs() -> None:
    transport = FakeTransport()
    controller = JobController(transport)
    controller.submit(REQUEST)
    transport.current = projection(job_id="job_02", status="running", sequence=2)

    with pytest.raises(IdempotencyConflictError, match="不能绑定多个"):
        controller.get("job_02")


def test_job_state_rejects_unknown_status() -> None:
    with pytest.raises(ContractError, match="未知 Job 状态"):
        projection(status="provider_done")


def test_job_state_rejects_unstable_operation_id() -> None:
    with pytest.raises(ContractError, match="provider-scoped"):
        projection(operation="image_to_3d")


def test_observe_uses_same_transition_guards() -> None:
    transport = FakeTransport()
    controller = JobController(transport)
    controller.observe(projection(status="running", sequence=1))

    observed = controller.observe(projection(status="connection_required", sequence=2))

    assert observed.status == "connection_required"
    assert controller.get_cached("job_01") == observed


def test_job_state_rejects_event_sequence_outside_js_safe_range() -> None:
    with pytest.raises(ContractError, match="JS 安全"):
        projection(sequence=2**53)


def test_job_state_requires_capability_identity() -> None:
    with pytest.raises(ContractError, match="capability identity"):
        projection(capability_hash="")
