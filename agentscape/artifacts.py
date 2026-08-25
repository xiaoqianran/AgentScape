from __future__ import annotations

import os
import tempfile
from hashlib import sha256
from pathlib import Path

from .contracts import Artifact
from .errors import ArtifactError


def write_atomic(destination: Path, data: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, destination)
    finally:
        temp_path.unlink(missing_ok=True)


def write_artifact(
    destination: Path,
    data: bytes,
    *,
    mime: str,
    format: str,
    artifact_id: str | None = None,
) -> Artifact:
    write_atomic(destination, data)
    values = {
        "path": destination,
        "mime": mime,
        "format": format,
        "bytes": len(data),
        "hash": f"sha256:{sha256(data).hexdigest()}",
    }
    return Artifact(**values, **({"id": artifact_id} if artifact_id else {}))


def validate_glb(data: bytes) -> None:
    if len(data) < 12 or data[:4] != b"glTF":
        raise ArtifactError("modal-3D 返回的产物不是有效 GLB")

    version = int.from_bytes(data[4:8], "little")
    if version != 2:
        raise ArtifactError(f"modal-3D 返回不支持的 GLB version: {version}")

    declared_length = int.from_bytes(data[8:12], "little")
    if declared_length != len(data):
        raise ArtifactError(
            f"modal-3D 返回的 GLB 长度不一致: header={declared_length}, actual={len(data)}"
        )
