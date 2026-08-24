from __future__ import annotations

import mimetypes
import time
from pathlib import Path

import httpx

from .kaggle import ProviderError


class Modal3DProvider:
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
        return self._request("GET", "/v1/models").json()

    def create_project(self, image_path: Path) -> dict:
        mime = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
        with image_path.open("rb") as stream:
            response = self._request(
                "POST",
                "/v1/projects",
                files={"file": (image_path.name, stream, mime)},
            )
        return response.json()

    def segment(self, project_id: str, concept: str) -> dict:
        return self._request(
            "POST",
            f"/v1/projects/{project_id}/segment",
            json={"concept": concept, "max_candidates": 1},
        ).json()

    def materialize(self, project_id: str, candidate_id: str, *, output_size: int = 1024) -> dict:
        return self._request(
            "POST",
            f"/v1/projects/{project_id}/materialize",
            json={"candidate_id": candidate_id, "output_size": output_size},
        ).json()

    def submit_generation(
        self,
        project_id: str,
        *,
        model: str,
        profile: str = "recommended",
        seed: int = 42,
    ) -> dict:
        return self._request(
            "POST",
            f"/v1/projects/{project_id}/generation",
            json={"model": model, "profile": profile, "seed": seed},
        ).json()["job"]

    def wait(self, job_id: str, *, timeout: float = 1800.0) -> dict:
        deadline = time.monotonic() + timeout
        terminal = {"succeeded", "failed", "cancelled", "expired"}
        while time.monotonic() < deadline:
            job = self._request("GET", f"/v1/jobs/{job_id}").json()
            status = job.get("status")
            if status in terminal:
                if status != "succeeded":
                    raise ProviderError(
                        f"modal-3D job {job_id} ended as {status}: {job.get('error') or 'unknown error'}"
                    )
                return job
            time.sleep(self.poll_interval)
        raise TimeoutError(f"modal-3D job {job_id} did not finish within {timeout:.0f}s")

    def download_artifact(self, artifact_path: str, destination: Path) -> Path:
        response = self._request("GET", "/v1/assets", params={"path": artifact_path})
        data = response.content
        if len(data) < 12 or data[:4] != b"glTF":
            raise ProviderError("modal-3D returned an invalid GLB artifact")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        return destination

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
    ) -> dict:
        project = self.create_project(image_path)
        project_id = project["id"]
        selection = self.segment(project_id, concept)
        candidates = selection.get("selection", {}).get("candidates", [])
        if not candidates:
            raise ProviderError(f"SAM found no candidate matching concept: {concept}")
        candidate_id = candidates[0]["candidate_id"]
        self.materialize(project_id, candidate_id, output_size=output_size)
        job = self.submit_generation(project_id, model=model, profile=profile, seed=seed)
        finished = self.wait(job["id"], timeout=timeout)
        artifact = (finished.get("result") or {}).get("artifact") or {}
        artifact_path = artifact.get("path")
        if not artifact_path:
            raise ProviderError("modal-3D job succeeded without result.artifact.path")
        self.download_artifact(artifact_path, destination)
        return {
            "project_id": project_id,
            "job_id": job["id"],
            "candidate_id": candidate_id,
            "artifact_path": artifact_path,
            "artifact": str(destination),
            "remote": finished,
        }
