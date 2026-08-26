from __future__ import annotations

import re
import time
from hashlib import sha256
from pathlib import Path

import httpx

from ..artifacts import write_artifact
from ..capabilities import MODAL_2D_PROVIDER, MODAL_2D_TEXT_TO_IMAGE
from ..contracts import Artifact, ImageGenerationResult
from ..errors import ArtifactError, ContractError, ProviderError


_ARTIFACT_ID = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
_JOB_ID = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_JOB_STATUSES = {
    "running",
    "connection_required",
    "cancel_requested",
    "succeeded",
    "failed",
    "cancelled",
    "expired",
}
_TERMINAL_JOB_STATUSES = {"succeeded", "failed", "cancelled", "expired"}


class Modal2DProvider:
    """Direct adapter for the provider-local modal-2D-client API.

    This is intentionally not a Unified Connector implementation: the local 2D Agent
    owns only provider facts. Connector Job identity/idempotency/session scope remain a
    separate product-level responsibility.
    """

    name = MODAL_2D_PROVIDER
    operation = MODAL_2D_TEXT_TO_IMAGE
    output_role = "primary-image"
    output_suffix = ".png"

    def __init__(
        self,
        base_url: str,
        session_token: str = "",
        *,
        client: httpx.Client | None = None,
        poll_interval: float = 1.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.session_token = session_token
        self.client = client or httpx.Client(timeout=120.0)
        self.poll_interval = poll_interval

    def _headers(self) -> dict[str, str]:
        return {"X-Modal-2D-Session": self.session_token} if self.session_token else {}

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        headers = dict(self._headers())
        headers.update(kwargs.pop("headers", {}))
        response = self.client.request(method, f"{self.base_url}{path}", headers=headers, **kwargs)
        response.raise_for_status()
        return response

    def probe(self) -> dict:
        value = self._request("GET", "/health").json()
        if not isinstance(value, dict):
            raise ContractError("modal-2D /health 返回结构无效")
        return value

    def status(self) -> dict:
        value = self._request("GET", "/modal/status").json()
        if not isinstance(value, dict) or not isinstance(value.get("connected"), bool):
            raise ContractError("modal-2D /modal/status 返回结构无效")
        return value

    def models(self) -> list[dict]:
        value = self._request("GET", "/v1/models").json()
        models = value.get("models") if isinstance(value, dict) else None
        if not isinstance(models, list):
            raise ContractError("modal-2D /v1/models 返回结构无效")
        return models

    def submit(
        self,
        prompt: str,
        *,
        model: str = "sana-sprint-1.6b",
        seed: int | None = None,
        guidance: float | None = None,
    ) -> dict:
        body: dict[str, object] = {"prompt": prompt, "model": model}
        if seed is not None:
            body["seed"] = seed
        if guidance is not None:
            body["guidance"] = guidance
        value = self._request("POST", "/v1/jobs", json=body).json()
        if not isinstance(value, dict):
            raise ContractError("modal-2D submit 返回结构无效")
        job_id = value.get("id")
        if not isinstance(job_id, str) or not _JOB_ID.fullmatch(job_id):
            raise ContractError("modal-2D submit 返回无效 job.id")
        if value.get("model") != model:
            raise ContractError("modal-2D submit 返回 model identity 不一致")
        status = value.get("status")
        if status not in _JOB_STATUSES:
            raise ContractError(f"modal-2D submit 返回未知状态: {status!r}")
        return value

    def get_job(self, job_id: str) -> dict:
        self._validate_job_id(job_id)
        job = self._request("GET", f"/v1/jobs/{job_id}").json()
        if not isinstance(job, dict) or job.get("id") != job_id:
            raise ContractError("modal-2D job 返回 identity 不一致")
        status = job.get("status")
        if status not in _JOB_STATUSES:
            raise ContractError(f"modal-2D job 返回未知状态: {status!r}")
        return job

    def cancel(self, job_id: str) -> dict:
        self._validate_job_id(job_id)
        job = self._request("DELETE", f"/v1/jobs/{job_id}").json()
        if (
            not isinstance(job, dict)
            or job.get("id") != job_id
            or job.get("status") not in _JOB_STATUSES
        ):
            raise ContractError("modal-2D cancel 返回结构无效")
        return job

    def wait(self, job_id: str, *, timeout: float = 1200.0) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            job = self.get_job(job_id)
            status = job["status"]
            if status in _TERMINAL_JOB_STATUSES:
                if status != "succeeded":
                    code = job.get("error_code")
                    detail = str(code or "unknown error")
                    raise ProviderError(f"modal-2D job {job_id} ended as {status}: {detail}")
                return job
            time.sleep(self.poll_interval)
        raise TimeoutError(f"modal-2D job {job_id} did not finish within {timeout:.0f}s")

    @staticmethod
    def _artifact_descriptor(job: dict) -> dict[str, object]:
        result = job.get("result")
        artifact = result.get("artifact") if isinstance(result, dict) else None
        if not isinstance(artifact, dict):
            raise ContractError("modal-2D job succeeded without result.artifact")

        artifact_id = artifact.get("id")
        role = artifact.get("role")
        mime = artifact.get("mime")
        format_name = artifact.get("format")
        size = artifact.get("bytes")
        digest = artifact.get("sha256")
        if not isinstance(artifact_id, str) or not _ARTIFACT_ID.fullmatch(artifact_id):
            raise ContractError("modal-2D artifact.id 无效")
        if role != "primary-image" or mime != "image/png" or format_name != "png":
            raise ContractError("modal-2D artifact 必须是 primary-image PNG")
        if not isinstance(size, int) or isinstance(size, bool) or size < len(_PNG_SIGNATURE):
            raise ContractError("modal-2D artifact.bytes 无效")
        if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
            raise ContractError("modal-2D artifact.sha256 无效")
        if artifact.get("width") != 1024 or artifact.get("height") != 1024:
            raise ContractError("modal-2D artifact 必须是 1024x1024")
        return {
            "id": artifact_id,
            "role": role,
            "mime": mime,
            "format": format_name,
            "bytes": size,
            "sha256": digest,
        }

    def download_artifact(
        self,
        job_id: str,
        descriptor: dict[str, object],
        destination: Path,
    ) -> Artifact:
        self._validate_job_id(job_id)
        response = self._request("GET", f"/v1/jobs/{job_id}/artifact")
        data = response.content
        if len(data) < len(_PNG_SIGNATURE) or data[:8] != _PNG_SIGNATURE:
            raise ArtifactError("modal-2D artifact 不是有效 PNG")

        expected_bytes = descriptor["bytes"]
        expected_sha = descriptor["sha256"]
        if len(data) != expected_bytes:
            raise ArtifactError(
                f"modal-2D artifact bytes 不一致: expected={expected_bytes}, actual={len(data)}"
            )
        actual_sha = sha256(data).hexdigest()
        if actual_sha != expected_sha:
            raise ArtifactError("modal-2D artifact SHA-256 校验失败")

        header_id = response.headers.get("X-Artifact-ID")
        if header_id is not None and header_id != descriptor["id"]:
            raise ArtifactError("modal-2D artifact header identity 不一致")
        header_sha = response.headers.get("X-Artifact-SHA256")
        if header_sha is not None and header_sha != expected_sha:
            raise ArtifactError("modal-2D artifact header SHA-256 不一致")
        content_type = response.headers.get("Content-Type")
        if content_type is not None and content_type.split(";", 1)[0].strip().lower() != "image/png":
            raise ArtifactError("modal-2D artifact Content-Type 不一致")

        return write_artifact(
            destination,
            data,
            mime="image/png",
            format="png",
            artifact_id=str(descriptor["id"]),
        )

    def generate(
        self,
        prompt: str,
        destination: Path,
        *,
        model: str = "sana-sprint-1.6b",
        seed: int | None = None,
        guidance: float | None = None,
        timeout: float = 1200.0,
    ) -> ImageGenerationResult:
        job = self.submit(prompt, model=model, seed=seed, guidance=guidance)
        job_id = str(job["id"])
        finished = self.wait(job_id, timeout=timeout)
        if finished.get("model") != model:
            raise ContractError("modal-2D completed job model identity 不一致")
        descriptor = self._artifact_descriptor(finished)
        artifact = self.download_artifact(job_id, descriptor, destination)
        return ImageGenerationResult(
            provider=self.name,
            model=model,
            task_id=job_id,
            artifact=artifact,
        )

    @staticmethod
    def _validate_job_id(job_id: str) -> None:
        if not isinstance(job_id, str) or not _JOB_ID.fullmatch(job_id):
            raise ContractError("modal-2D job.id 必须是 URL-safe identifier")
