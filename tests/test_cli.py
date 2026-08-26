from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import typer
from typer.testing import CliRunner

from agentscape import cli
from agentscape.contracts import ArtifactSummary
from agentscape.settings import Settings

runner = CliRunner()


def test_settings_connector_url_falls_back_to_modal_agent(monkeypatch) -> None:
    monkeypatch.delenv("AGENTSCAPE_CONNECTOR_URL", raising=False)
    monkeypatch.setenv("AGENTSCAPE_MODAL_AGENT_URL", "http://127.0.0.1:45678/")
    monkeypatch.setenv("AGENTSCAPE_CONNECTOR_ORIGIN", "http://localhost:3100/")
    monkeypatch.setenv("AGENTSCAPE_CONNECTOR_PAIRING_TOKEN", "approval-secret")

    settings = Settings.from_env()

    assert settings.connector_url == "http://127.0.0.1:45678"
    assert settings.connector_origin == "http://localhost:3100"
    assert settings.connector_pairing_token == "approval-secret"


def test_connector_runtime_pairs_once_without_persisting_approval(monkeypatch) -> None:
    monkeypatch.setenv("AGENTSCAPE_CONNECTOR_URL", "http://127.0.0.1:39001")
    monkeypatch.setenv("AGENTSCAPE_CONNECTOR_ORIGIN", "http://localhost:3000")
    monkeypatch.setenv("AGENTSCAPE_CONNECTOR_PAIRING_TOKEN", "approval-secret")
    session = SimpleNamespace()
    captured: dict[str, str] = {}

    def pair(endpoint: str, approval: str, *, origin: str):
        captured.update(endpoint=endpoint, approval=approval, origin=origin)
        return session

    monkeypatch.setattr(cli.ConnectorSession, "pair", pair)
    capabilities, job_runner, artifacts = cli._connector()

    assert captured == {
        "endpoint": "http://127.0.0.1:39001",
        "approval": "approval-secret",
        "origin": "http://localhost:3000",
    }
    assert capabilities.session is session
    assert job_runner.capabilities is capabilities
    assert artifacts.session is session
    assert "approval-secret" not in repr((capabilities, job_runner, artifacts))


def test_connector_runtime_requires_pairing_approval(monkeypatch) -> None:
    monkeypatch.delenv("AGENTSCAPE_CONNECTOR_PAIRING_TOKEN", raising=False)
    with pytest.raises(typer.BadParameter, match="AGENTSCAPE_CONNECTOR_PAIRING_TOKEN"):
        cli._connector()


def test_probe_prints_safe_connector_capability_summary(monkeypatch) -> None:
    snapshot = SimpleNamespace(
        connector={"id": "unified-connector", "instance": "instance-test", "version": "0.1.0"},
        contract_version="1",
        revision="cap_test",
        hash="sha256:" + "a" * 64,
        providers=(
            {
                "id": "modal-2d",
                "health": "healthy",
                "status": "available",
                "capabilities": (
                    {"operation": "modal-2d.image.text_to_image.v1", "status": "available"},
                ),
            },
        ),
    )
    capabilities = SimpleNamespace(fetch_snapshot=lambda: snapshot)
    monkeypatch.setattr(cli, "_connector", lambda: (capabilities, object(), object()))

    result = runner.invoke(cli.app, ["probe"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["connector"]["id"] == "unified-connector"
    assert payload["providers"][0]["id"] == "modal-2d"
    assert "token" not in result.stdout.lower()
    assert "secret" not in result.stdout.lower()


def test_image_command_uses_connector_job_and_artifact_transport(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}
    job = SimpleNamespace(id="job_image")
    summary = ArtifactSummary(
        id="art_image",
        role="primary-image",
        mime="image/png",
        bytes=8,
        hash="sha256:" + "b" * 64,
    )

    class FakeRunner:
        def run(self, request):
            captured["request"] = request
            return job

    class FakeArtifacts:
        def select_job_artifact(self, value, *, role):
            assert value is job
            assert role == "primary-image"
            return summary

        def download(self, value, destination):
            assert value is summary
            captured["destination"] = destination
            return SimpleNamespace(
                to_dict=lambda: {
                    "id": summary.id,
                    "path": str(destination),
                    "mime": summary.mime,
                    "format": "png",
                    "bytes": summary.bytes,
                    "hash": summary.hash,
                }
            )

    monkeypatch.setattr(cli, "_connector", lambda: (object(), FakeRunner(), FakeArtifacts()))
    output = tmp_path / "reference.png"
    result = runner.invoke(cli.app, ["image", "mossy shrine", "--output", str(output)])

    assert result.exit_code == 0
    request = captured["request"]
    assert request.provider == "modal-2d"
    assert request.operation == "modal-2d.image.text_to_image.v1"
    assert captured["destination"] == output
    assert json.loads(result.stdout)["job_id"] == "job_image"


def test_local_reconstruct_is_explicit_direct_command() -> None:
    direct = runner.invoke(cli.app, ["reconstruct-direct", "--help"])
    legacy_name = runner.invoke(cli.app, ["reconstruct", "--help"])

    assert direct.exit_code == 0
    assert legacy_name.exit_code != 0


def test_connector_pairing_token_falls_back_to_agent_session(monkeypatch) -> None:
    monkeypatch.delenv("AGENTSCAPE_CONNECTOR_PAIRING_TOKEN", raising=False)
    monkeypatch.setenv("AGENTSCAPE_MODAL_AGENT_SESSION", "sidecar-session-token")

    settings = Settings.from_env()

    assert settings.connector_pairing_token == "sidecar-session-token"
