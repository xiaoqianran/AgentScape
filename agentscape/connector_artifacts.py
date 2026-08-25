from __future__ import annotations

import os
import re
import tempfile
from hashlib import sha256
from pathlib import Path

from .artifacts import validate_glb_prefix
from .connector_session import ConnectorSession
from .contracts import Artifact, ArtifactSummary
from .errors import ArtifactError, ConnectionRequiredError, ConnectorHttpError, ContractError
from .job_client import JobState


ARTIFACTS_PATH = "/connector/v1/artifacts"
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_MIME_FORMAT = {
    "model/gltf-binary": "glb",
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/webp": "webp",
}


class ConnectorArtifactTransport:
    """流式下载 Connector Artifact，并在发布前完成完整性校验。"""

    def __init__(
        self,
        session: ConnectorSession,
        *,
        max_bytes: int = 256 * 1024 * 1024,
        max_chunks: int = 65536,
    ) -> None:
        if not isinstance(max_bytes, int) or isinstance(max_bytes, bool) or max_bytes < 0 or max_bytes > 2**53 - 1:
            raise ContractError("Artifact max_bytes 必须是 JS 安全的非负整数")
        if not isinstance(max_chunks, int) or isinstance(max_chunks, bool) or max_chunks < 1 or max_chunks > 2**53 - 1:
            raise ContractError("Artifact max_chunks 必须是 JS 安全的正整数")
        self.session = session
        self.max_bytes = max_bytes
        self.max_chunks = max_chunks

    def download_job_artifact(
        self,
        job: JobState,
        destination: Path,
        *,
        artifact_id: str | None = None,
        role: str | None = None,
    ) -> Artifact:
        summary = self.select_job_artifact(job, artifact_id=artifact_id, role=role)
        return self.download(summary, destination)

    @staticmethod
    def select_job_artifact(
        job: JobState,
        *,
        artifact_id: str | None = None,
        role: str | None = None,
    ) -> ArtifactSummary:
        if job.status != "succeeded" or job.result is None:
            raise ContractError(f"Job 尚未产生可下载 Artifact: {job.id} status={job.status}")
        artifacts = job.result.artifacts
        if artifact_id:
            selected = next((item for item in artifacts if item.id == artifact_id), None)
        elif role:
            selected = next((item for item in artifacts if item.role == role), None)
        else:
            selected = next((item for item in artifacts if item.mime == "model/gltf-binary"), None)
            selected = selected or next((item for item in artifacts if item.role == "primary-glb"), None)
            selected = selected or (artifacts[0] if artifacts else None)
        if selected is None:
            raise ContractError("Job result 中没有匹配的 Artifact")
        return selected

    def download(self, summary: ArtifactSummary, destination: Path) -> Artifact:
        artifact_id, mime, expected_bytes, expected_hash, format_name = self._validate_summary(summary)
        if expected_bytes > self.max_bytes:
            raise ArtifactError(f"Artifact 声明大小超过限制: {expected_bytes} > {self.max_bytes}")

        response = self.session.request(
            "GET",
            f"{ARTIFACTS_PATH}/{artifact_id}",
            scope="artifacts.read",
            headers={"Accept": mime},
            stream=True,
        )
        try:
            if response.is_redirect or response.history:
                raise ArtifactError("Connector Artifact 禁止 redirect")
            if response.status_code in {401, 403}:
                raise ConnectionRequiredError(f"Connector artifact 需要有效 session (HTTP {response.status_code})")
            if not response.is_success:
                raise ConnectorHttpError(code="CONNECTOR_ARTIFACT_HTTP_ERROR", status=response.status_code)

            encoding = str(response.headers.get("content-encoding") or "").strip().lower()
            if encoding and encoding != "identity":
                raise ArtifactError(f"Artifact 不支持 Content-Encoding: {encoding}")

            response_type = str(response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
            if response_type and response_type != mime:
                raise ArtifactError(f"Artifact Content-Type 不匹配: expected={mime}, actual={response_type}")

            content_length = self._content_length(response.headers.get("content-length"))
            if content_length is not None:
                if content_length > self.max_bytes:
                    raise ArtifactError("Artifact Content-Length 超过限制")
                if content_length != expected_bytes:
                    raise ArtifactError(
                        f"Artifact Content-Length 不匹配: expected={expected_bytes}, actual={content_length}"
                    )

            return self._stream_to_file(
                response,
                summary,
                destination,
                expected_bytes=expected_bytes,
                expected_hash=expected_hash,
                mime=mime,
                format_name=format_name,
            )
        finally:
            response.close()

    @staticmethod
    def _content_length(value: str | None) -> int | None:
        if value is None or value == "":
            return None
        text = str(value).strip()
        if not text.isascii() or not text.isdigit():
            raise ArtifactError("Artifact Content-Length 无效")
        number = int(text)
        if number > 2**53 - 1:
            raise ArtifactError("Artifact Content-Length 超出 JS 安全范围")
        return number

    def _stream_to_file(
        self,
        response,
        summary: ArtifactSummary,
        destination: Path,
        *,
        expected_bytes: int,
        expected_hash: str,
        mime: str,
        format_name: str,
    ) -> Artifact:
        destination.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent)
        temp_path = Path(temp_name)
        digest = sha256()
        total = 0
        chunks = 0
        prefix = bytearray()
        try:
            with os.fdopen(fd, "wb") as stream:
                try:
                    for chunk in response.iter_raw():
                        chunks += 1
                        if chunks > self.max_chunks:
                            raise ArtifactError(f"Artifact stream chunk 数超过限制: {self.max_chunks}")
                        if not isinstance(chunk, bytes):
                            chunk = bytes(chunk)
                        total += len(chunk)
                        if total > self.max_bytes:
                            raise ArtifactError("Artifact stream 超过 max_bytes")
                        if total > expected_bytes:
                            raise ArtifactError(
                                f"Artifact stream 超过声明大小: expected={expected_bytes}, actual_at_least={total}"
                            )
                        if len(prefix) < 64:
                            prefix.extend(chunk[: 64 - len(prefix)])
                        digest.update(chunk)
                        stream.write(chunk)
                except ArtifactError:
                    raise
                except Exception as exc:
                    raise ArtifactError("Artifact stream 读取失败") from exc
                stream.flush()
                os.fsync(stream.fileno())

            if total != expected_bytes:
                raise ArtifactError(f"Artifact stream 长度不匹配: expected={expected_bytes}, actual={total}")
            actual_hash = f"sha256:{digest.hexdigest()}"
            if actual_hash != expected_hash:
                raise ArtifactError("Artifact SHA-256 校验失败")
            self._validate_content(mime, bytes(prefix), total)
            os.replace(temp_path, destination)
            return Artifact(
                path=destination,
                mime=mime,
                format=format_name,
                bytes=total,
                hash=actual_hash,
                id=summary.id,
            )
        finally:
            temp_path.unlink(missing_ok=True)

    @staticmethod
    def _validate_summary(summary: ArtifactSummary) -> tuple[str, str, int, str, str]:
        artifact_id = str(summary.id or "").strip()
        if not _SAFE_ID.fullmatch(artifact_id):
            raise ContractError("Artifact ID 必须是 opaque URL-safe identifier")
        mime = str(summary.mime or "").strip().lower()
        format_name = _MIME_FORMAT.get(mime)
        if format_name is None:
            raise ArtifactError(f"暂不支持 Artifact MIME: {mime or '<missing>'}")
        if not isinstance(summary.bytes, int) or isinstance(summary.bytes, bool) or summary.bytes < 0 or summary.bytes > 2**53 - 1:
            raise ContractError("Artifact bytes 必须是 JS 安全的非负整数")
        expected_hash = str(summary.hash or "").strip()
        if not _SHA256.fullmatch(expected_hash):
            raise ContractError("Artifact hash 必须是 canonical sha256:<64 lowercase hex>")
        return artifact_id, mime, summary.bytes, expected_hash, format_name

    @staticmethod
    def _validate_content(mime: str, prefix: bytes, total: int) -> None:
        if mime == "model/gltf-binary":
            validate_glb_prefix(prefix, total)
            return
        if mime == "image/png":
            if len(prefix) < 8 or prefix[:8] != b"\x89PNG\r\n\x1a\n":
                raise ArtifactError("PNG signature 不匹配")
            return
        if mime == "image/jpeg":
            if len(prefix) < 3 or prefix[:3] != b"\xff\xd8\xff":
                raise ArtifactError("JPEG signature 不匹配")
            return
        if mime == "image/webp":
            if len(prefix) < 12 or prefix[:4] != b"RIFF" or prefix[8:12] != b"WEBP":
                raise ArtifactError("WebP signature 不匹配")
            return
        raise ArtifactError(f"暂不支持 Artifact MIME: {mime}")
