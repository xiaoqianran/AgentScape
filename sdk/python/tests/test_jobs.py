from __future__ import annotations

import pytest

from agentscape.capabilities import MODAL_3D_IMAGE_TO_3D
from agentscape.errors import ContractError
from agentscape.jobs import JobRequest


BASE = JobRequest(
    provider="modal-3d",
    operation=MODAL_3D_IMAGE_TO_3D,
    inputs={
        "image": {
            "artifactId": "artifact_01",
            "hash": "sha256:" + "a" * 64,
            "mime": "image/png",
        },
        "concept": "mossy shrine",
    },
    profile="recommended",
    options={"model": "fastsam3d", "seed": 42},
    output_roles=("primary-glb",),
)


def test_request_identity_matches_agentscape_reference() -> None:
    assert BASE.request_hash == "sha256:4b2daa5d5bf3b9b0dd161802779261443d98201d569840cdebf75df5a5262aee"
    assert BASE.idempotency_key == "idem_4b2daa5d5bf3b9b0dd161802779261443d98201d"



def test_request_identity_matches_agentscape_number_and_unicode_serialization() -> None:
    request = JobRequest(
        provider="modal-3d",
        operation=MODAL_3D_IMAGE_TO_3D,
        inputs={"10": "ten", "2": "two", "concept": "数值测试"},
        profile="recommended",
        options={"scale": 1.0, "tiny": 1e-7, "huge": 1.2e20, "scientific": 1e21},
        output_roles=("primary-glb",),
    )

    assert request.request_hash == "sha256:fffa303387f676ad25b78c76a9e50fd7116c1007c21b0fb6f9d79b956075444a"
    assert request.idempotency_key == "idem_fffa303387f676ad25b78c76a9e50fd7116c1007"

def test_request_identity_is_order_independent_for_objects_and_roles() -> None:
    reordered = JobRequest(
        provider="modal-3d",
        operation=MODAL_3D_IMAGE_TO_3D,
        inputs={
            "concept": "mossy shrine",
            "image": {
                "mime": "image/png",
                "hash": "sha256:" + "a" * 64,
                "artifactId": "artifact_01",
            },
        },
        profile="recommended",
        options={"seed": 42, "model": "fastsam3d"},
        output_roles=("primary-glb", "primary-glb"),
    )

    assert reordered.request_hash == BASE.request_hash
    assert reordered.idempotency_key == BASE.idempotency_key


def test_request_identity_changes_with_semantic_input() -> None:
    changed = JobRequest(
        provider="modal-3d",
        operation=MODAL_3D_IMAGE_TO_3D,
        inputs=BASE.inputs,
        profile="recommended",
        options={"model": "fastsam3d", "seed": 43},
        output_roles=("primary-glb",),
    )

    assert changed.request_hash != BASE.request_hash


@pytest.mark.parametrize("field", ["apiKey", "access_token", "signedUrl", "credential"])
def test_request_rejects_secret_like_fields(field: str) -> None:
    request = JobRequest(
        provider="modal-3d",
        operation=MODAL_3D_IMAGE_TO_3D,
        inputs={field: "must-not-cross"},
    )

    with pytest.raises(ContractError, match="敏感字段"):
        request.to_dict()


def test_request_rejects_non_json_values() -> None:
    request = JobRequest(
        provider="modal-3d",
        operation=MODAL_3D_IMAGE_TO_3D,
        inputs={"bad": object()},
    )

    with pytest.raises(ContractError, match="JSON 兼容"):
        request.to_dict()


def test_request_rejects_integer_outside_js_safe_range() -> None:
    request = JobRequest(
        provider="modal-3d",
        operation=MODAL_3D_IMAGE_TO_3D,
        inputs={"unsafe": 2**53},
    )

    with pytest.raises(ContractError, match="JS 安全范围"):
        request.to_dict()
