from __future__ import annotations

from pathlib import Path
from typing import Protocol

from ..contracts import ImageGenerationResult, ReconstructionResult


class ImageProvider(Protocol):
    name: str
    output_role: str
    output_suffix: str

    def generate(
        self,
        prompt: str,
        destination: Path,
        *,
        model: str,
        seed: int | None = None,
    ) -> ImageGenerationResult: ...


class ReconstructionProvider(Protocol):
    name: str
    operation: str

    def reconstruct(
        self,
        image_path: Path,
        destination: Path,
        *,
        concept: str,
        model: str,
        profile: str,
        seed: int,
    ) -> ReconstructionResult: ...
