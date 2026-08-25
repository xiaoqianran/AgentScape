from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable

from .artifacts import write_atomic
from .connector_artifacts import ConnectorArtifactTransport
from .connector_capabilities import ConnectorCapabilityClient
from .contracts import ArtifactSummary, JobResult
from .errors import ArtifactError, ContractError, ProviderError
from .job_client import JobController, JobState
from .jobs import JobRequest


ImageRequestBuilder = Callable[[str], JobRequest]
ReconstructionRequestBuilder = Callable[[ArtifactSummary, JobState, str], JobRequest]


class ConnectorJobRunner:
    """发现 capability、提交 Job 并轮询到终态。"""

    def __init__(
        self,
        capabilities: ConnectorCapabilityClient,
        *,
        poll_interval: float = 1.0,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if poll_interval < 0:
            raise ValueError("poll_interval must be >= 0")
        self.capabilities = capabilities
        self.poll_interval = poll_interval
        self._monotonic = monotonic
        self._sleep = sleep

    def run(self, request: JobRequest, *, timeout: float = 1800.0) -> JobState:
        if timeout <= 0:
            raise ValueError("timeout must be > 0")
        deadline = self._monotonic() + timeout
        transport = self.capabilities.create_job_transport(request.provider, request.operation)
        controller = JobController(transport)
        state = controller.submit(request).job

        while not state.terminal:
            if self._monotonic() >= deadline:
                raise TimeoutError(f"Connector Job {state.id} did not finish within {timeout:.0f}s")
            state = controller.get(state.id).job
            if not state.terminal and self.poll_interval:
                remaining = deadline - self._monotonic()
                if remaining > 0:
                    self._sleep(min(self.poll_interval, remaining))

        if state.status != "succeeded":
            code = state.error_code or "UNKNOWN"
            raise ProviderError(f"Connector Job {state.id} ended as {state.status}: {code}")
        if state.result is None:
            raise ContractError(f"Connector Job {state.id} succeeded without result")
        return state


class ConnectorTextTo3DPipeline:
    """组合式 Connector Text→Image→Image→3D 编排。"""

    def __init__(
        self,
        runner: ConnectorJobRunner,
        artifacts: ConnectorArtifactTransport,
        image_request: ImageRequestBuilder,
        reconstruction_request: ReconstructionRequestBuilder,
        *,
        lossless_image_mimes: tuple[str, ...] = ("image/png",),
    ) -> None:
        self.runner = runner
        self.artifacts = artifacts
        self.image_request = image_request
        self.reconstruction_request = reconstruction_request
        self.lossless_image_mimes = lossless_image_mimes

    def run(
        self,
        prompt: str,
        output_dir: Path,
        *,
        image_timeout: float = 1800.0,
        reconstruction_timeout: float = 1800.0,
    ) -> dict[str, object]:
        output_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = output_dir / "manifest.json"
        manifest_path.unlink(missing_ok=True)

        image_request = self.image_request(prompt)
        image_job = self.runner.run(image_request, timeout=image_timeout)
        image_summary = self.artifacts.select_job_artifact(image_job, role="primary-image")
        self.artifacts.validate_summary(image_summary)
        if image_summary.mime not in self.lossless_image_mimes:
            raise ArtifactError(
                f"primary-image MIME 未声明为 lossless: {image_summary.mime or '<missing>'}"
            )

        reconstruction_request = self.reconstruction_request(image_summary, image_job, prompt)
        reconstruction_job = self.runner.run(
            reconstruction_request,
            timeout=reconstruction_timeout,
        )
        model_summary = self.artifacts.select_job_artifact(
            reconstruction_job,
            role="primary-glb",
        )
        model_path = output_dir / "model.glb"
        model_artifact = self.artifacts.download(model_summary, model_path)

        manifest: dict[str, object] = {
            "schema": "agentscape-client.connector-result.v1",
            "created_at": datetime.now(UTC).isoformat(),
            "strategy": "connector-composed-text-to-3d",
            "prompt": prompt,
            "providers": {
                "image": {
                    "name": image_request.provider,
                    "operation": image_request.operation,
                },
                "reconstruction": {
                    "name": reconstruction_request.provider,
                    "operation": reconstruction_request.operation,
                },
            },
            "artifacts": {
                "reference": {
                    **image_summary.to_dict(),
                    "lineage": {"parents": []},
                },
                "model": {
                    **model_summary.to_dict(),
                    **model_artifact.to_dict(relative_to=output_dir),
                    "lineage": {
                        "parents": [
                            {
                                "artifactId": image_summary.id,
                                "hash": image_summary.hash,
                                "relation": "derived_from",
                            }
                        ]
                    },
                },
            },
            "jobs": {
                "image_job_id": image_job.id,
                "reconstruction_job_id": reconstruction_job.id,
            },
            "requests": {
                "image": {
                    "requestHash": image_request.request_hash,
                    "idempotencyKey": image_request.idempotency_key,
                },
                "reconstruction": {
                    "requestHash": reconstruction_request.request_hash,
                    "idempotencyKey": reconstruction_request.idempotency_key,
                },
            },
            "result": JobResult(
                (model_summary,),
                manifest_id=reconstruction_job.result.manifest_id,
            ).to_dict(),
        }
        write_atomic(
            manifest_path,
            (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode(),
        )
        return manifest
