from __future__ import annotations

from typing import Literal


MODAL_3D_PROVIDER = "modal-3d"
MODAL_3D_IMAGE_TO_3D = "modal-3d.asset.image_to_3d.v1"

ProviderStatus = Literal["available", "experimental", "disabled", "deprecated"]
ProviderHealth = Literal["healthy", "degraded", "unknown", "unavailable"]


def modal_3d_provider_descriptor(
    *,
    status: ProviderStatus = "disabled",
    health: ProviderHealth = "unknown",
) -> dict[str, object]:
    """返回 AgentScape ProviderRegistry 可直接规范化的公开能力描述。"""

    return {
        "id": MODAL_3D_PROVIDER,
        "displayName": "Modal 3D",
        "version": "1",
        "health": health,
        "status": status,
        "contractVersion": "1",
        "artifactTransport": "connector-artifact",
        "capabilities": [
            {
                "operation": MODAL_3D_IMAGE_TO_3D,
                "version": "1",
                "displayName": "Image to 3D",
                "category": "asset-generation",
                "status": status,
                "input": {"types": ["image", "rgba"]},
                "output": {
                    "roles": ["primary-glb"],
                    "required": ["primary-glb"],
                },
                "execution": {
                    "async": True,
                    "stages": ["queued", "running", "artifact"],
                    "durationClass": "long",
                    "costClass": "gpu",
                },
                "prerequisites": {
                    "authMode": "connector-session",
                    "connection": True,
                },
                "support": {
                    "cancel": True,
                    "resume": True,
                    "idempotency": False,
                },
                "artifactTransport": "connector-artifact",
            }
        ],
    }
