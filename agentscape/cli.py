from __future__ import annotations

import json
from pathlib import Path

import typer

from .connector_artifacts import ConnectorArtifactTransport
from .connector_capabilities import ConnectorCapabilityClient
from .connector_pipeline import ConnectorJobRunner, ConnectorTextTo3DPipeline
from .connector_session import ConnectorSession
from .modal2d import Modal2DTextToImageRequestBuilder
from .modal3d import Modal3DImageTo3DRequestBuilder
from .providers import Modal3DProvider
from .settings import Settings

app = typer.Typer(no_args_is_help=True, help="AgentScape Unified Connector client")


def _connector() -> tuple[ConnectorCapabilityClient, ConnectorJobRunner, ConnectorArtifactTransport]:
    settings = Settings.from_env()
    if not settings.connector_pairing_token.strip():
        raise typer.BadParameter("需要设置 AGENTSCAPE_CONNECTOR_PAIRING_TOKEN")
    session = ConnectorSession.pair(
        settings.connector_url,
        settings.connector_pairing_token,
        origin=settings.connector_origin,
    )
    capabilities = ConnectorCapabilityClient(session)
    return capabilities, ConnectorJobRunner(capabilities), ConnectorArtifactTransport(session)


@app.command()
def probe() -> None:
    """Pair with the Unified Connector and print its safe capability summary."""
    capabilities, _, _ = _connector()
    snapshot = capabilities.fetch_snapshot()
    result = {
        "connector": snapshot.connector,
        "contract_version": snapshot.contract_version,
        "revision": snapshot.revision,
        "hash": snapshot.hash,
        "providers": [
            {
                "id": provider["id"],
                "health": provider["health"],
                "status": provider["status"],
                "operations": [
                    {
                        "operation": capability["operation"],
                        "status": capability["status"],
                    }
                    for capability in provider["capabilities"]
                ],
            }
            for provider in snapshot.providers
        ],
    }
    typer.echo(json.dumps(result, ensure_ascii=False, indent=2))


@app.command()
def image(
    prompt: str,
    output: Path = typer.Option(Path("reference.png"), "--output", "-o"),
    model: str = typer.Option("sana-sprint-1.6b", "--model"),
    seed: int = typer.Option(42, "--seed"),
    guidance: float = typer.Option(4.5, "--guidance"),
) -> None:
    """Generate one lossless image through the Unified Connector."""
    _, runner, artifacts = _connector()
    request = Modal2DTextToImageRequestBuilder(model=model, seed=seed, guidance=guidance)(prompt)
    job = runner.run(request)
    summary = artifacts.select_job_artifact(job, role="primary-image")
    artifact = artifacts.download(summary, output)
    typer.echo(
        json.dumps(
            {
                "provider": request.provider,
                "job_id": job.id,
                "artifact": artifact.to_dict(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


@app.command("reconstruct-direct")
def reconstruct_direct(
    image_path: Path,
    concept: str = typer.Option(..., "--concept"),
    model: str = typer.Option(..., "--model"),
    output: Path = typer.Option(Path("model.glb"), "--output", "-o"),
    profile: str = typer.Option("recommended", "--profile"),
) -> None:
    """Legacy direct path for an arbitrary local image not owned by Connector lineage."""
    settings = Settings.from_env()
    provider = Modal3DProvider(settings.modal_agent_url, settings.modal_agent_session)
    result = provider.reconstruct(
        image_path,
        output,
        concept=concept,
        model=model,
        profile=profile,
    )
    typer.echo(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))


@app.command()
def create(
    prompt: str,
    model: str = typer.Option(..., "--model", help="modal-3D model id discovered from Connector capabilities"),
    output_dir: Path = typer.Option(Path("artifacts/latest"), "--output-dir", "-o"),
    image_model: str = typer.Option("sana-sprint-1.6b", "--image-model"),
    profile: str = typer.Option("recommended", "--profile"),
    image_seed: int = typer.Option(42, "--image-seed"),
    reconstruction_seed: int = typer.Option(42, "--reconstruction-seed"),
) -> None:
    """Run Text→Image→3D through one Unified Connector session."""
    _, runner, artifacts = _connector()
    manifest = ConnectorTextTo3DPipeline(
        runner,
        artifacts,
        Modal2DTextToImageRequestBuilder(model=image_model, seed=image_seed),
        Modal3DImageTo3DRequestBuilder(
            model=model,
            seed=reconstruction_seed,
            profile=profile,
        ),
    ).run(prompt, output_dir)
    typer.echo(json.dumps(manifest, ensure_ascii=False, indent=2))
