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


def validate_glb_prefix(prefix: bytes, total_bytes: int) -> None:
    if len(prefix) < 20 or prefix[:4] != b"glTF":
        raise ArtifactError("产物不是有效 GLB")

    version = int.from_bytes(prefix[4:8], "little")
    if version != 2:
        raise ArtifactError(f"不支持的 GLB version: {version}")

    declared_length = int.from_bytes(prefix[8:12], "little")
    if declared_length != total_bytes:
        raise ArtifactError(f"GLB 长度不一致: header={declared_length}, actual={total_bytes}")

    chunk_length = int.from_bytes(prefix[12:16], "little")
    chunk_type = int.from_bytes(prefix[16:20], "little")
    if chunk_type != 0x4E4F534A:
        raise ArtifactError("GLB 首个 chunk 必须是 JSON")
    if chunk_length < 4 or chunk_length % 4 or 20 + chunk_length > total_bytes:
        raise ArtifactError("GLB JSON chunk 长度无效")

    inspect_end = min(len(prefix), 20 + chunk_length)
    json_prefix = prefix[20:inspect_end].lstrip(b" \t\r\n")
    if json_prefix and not json_prefix.startswith(b"{"):
        raise ArtifactError("GLB JSON chunk 必须以对象开始")


def validate_glb(data: bytes) -> None:
    validate_glb_prefix(data[:64], len(data))
