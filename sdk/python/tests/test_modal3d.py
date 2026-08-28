import pytest

from agentscape.contracts import ArtifactSummary
from agentscape.errors import ContractError
from agentscape.job_client import JobState
from agentscape.modal3d import Modal3DImageTo3DRequestBuilder


def parent_job() -> JobState:
    return JobState(
        id="job_image",
        provider="modal-2d",
        operation="modal-2d.image.text_to_image.v1",
        request_hash="sha256:" + "a" * 64,
        idempotency_key="idem_" + "a" * 40,
        status="succeeded",
        event_sequence=1,
        capability_hash="sha256:" + "b" * 64,
        capability_revision="caprev_01",
    )


def image_summary(**overrides) -> ArtifactSummary:
    values = {
        "id": "artifact_image",
        "role": "primary-image",
        "mime": "image/png",
        "bytes": 1234,
        "hash": "sha256:" + "c" * 64,
    }
    values.update(overrides)
    return ArtifactSummary(**values)


def test_modal3d_builder_matches_connector_contract() -> None:
    request = Modal3DImageTo3DRequestBuilder(
        model="fastsam3d-plus-plus",
        seed=7,
    )(image_summary(), parent_job(), "mossy shrine")

    assert request.provider == "modal-3d"
    assert request.operation == "modal-3d.asset.image_to_3d.v1"
    assert request.profile == "recommended"
    assert request.output_roles == ("primary-glb",)
    assert request.parent == {"jobId": "job_image"}
    assert request.inputs == {
        "sourceArtifact": {
            "id": "artifact_image",
            "role": "primary-image",
            "mime": "image/png",
            "hash": "sha256:" + "c" * 64,
        },
        "model": "fastsam3d-plus-plus",
        "seed": 7,
    }
    assert "prompt" not in request.inputs
    assert "bytes" not in request.inputs["sourceArtifact"]


@pytest.mark.parametrize(
    "source",
    [
        image_summary(role="legacy-lossy"),
        image_summary(mime="image/webp"),
        image_summary(hash=None),
        image_summary(hash="sha256:" + "C" * 64),
        image_summary(hash="c" * 64),
    ],
)
def test_modal3d_builder_rejects_invalid_source(source: ArtifactSummary) -> None:
    builder = Modal3DImageTo3DRequestBuilder(model="fastsam3d-plus-plus")
    with pytest.raises(ContractError):
        builder(source, parent_job(), "prompt")


@pytest.mark.parametrize(
    "kwargs",
    [
        {"model": ""},
        {"model": "bad/model"},
        {"seed": True},
        {"seed": 2**53},
        {"seed": -(2**53)},
        {"profile": ""},
    ],
)
def test_modal3d_builder_rejects_invalid_options(kwargs) -> None:
    values = {"model": "fastsam3d-plus-plus", **kwargs}
    with pytest.raises(ContractError):
        Modal3DImageTo3DRequestBuilder(**values)
