from __future__ import annotations

import json
from pathlib import Path

import typer

from .pipeline import TextTo3DPipeline
from .providers import KaggleImageProvider, Modal3DProvider
from .settings import Settings

app = typer.Typer(no_args_is_help=True, help="AgentScape provider orchestration client")


def _providers() -> tuple[KaggleImageProvider, Modal3DProvider]:
    settings = Settings.from_env()
    return (
        KaggleImageProvider(settings.kaggle_url, settings.kaggle_token),
        Modal3DProvider(settings.modal_agent_url, settings.modal_agent_session),
    )


@app.command()
def probe() -> None:
    """Probe configured provider endpoints without printing credentials."""
    kaggle, modal = _providers()
    result: dict[str, object] = {}
    for name, provider in (("kaggle", kaggle), ("modal3d", modal)):
        try:
            result[name] = {"ok": True, "response": provider.probe()}
        except Exception as exc:  # CLI diagnostic boundary
            result[name] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    typer.echo(json.dumps(result, ensure_ascii=False, indent=2))


@app.command()
def image(
    prompt: str,
    output: Path = typer.Option(Path("reference.webp"), "--output", "-o"),
    model: str = typer.Option("sana-sprint-1.6b", "--model"),
) -> None:
    kaggle, _ = _providers()
    result = kaggle.generate(prompt, output, model=model)
    typer.echo(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))


@app.command()
def reconstruct(
    image_path: Path,
    concept: str = typer.Option(..., "--concept"),
    model: str = typer.Option(..., "--model"),
    output: Path = typer.Option(Path("model.glb"), "--output", "-o"),
    profile: str = typer.Option("recommended", "--profile"),
) -> None:
    _, modal = _providers()
    result = modal.reconstruct(image_path, output, concept=concept, model=model, profile=profile)
    typer.echo(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))


@app.command()
def create(
    prompt: str,
    model: str = typer.Option(..., "--model", help="modal-3D model id discovered from /v1/models"),
    output_dir: Path = typer.Option(Path("artifacts/latest"), "--output-dir", "-o"),
    image_model: str = typer.Option("sana-sprint-1.6b", "--image-model"),
    profile: str = typer.Option("recommended", "--profile"),
) -> None:
    kaggle, modal = _providers()
    manifest = TextTo3DPipeline(kaggle, modal).run(
        prompt,
        output_dir,
        image_model=image_model,
        reconstruction_model=model,
        profile=profile,
    )
    typer.echo(json.dumps(manifest, ensure_ascii=False, indent=2))
