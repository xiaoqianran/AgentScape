from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from agentscape.connector_artifacts import ConnectorArtifactTransport
from agentscape.connector_session import ConnectorSession
from agentscape.contracts import ArtifactSummary, JobResult
from agentscape.errors import ArtifactError, ConnectionRequiredError, ConnectorHttpError, ContractError
from agentscape.job_client import JobState


NOW = datetime(2026, 8, 25, 6, 0, tzinfo=UTC)


def glb() -> bytes:
    json_chunk = b"{}  "
    total = 20 + len(json_chunk)
    return (
        b"glTF"
        + (2).to_bytes(4, "little")
        + total.to_bytes(4, "little")
        + len(json_chunk).to_bytes(4, "little")
        + (0x4E4F534A).to_bytes(4, "little")
        + json_chunk
    )


def summary(data: bytes, **overrides) -> ArtifactSummary:
    values = {
        "id": "artifact_01",
        "role": "primary-glb",
        "mime": "model/gltf-binary",
        "bytes": len(data),
        "hash": f"sha256:{hashlib.sha256(data).hexdigest()}",
    }
    values.update(overrides)
    return ArtifactSummary(**values)


def job_state(*artifacts: ArtifactSummary, status: str = "succeeded") -> JobState:
    return JobState(
        id="job_01",
        provider="modal-3d",
        operation="modal-3d.asset.image_to_3d.v1",
        request_hash="sha256:req",
        idempotency_key="idem_req",
        status=status,
        event_sequence=1,
        contract_version="1",
        capability_hash="sha256:cap",
        capability_revision="caprev_01",
        result=JobResult(tuple(artifacts)) if artifacts else None,
    )


class ChunkStream(httpx.SyncByteStream):
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks

    def __iter__(self):
        yield from self.chunks


class FailingStream(httpx.SyncByteStream):
    def __iter__(self):
        yield b"glTF"
        raise RuntimeError("internal endpoint secret detail")


def session(handler, *, scopes=("artifacts.read",)) -> ConnectorSession:
    return ConnectorSession(
        "http://127.0.0.1:39001",
        "session-secret",
        {
            "connector": {"id": "unified-connector", "instance": "instance_01", "version": "1.0.0"},
            "contractVersion": "1",
            "clientIdentity": "agentscape",
            "tokenId": "token_01",
            "scopes": scopes,
            "issuedAt": "2026-08-25T05:30:00.000Z",
            "expiresAt": "2026-08-25T07:30:00.000Z",
            "allowedOrigins": ("http://localhost:3000",),
            "capabilityRevision": "caprev_01",
            "capabilityHash": "sha256:cap01",
            "revokeEndpoint": "/connector/v1/session",
        },
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        now=lambda: NOW,
    )


def response(data: bytes, *, chunks: list[bytes] | None = None, headers=None, status=200) -> httpx.Response:
    defaults = {"content-type": "model/gltf-binary", "content-length": str(len(data))}
    defaults.update(headers or {})
    return httpx.Response(status, headers=defaults, stream=ChunkStream(chunks or [data]))



def test_job_artifact_selection_prefers_glb_and_supports_role_or_id(tmp_path: Path) -> None:
    image = summary(b"RIFFxxxxWEBPrest", id="image_01", role="preview-image", mime="image/webp")
    model = summary(glb(), id="model_01", role="primary-glb")
    job = job_state(image, model)

    assert ConnectorArtifactTransport.select_job_artifact(job).id == "model_01"
    assert ConnectorArtifactTransport.select_job_artifact(job, role="preview-image").id == "image_01"
    assert ConnectorArtifactTransport.select_job_artifact(job, artifact_id="model_01").role == "primary-glb"

    with pytest.raises(ContractError, match="没有匹配"):
        ConnectorArtifactTransport.select_job_artifact(job, role="missing")


def test_job_artifact_selection_rejects_non_succeeded_job() -> None:
    with pytest.raises(ContractError, match="尚未产生"):
        ConnectorArtifactTransport.select_job_artifact(job_state(status="running"))

def test_download_streams_verified_glb_to_atomic_destination(tmp_path: Path) -> None:
    data = glb()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/connector/v1/artifacts/artifact_01"
        assert request.headers["Authorization"] == "Bearer session-secret"
        assert request.headers["Accept"] == "model/gltf-binary"
        return response(data, chunks=[data[:3], data[3:11], data[11:]])

    destination = tmp_path / "model.glb"
    artifact = ConnectorArtifactTransport(session(handler)).download(summary(data), destination)

    assert artifact.id == "artifact_01"
    assert artifact.mime == "model/gltf-binary"
    assert artifact.format == "glb"
    assert artifact.bytes == len(data)
    assert artifact.hash == summary(data).hash
    assert destination.read_bytes() == data
    assert not list(tmp_path.glob(".model.glb.*.tmp"))


def test_download_accepts_missing_content_length_when_stream_matches(tmp_path: Path) -> None:
    data = glb()
    client = ConnectorArtifactTransport(
        session(lambda request: response(data, headers={"content-length": ""}))
    )

    artifact = client.download(summary(data), tmp_path / "model.glb")

    assert artifact.bytes == len(data)


@pytest.mark.parametrize(
    ("mime", "data", "format_name"),
    [
        ("image/png", b"\x89PNG\r\n\x1a\nrest", "png"),
        ("image/jpeg", b"\xff\xd8\xffrest", "jpeg"),
        ("image/webp", b"RIFFxxxxWEBPrest", "webp"),
    ],
)
def test_download_supports_primary_image_mimes(tmp_path: Path, mime: str, data: bytes, format_name: str) -> None:
    item = summary(data, role="primary-image", mime=mime)
    client = ConnectorArtifactTransport(
        session(lambda request: response(data, headers={"content-type": mime}))
    )

    artifact = client.download(item, tmp_path / f"image.{format_name}")

    assert artifact.format == format_name
    assert artifact.mime == mime


def test_redirect_and_http_failure_fail_closed(tmp_path: Path) -> None:
    redirected = ConnectorArtifactTransport(
        session(lambda request: httpx.Response(302, headers={"location": "https://example.com/file"}))
    )
    with pytest.raises(ArtifactError, match="redirect"):
        redirected.download(summary(glb()), tmp_path / "redirect.glb")

    unauthorized = ConnectorArtifactTransport(session(lambda request: httpx.Response(401)))
    with pytest.raises(ConnectionRequiredError, match="有效 session"):
        unauthorized.download(summary(glb()), tmp_path / "unauthorized.glb")

    failed = ConnectorArtifactTransport(session(lambda request: httpx.Response(503)))
    with pytest.raises(ConnectorHttpError) as exc:
        failed.download(summary(glb()), tmp_path / "failed.glb")
    assert exc.value.status == 503
    assert exc.value.code == "CONNECTOR_ARTIFACT_HTTP_ERROR"


def test_mime_encoding_and_content_length_mismatch_preserve_existing_file(tmp_path: Path) -> None:
    data = glb()
    destination = tmp_path / "model.glb"
    destination.write_bytes(b"existing")

    cases = [
        ({"content-type": "application/json"}, "Content-Type"),
        ({"content-encoding": "gzip"}, "Content-Encoding"),
        ({"content-length": str(len(data) - 1)}, "Content-Length"),
        ({"content-length": "bad"}, "Content-Length"),
    ]
    for headers, message in cases:
        client = ConnectorArtifactTransport(session(lambda request, h=headers: response(data, headers=h)))
        with pytest.raises(ArtifactError, match=message):
            client.download(summary(data), destination)
        assert destination.read_bytes() == b"existing"


def test_stream_length_and_hash_mismatch_never_publish(tmp_path: Path) -> None:
    data = glb()
    destination = tmp_path / "model.glb"
    destination.write_bytes(b"existing")

    truncated = ConnectorArtifactTransport(
        session(lambda request: response(data[:-1], headers={"content-length": ""}))
    )
    with pytest.raises(ArtifactError, match="长度不匹配"):
        truncated.download(summary(data), destination)
    assert destination.read_bytes() == b"existing"

    tampered = bytearray(data)
    tampered[-1] ^= 1
    altered = bytes(tampered)
    mismatch = ConnectorArtifactTransport(
        session(lambda request: response(altered, headers={"content-length": str(len(data))}))
    )
    with pytest.raises(ArtifactError, match="SHA-256"):
        mismatch.download(summary(data), destination)
    assert destination.read_bytes() == b"existing"


def test_invalid_glb_structure_never_publish(tmp_path: Path) -> None:
    valid = glb()
    destination = tmp_path / "model.glb"
    destination.write_bytes(b"existing")

    invalid_cases = [
        b"bad" + valid[3:],
        valid[:4] + (1).to_bytes(4, "little") + valid[8:],
        valid[:16] + (0).to_bytes(4, "little") + valid[20:],
    ]
    for data in invalid_cases:
        item = summary(data)
        client = ConnectorArtifactTransport(session(lambda request, d=data: response(d)))
        with pytest.raises(ArtifactError):
            client.download(item, destination)
        assert destination.read_bytes() == b"existing"



def test_stream_failure_is_sanitized_and_cleans_temp_file(tmp_path: Path) -> None:
    data = glb()
    client = ConnectorArtifactTransport(
        session(lambda request: httpx.Response(200, headers={"content-type": "model/gltf-binary"}, stream=FailingStream()))
    )

    with pytest.raises(ArtifactError, match="读取失败") as exc:
        client.download(summary(data), tmp_path / "model.glb")

    assert "secret detail" not in str(exc.value)
    assert not (tmp_path / "model.glb").exists()
    assert not list(tmp_path.glob(".model.glb.*.tmp"))

def test_max_bytes_and_chunk_limit_abort_before_publish(tmp_path: Path) -> None:
    data = glb()
    destination = tmp_path / "model.glb"

    with pytest.raises(ArtifactError, match="声明大小超过限制"):
        ConnectorArtifactTransport(session(lambda request: response(data)), max_bytes=len(data) - 1).download(
            summary(data), destination
        )

    chunks = [bytes([value]) for value in data]
    client = ConnectorArtifactTransport(
        session(lambda request: response(data, chunks=chunks)),
        max_chunks=4,
    )
    with pytest.raises(ArtifactError, match="chunk 数"):
        client.download(summary(data), destination)
    assert not destination.exists()


def test_summary_contract_rejects_unsafe_identity_hash_bytes_and_mime(tmp_path: Path) -> None:
    data = glb()
    client = ConnectorArtifactTransport(session(lambda request: response(data)))

    bad = [
        summary(data, id="../artifact"),
        summary(data, hash="SHA256:bad"),
        summary(data, bytes=-1),
        summary(data, mime="application/zip"),
    ]
    for item in bad:
        with pytest.raises((ContractError, ArtifactError)):
            client.download(item, tmp_path / "bad.bin")


def test_missing_artifact_scope_fails_before_http(tmp_path: Path) -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return response(glb())

    client = ConnectorArtifactTransport(session(handler, scopes=("jobs.read",)))
    with pytest.raises(ContractError, match="artifacts.read"):
        client.download(summary(glb()), tmp_path / "model.glb")
    assert called is False
