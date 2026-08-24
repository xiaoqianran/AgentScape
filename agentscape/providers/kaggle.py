from __future__ import annotations

import time
from pathlib import Path

import httpx


class ProviderError(RuntimeError):
    pass


class KaggleImageProvider:
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
        return value if isinstance(value, list) else value.get("models", [])

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
        payload = {
            "prompt": prompt,
            "model": model,
            "seed": seed,
            "width": width,
            "height": height,
            "steps": steps,
        }
        response = self.client.post(
            f"{self.base_url}/task",
            headers=self._auth_headers(),
            json=payload,
        )
        response.raise_for_status()
        return int(response.json()["task"]["id"])

    def wait(self, task_id: int, *, model: str, timeout: float = 600.0) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            response = self.client.get(
                f"{self.base_url}/api/history",
                params={"model": model, "limit": 500},
            )
            response.raise_for_status()
            for item in response.json():
                if int(item.get("id", -1)) == task_id:
                    if item.get("kind") != "image" or not item.get("url"):
                        raise ProviderError(f"Kaggle task {task_id} returned no image artifact")
                    return item
            time.sleep(self.poll_interval)
        raise TimeoutError(f"Kaggle task {task_id} did not finish within {timeout:.0f}s")

    def download(self, item: dict, destination: Path) -> Path:
        url = str(item["url"])
        response = self.client.get(url if url.startswith("http") else f"{self.base_url}{url}")
        response.raise_for_status()
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(response.content)
        return destination

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
    ) -> dict:
        task_id = self.submit(
            prompt,
            model=model,
            seed=seed,
            width=width,
            height=height,
            steps=steps,
        )
        item = self.wait(task_id, model=model, timeout=timeout)
        self.download(item, destination)
        return {"task_id": task_id, "artifact": str(destination), "remote": item}
