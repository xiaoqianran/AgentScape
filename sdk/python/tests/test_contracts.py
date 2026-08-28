from __future__ import annotations

import re
from pathlib import Path

import pytest

from agentscape.contracts import Artifact, JobResult
from agentscape.errors import ContractError


SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,160}$")


def test_artifact_identity_is_opaque_not_content_identity(tmp_path: Path) -> None:
    first_path = tmp_path / "first.glb"
    second_path = tmp_path / "second.glb"
    first_path.write_bytes(b"same-bytes")
    second_path.write_bytes(b"same-bytes")

    first = Artifact.from_file(first_path, mime="model/gltf-binary", format="glb")
    second = Artifact.from_file(second_path, mime="model/gltf-binary", format="glb")

    assert first.hash == second.hash
    assert first.id != second.id
    assert SAFE_ID.fullmatch(first.id)
    assert SAFE_ID.fullmatch(second.id)


def test_job_result_contains_only_agentscape_artifact_summary(tmp_path: Path) -> None:
    path = tmp_path / "model.glb"
    path.write_bytes(b"model")
    artifact = Artifact.from_file(path, mime="model/gltf-binary", format="glb")

    result = JobResult((artifact.summary("primary-glb"),)).to_dict()

    assert result == {
        "artifacts": [
            {
                "id": artifact.id,
                "role": "primary-glb",
                "mime": "model/gltf-binary",
                "bytes": 5,
                "hash": artifact.hash,
            }
        ]
    }
    assert "path" not in result["artifacts"][0]
    assert "format" not in result["artifacts"][0]


def test_artifact_summary_rejects_invalid_role(tmp_path: Path) -> None:
    path = tmp_path / "model.glb"
    path.write_bytes(b"model")
    artifact = Artifact.from_file(path, mime="model/gltf-binary", format="glb")

    with pytest.raises(ContractError, match="Artifact role"):
        artifact.summary("invalid role")
