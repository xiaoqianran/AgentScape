from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Artifact:
    path: Path
    mime: str
    format: str
    bytes: int
    hash: str

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

    def to_dict(self, *, relative_to: Path | None = None) -> dict[str, object]:
        path = self.path
        if relative_to is not None:
            try:
                path = path.relative_to(relative_to)
            except ValueError:
                pass
        return {
            "path": str(path),
            "mime": self.mime,
            "format": self.format,
            "bytes": self.bytes,
            "hash": self.hash,
        }


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
