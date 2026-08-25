from __future__ import annotations

from agentscape.capabilities import MODAL_3D_IMAGE_TO_3D, MODAL_3D_PROVIDER, modal_3d_provider_descriptor


def test_modal_3d_capability_uses_stable_agentscape_ids() -> None:
    descriptor = modal_3d_provider_descriptor(status="available", health="healthy")
    capability = descriptor["capabilities"][0]

    assert descriptor["id"] == MODAL_3D_PROVIDER == "modal-3d"
    assert descriptor["contractVersion"] == "1"
    assert descriptor["artifactTransport"] == "connector-artifact"
    assert capability["operation"] == MODAL_3D_IMAGE_TO_3D == "modal-3d.asset.image_to_3d.v1"
    assert capability["output"] == {
        "roles": ["primary-glb"],
        "required": ["primary-glb"],
    }
    assert capability["support"] == {"cancel": True, "resume": True, "idempotency": False}
    assert capability["prerequisites"] == {
        "authMode": "connector-session",
        "connection": True,
    }
