import pytest

from agentscape.capabilities import MODAL_2D_PROVIDER, MODAL_2D_TEXT_TO_IMAGE
from agentscape.errors import ContractError
from agentscape.modal2d import Modal2DTextToImageRequestBuilder


def test_modal2d_builder_matches_live_public_contract() -> None:
    request = Modal2DTextToImageRequestBuilder(
        model="sana-sprint-0.6b",
        seed=7,
        guidance=4.5,
    )("  mossy shrine  ")

    assert request.provider == MODAL_2D_PROVIDER
    assert request.operation == MODAL_2D_TEXT_TO_IMAGE
    assert request.profile == "recommended"
    assert request.output_roles == ("primary-image",)
    assert request.inputs == {
        "prompt": "mossy shrine",
        "model": "sana-sprint-0.6b",
        "seed": 7,
        "guidance": 4.5,
    }
    assert "steps" not in request.inputs
    assert "width" not in request.inputs
    assert "height" not in request.inputs


@pytest.mark.parametrize(
    "kwargs",
    [
        {"model": "unknown"},
        {"seed": -1},
        {"seed": True},
        {"seed": 2**32},
        {"guidance": -0.1},
        {"guidance": 20.1},
        {"guidance": float("nan")},
    ],
)
def test_modal2d_builder_rejects_invalid_options(kwargs) -> None:
    with pytest.raises(ContractError):
        Modal2DTextToImageRequestBuilder(**kwargs)


def test_modal2d_builder_rejects_invalid_prompt() -> None:
    builder = Modal2DTextToImageRequestBuilder()
    with pytest.raises(ContractError, match="不能为空"):
        builder("   ")
    with pytest.raises(ContractError, match="4000"):
        builder("x" * 4001)
