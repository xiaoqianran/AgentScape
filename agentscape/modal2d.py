from __future__ import annotations

import math
from dataclasses import dataclass

from .capabilities import MODAL_2D_PROVIDER, MODAL_2D_TEXT_TO_IMAGE
from .errors import ContractError
from .jobs import JobRequest

MODAL_2D_DEFAULT_MODEL = "sana-sprint-1.6b"
MODAL_2D_MODELS = ("sana-sprint-0.6b", "sana-sprint-1.6b")
MODAL_2D_PROFILE = "recommended"
MODAL_2D_PRIMARY_ROLE = "primary-image"
MODAL_2D_MAX_PROMPT_CHARS = 4000
MODAL_2D_MAX_SEED = 2**32 - 1


@dataclass(frozen=True, slots=True)
class Modal2DTextToImageRequestBuilder:
    """把已确认 prompt 翻译成 modal-2D 的稳定 Text→Image JobRequest。"""

    model: str = MODAL_2D_DEFAULT_MODEL
    seed: int = 42
    guidance: float = 4.5

    def __post_init__(self) -> None:
        if self.model not in MODAL_2D_MODELS:
            raise ContractError(f"不支持的 modal-2D model: {self.model}")
        if (
            not isinstance(self.seed, int)
            or isinstance(self.seed, bool)
            or not 0 <= self.seed <= MODAL_2D_MAX_SEED
        ):
            raise ContractError(f"modal-2D seed 必须在 [0, {MODAL_2D_MAX_SEED}]")
        if (
            not isinstance(self.guidance, (int, float))
            or isinstance(self.guidance, bool)
            or not math.isfinite(float(self.guidance))
            or not 0 <= float(self.guidance) <= 20
        ):
            raise ContractError("modal-2D guidance 必须是 [0, 20] 的有限数字")

    def __call__(self, prompt: str) -> JobRequest:
        value = str(prompt or "").strip()
        if not value:
            raise ContractError("modal-2D prompt 不能为空")
        if len(value) > MODAL_2D_MAX_PROMPT_CHARS:
            raise ContractError(f"modal-2D prompt 超过 {MODAL_2D_MAX_PROMPT_CHARS} 字符")
        return JobRequest(
            provider=MODAL_2D_PROVIDER,
            operation=MODAL_2D_TEXT_TO_IMAGE,
            inputs={
                "prompt": value,
                "model": self.model,
                "seed": self.seed,
                "guidance": float(self.guidance),
            },
            profile=MODAL_2D_PROFILE,
            output_roles=(MODAL_2D_PRIMARY_ROLE,),
        )
