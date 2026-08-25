from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path
import re
from uuid import uuid4

from .errors import ContractError


ROLE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")


@dataclass(frozen=True, slots=True)
class Artifact:
    path: Path
    mime: str
    format: str
    bytes: int
    hash: str
    id: str = field(default_factory=lambda: f"artifact_{uuid4().hex}")

    @classmethod
    def from_file(cls, path: Path, *, mime: str, format: str) -> "Artifact":
        digest = sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return cls(
            path=path,
            mime=mime,
            format=format,
            bytes=path.stat().st_size,
            hash=f"sha256:{digest.hexdigest()}",
        )

    def summary(self, role: str) -> "ArtifactSummary":
        if not ROLE_RE.fullmatch(role):
            raise ContractError(f"Artifact role 不符合 AgentScape 契约: {role!r}")
        return ArtifactSummary(
            id=self.id,
            role=role,
            mime=self.mime,
            bytes=self.bytes,
            hash=self.hash,
        )

    def to_dict(self, *, relative_to: Path | None = None) -> dict[str, object]:
        path = self.path
        if relative_to is not None:
            try:
                path = path.relative_to(relative_to)
            except ValueError:
                pass
        return {
            "id": self.id,
            "path": str(path),
            "mime": self.mime,
            "format": self.format,
            "bytes": self.bytes,
            "hash": self.hash,
        }


@dataclass(frozen=True, slots=True)
class ArtifactSummary:
    """AgentScape Connector Job result 可直接消费的 Artifact 摘要。"""

    id: str
    role: str
    mime: str | None
    bytes: int | None
    hash: str | None

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "role": self.role,
            "mime": self.mime,
            "bytes": self.bytes,
            "hash": self.hash,
        }


@dataclass(frozen=True, slots=True)
class JobResult:
    """只描述 Provider 结果，不伪造 Connector Job identity。"""

    artifacts: tuple[ArtifactSummary, ...]
    manifest_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        result: dict[str, object] = {"artifacts": [artifact.to_dict() for artifact in self.artifacts]}
        if self.manifest_id is not None:
            result["manifestId"] = self.manifest_id
        return result


@dataclass(frozen=True, slots=True)
class ImageGenerationResult:
    provider: str
    model: str
    task_id: str
    artifact: Artifact

    def to_dict(self) -> dict[str, object]:
        return {
            "provider": self.provider,
            "model": self.model,
            "task_id": self.task_id,
            "artifact": self.artifact.to_dict(),
        }


@dataclass(frozen=True, slots=True)
class ReconstructionResult:
    provider: str
    model: str
    project_id: str
    job_id: str
    candidate_id: str
    artifact: Artifact

    def to_dict(self) -> dict[str, object]:
        return {
            "provider": self.provider,
            "model": self.model,
            "project_id": self.project_id,
            "job_id": self.job_id,
            "candidate_id": self.candidate_id,
            "artifact": self.artifact.to_dict(),
        }
