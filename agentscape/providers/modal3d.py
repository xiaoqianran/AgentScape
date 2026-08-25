from __future__ import annotations

import mimetypes
import re
import time
from hashlib import sha256
from pathlib import Path

import httpx

from ..artifacts import validate_glb, write_artifact
from ..capabilities import MODAL_3D_IMAGE_TO_3D, MODAL_3D_PROVIDER
from ..contracts import Artifact, ReconstructionResult
from ..errors import ArtifactError, ContractError, ProviderError


_ARTIFACT_ID = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
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


class Modal3DProvider:
    name = MODAL_3D_PROVIDER
    operation = MODAL_3D_IMAGE_TO_3D

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
        return {"X-Modal-3D-Session": self.session_token} if self.session_token else {}

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        headers = dict(self._headers())
        headers.update(kwargs.pop("headers", {}))
        response = self.client.request(method, f"{self.base_url}{path}", headers=headers, **kwargs)
        response.raise_for_status()
        return response

    def probe(self) -> dict:
        return self._request("GET", "/health").json()

    def status(self) -> dict:
        return self._request("GET", "/modal/status").json()

    def models(self) -> list[dict]:
        value = self._request("GET", "/v1/models").json()
        if not isinstance(value, list):
            raise ContractError("modal-3D /v1/models 返回结构无效")
        return value

    def create_project(self, image_path: Path) -> dict:
        mime = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
        with image_path.open("rb") as stream:
            response = self._request(
                "POST",
                "/v1/projects",
                files={"file": (image_path.name, stream, mime)},
            )
        value = response.json()
        if not isinstance(value, dict) or not value.get("id"):
            raise ContractError("modal-3D /v1/projects 返回缺少 id")
        return value

    def segment(self, project_id: str, concept: str) -> dict:
        value = self._request(
            "POST",
            f"/v1/projects/{project_id}/segment",
            json={"concept": concept, "max_candidates": 1},
        ).json()
        if not isinstance(value, dict):
            raise ContractError("modal-3D segment 返回结构无效")
        return value

    def materialize(self, project_id: str, candidate_id: str, *, output_size: int = 1024) -> dict:
        value = self._request(
            "POST",
            f"/v1/projects/{project_id}/materialize",
            json={"candidate_id": candidate_id, "output_size": output_size},
        ).json()
        if not isinstance(value, dict):
            raise ContractError("modal-3D materialize 返回结构无效")
        return value

    def submit_generation(
        self,
        project_id: str,
        *,
        model: str,
        profile: str = "recommended",
        seed: int = 42,
    ) -> dict:
        value = self._request(
            "POST",
            f"/v1/projects/{project_id}/generation",
            json={"model": model, "profile": profile, "seed": seed},
        ).json()
        try:
            job = value["job"]
            if not isinstance(job, dict) or not job.get("id"):
                raise TypeError
            return job
        except (KeyError, TypeError) as exc:
            raise ContractError("modal-3D generation 返回缺少 job.id") from exc

    def get_job(self, job_id: str) -> dict:
        job = self._request("GET", f"/v1/jobs/{job_id}").json()
        if not isinstance(job, dict):
            raise ContractError("modal-3D job 返回结构无效")
        status = job.get("status")
        if status not in _JOB_STATUSES:
            raise ContractError(f"modal-3D job 返回未知状态: {status!r}")
        return job

    def cancel(self, job_id: str) -> dict:
        job = self._request("DELETE", f"/v1/jobs/{job_id}").json()
        if not isinstance(job, dict) or job.get("status") not in _JOB_STATUSES:
            raise ContractError("modal-3D cancel 返回结构无效")
        return job

    def wait(self, job_id: str, *, timeout: float = 1800.0) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            job = self.get_job(job_id)
            status = job["status"]
            if status in _TERMINAL_JOB_STATUSES:
                if status != "succeeded":
                    code = job.get("error_code")
                    error = job.get("error") or "unknown error"
                    detail = f"{code}: {error}" if code else error
                    raise ProviderError(f"modal-3D job {job_id} ended as {status}: {detail}")
                return job
            time.sleep(self.poll_interval)
        raise TimeoutError(f"modal-3D job {job_id} did not finish within {timeout:.0f}s")

    @staticmethod
    def _artifact_descriptor(job: dict) -> dict[str, object]:
        result = job.get("result")
        artifact = result.get("artifact") if isinstance(result, dict) else None
        if not isinstance(artifact, dict):
            raise ContractError("modal-3D job succeeded without result.artifact")

        artifact_id = artifact.get("id")
        role = artifact.get("role")
        mime = artifact.get("mime")
        size = artifact.get("bytes")
        digest = artifact.get("sha256")
        if not isinstance(artifact_id, str) or not _ARTIFACT_ID.fullmatch(artifact_id):
            raise ContractError("modal-3D artifact.id 无效")
        if role != "primary-glb" or mime != "model/gltf-binary":
            raise ContractError("modal-3D artifact role/mime 不符合 primary-glb 契约")
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            raise ContractError("modal-3D artifact.bytes 无效")
        if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
            raise ContractError("modal-3D artifact.sha256 无效")
        return {
            "id": artifact_id,
            "role": role,
            "mime": mime,
            "bytes": size,
            "sha256": digest,
        }

    def download_artifact(self, job_id: str, descriptor: dict[str, object], destination: Path) -> Artifact:
        response = self._request("GET", f"/v1/jobs/{job_id}/artifact")
        data = response.content
        validate_glb(data)

        expected_bytes = descriptor["bytes"]
        expected_sha = descriptor["sha256"]
        if len(data) != expected_bytes:
            raise ArtifactError(
                f"modal-3D artifact bytes 不一致: expected={expected_bytes}, actual={len(data)}"
            )
        actual_sha = sha256(data).hexdigest()
        if actual_sha != expected_sha:
            raise ArtifactError("modal-3D artifact SHA-256 校验失败")

        return write_artifact(
            destination,
            data,
            mime="model/gltf-binary",
            format="glb",
            artifact_id=str(descriptor["id"]),
        )

    def reconstruct(
        self,
        image_path: Path,
        destination: Path,
        *,
        concept: str,
        model: str,
        profile: str = "recommended",
        seed: int = 42,
        output_size: int = 1024,
        timeout: float = 1800.0,
    ) -> ReconstructionResult:
        project = self.create_project(image_path)
        project_id = str(project["id"])
        selection = self.segment(project_id, concept)
        selected = selection.get("selection")
        if not isinstance(selected, dict):
            raise ContractError("modal-3D segment 返回缺少 selection")
        candidates = selected.get("candidates")
        if not isinstance(candidates, list):
            raise ContractError("modal-3D segment 返回的 candidates 无效")
        if not candidates:
            raise ProviderError(f"SAM found no candidate matching concept: {concept}")

        candidate = candidates[0]
        if not isinstance(candidate, dict) or not candidate.get("candidate_id"):
            raise ContractError("modal-3D segment candidate 缺少 candidate_id")
        candidate_id = str(candidate["candidate_id"])

        self.materialize(project_id, candidate_id, output_size=output_size)
        job = self.submit_generation(project_id, model=model, profile=profile, seed=seed)
        job_id = str(job["id"])
        finished = self.wait(job_id, timeout=timeout)
        descriptor = self._artifact_descriptor(finished)
        local_artifact = self.download_artifact(job_id, descriptor, destination)
        return ReconstructionResult(
            provider=self.name,
            model=model,
            project_id=project_id,
            job_id=job_id,
            candidate_id=candidate_id,
            artifact=local_artifact,
        )
