from __future__ import annotations

import re
from dataclasses import dataclass

from .capabilities import MODAL_3D_IMAGE_TO_3D, MODAL_3D_PROVIDER
from .contracts import ArtifactSummary
from .errors import ContractError
from .job_client import JobState
from .jobs import JobRequest

MODAL_3D_PROFILE = "recommended"
MODAL_3D_SOURCE_ROLE = "primary-image"
MODAL_3D_SOURCE_MIME = "image/png"
MODAL_3D_OUTPUT_ROLE = "primary-glb"
MODAL_3D_MAX_SEED = 2**53 - 1
_MODEL_ID = re.compile(r"^[A-Za-z0-9_.-]{1,160}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class Modal3DImageTo3DRequestBuilder:
    """把 Connector image Artifact 翻译成 modal-3D 的稳定 Image→3D JobRequest。"""

    model: str
    seed: int = 42
    profile: str = MODAL_3D_PROFILE

    def __post_init__(self) -> None:
        if not _MODEL_ID.fullmatch(str(self.model or "").strip()):
            raise ContractError("modal-3D model ID 无效")
        if (
            not isinstance(self.seed, int)
            or isinstance(self.seed, bool)
            or abs(self.seed) > MODAL_3D_MAX_SEED
        ):
            raise ContractError(f"modal-3D seed 必须是 ±{MODAL_3D_MAX_SEED} 范围内的整数")
        if not str(self.profile or "").strip():
            raise ContractError("modal-3D profile 不能为空")

    def __call__(self, source: ArtifactSummary, parent: JobState, _prompt: str) -> JobRequest:
        if source.role != MODAL_3D_SOURCE_ROLE:
            raise ContractError(f"modal-3D source role 必须是 {MODAL_3D_SOURCE_ROLE}")
        if source.mime != MODAL_3D_SOURCE_MIME:
            raise ContractError(f"modal-3D source MIME 必须是 {MODAL_3D_SOURCE_MIME}")
        if not _SHA256.fullmatch(str(source.hash or "")):
            raise ContractError("modal-3D source 必须携带 canonical sha256 hash")
        if not str(source.id or "").strip():
            raise ContractError("modal-3D source Artifact ID 不能为空")
        if not str(parent.id or "").strip():
            raise ContractError("modal-3D parent Job ID 不能为空")

        return JobRequest(
            provider=MODAL_3D_PROVIDER,
            operation=MODAL_3D_IMAGE_TO_3D,
            inputs={
                "sourceArtifact": {
                    "id": source.id,
                    "role": source.role,
                    "mime": source.mime,
                    "hash": source.hash,
                },
                "model": self.model,
                "seed": self.seed,
            },
            parent={"jobId": parent.id},
            profile=self.profile,
            output_roles=(MODAL_3D_OUTPUT_ROLE,),
        )
