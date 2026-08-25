from __future__ import annotations

import time
from pathlib import Path

import httpx

from ..artifacts import write_artifact
from ..contracts import ImageGenerationResult
from ..errors import ArtifactError, ContractError, ProviderError


class KaggleImageProvider:
    name = "kaggle-inference-hub"

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        client: httpx.Client | None = None,
        poll_interval: float = 1.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.client = client or httpx.Client(timeout=60.0)
        self.poll_interval = poll_interval

    def _auth_headers(self) -> dict[str, str]:
        if not self.token:
            raise ProviderError("AGENTSCAPE_KAGGLE_TOKEN is required for task submission")
        return {"Authorization": f"Bearer {self.token}"}

    def probe(self) -> dict:
        response = self.client.get(f"{self.base_url}/api/status")
        response.raise_for_status()
        return response.json()

    def models(self) -> list[dict]:
        response = self.client.get(f"{self.base_url}/api/models")
        response.raise_for_status()
        value = response.json()
        if isinstance(value, list):
            return value
        if isinstance(value, dict) and isinstance(value.get("models"), list):
            return value["models"]
        raise ContractError("Kaggle /api/models 返回结构无效")

    def submit(
        self,
        prompt: str,
        *,
        model: str = "sana-sprint-1.6b",
        seed: int | None = None,
        width: int = 1024,
        height: int = 1024,
        steps: int | None = None,
    ) -> int:
        response = self.client.post(
            f"{self.base_url}/task",
            headers=self._auth_headers(),
            json={
                "prompt": prompt,
                "model": model,
                "seed": seed,
                "width": width,
                "height": height,
                "steps": steps,
            },
        )
        response.raise_for_status()
        payload = response.json()
        try:
            return int(payload["task"]["id"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ContractError("Kaggle /task 返回缺少 task.id") from exc

    def wait(self, task_id: int, *, model: str, timeout: float = 600.0) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            response = self.client.get(
                f"{self.base_url}/api/history",
                params={"model": model, "limit": 500},
            )
            response.raise_for_status()
            history = response.json()
            if not isinstance(history, list):
                raise ContractError("Kaggle /api/history 返回结构无效")
            for item in history:
                if not isinstance(item, dict):
                    continue
                try:
                    current_id = int(item.get("id", -1))
                except (TypeError, ValueError):
                    continue
                if current_id == task_id:
                    if item.get("kind") != "image" or not item.get("url"):
                        raise ArtifactError(f"Kaggle task {task_id} 未返回图片产物")
                    return item
            time.sleep(self.poll_interval)
        raise TimeoutError(f"Kaggle task {task_id} did not finish within {timeout:.0f}s")

    def download(self, item: dict, destination: Path):
        url = item.get("url")
        if not isinstance(url, str) or not url:
            raise ContractError("Kaggle image artifact 缺少 url")
        response = self.client.get(url if url.startswith("http") else f"{self.base_url}{url}")
        response.raise_for_status()
        if not response.content:
            raise ArtifactError("Kaggle 返回空图片产物")
        return write_artifact(destination, response.content, mime="image/webp", format="webp")

    def generate(
        self,
        prompt: str,
        destination: Path,
        *,
        model: str = "sana-sprint-1.6b",
        seed: int | None = None,
        width: int = 1024,
        height: int = 1024,
        steps: int | None = None,
        timeout: float = 600.0,
    ) -> ImageGenerationResult:
        task_id = self.submit(
            prompt,
            model=model,
            seed=seed,
            width=width,
            height=height,
            steps=steps,
        )
        item = self.wait(task_id, model=model, timeout=timeout)
        artifact = self.download(item, destination)
        return ImageGenerationResult(
            provider=self.name,
            model=model,
            task_id=str(task_id),
            artifact=artifact,
        )
