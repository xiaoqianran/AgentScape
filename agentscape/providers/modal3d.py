from __future__ import annotations

import mimetypes
import time
from pathlib import Path

import httpx

from ..artifacts import validate_glb, write_artifact
from ..contracts import Artifact, ReconstructionResult
from ..errors import ContractError, ProviderError


class Modal3DProvider:
    name = "modal-3d"

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

    def wait(self, job_id: str, *, timeout: float = 1800.0) -> dict:
        deadline = time.monotonic() + timeout
        terminal = {"succeeded", "failed", "cancelled", "expired"}
        while time.monotonic() < deadline:
            job = self._request("GET", f"/v1/jobs/{job_id}").json()
            if not isinstance(job, dict):
                raise ContractError("modal-3D job 返回结构无效")
            status = job.get("status")
            if status in terminal:
                if status != "succeeded":
                    error = job.get("error") or "unknown error"
                    raise ProviderError(f"modal-3D job {job_id} ended as {status}: {error}")
                return job
            time.sleep(self.poll_interval)
        raise TimeoutError(f"modal-3D job {job_id} did not finish within {timeout:.0f}s")

    def download_artifact(self, artifact_path: str, destination: Path) -> Artifact:
        response = self._request("GET", "/v1/assets", params={"path": artifact_path})
        validate_glb(response.content)
        return write_artifact(destination, response.content, mime="model/gltf-binary", format="glb")

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
        result = finished.get("result")
        artifact = result.get("artifact") if isinstance(result, dict) else None
        artifact_path = artifact.get("path") if isinstance(artifact, dict) else None
        if not isinstance(artifact_path, str) or not artifact_path:
            raise ContractError("modal-3D job succeeded without result.artifact.path")

        local_artifact = self.download_artifact(artifact_path, destination)
        return ReconstructionResult(
            provider=self.name,
            model=model,
            project_id=project_id,
            job_id=job_id,
            candidate_id=candidate_id,
            artifact=local_artifact,
        )
