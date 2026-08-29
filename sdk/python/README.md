# AgentScape Python SDK

The Python SDK is a **Unified Connector client**. It does not expose Provider-private clients, credentials, or retired repository topology.

## Supported surface

```text
ConnectorSession
ConnectorCapabilityClient
ConnectorJobClient / ConnectorJobRunner
ConnectorArtifactTransport
ConnectorTextTo3DPipeline
Modal2DTextToImageRequestBuilder
Modal3DImageTo3DRequestBuilder
normalized Job / Artifact / capability contracts
```

`Modal2DTextToImageRequestBuilder` and `Modal3DImageTo3DRequestBuilder` describe normalized Connector requests. They are **not direct Provider clients**.

The following old APIs are intentionally removed:

```text
agentscape.providers.*
KaggleImageProvider
Modal2DProvider
Modal3DProvider
TextTo3DPipeline (direct provider composition)
reconstruct-direct CLI
AGENTSCAPE_KAGGLE_*
AGENTSCAPE_MODAL_2D_AGENT_*
Settings.modal_agent_url / modal_agent_session
```

The legacy `AGENTSCAPE_MODAL_AGENT_URL` and `AGENTSCAPE_MODAL_AGENT_SESSION` environment names are accepted only as temporary input aliases for Connector configuration; they are not exposed as SDK fields.

## Configuration

```bash
export AGENTSCAPE_CONNECTOR_URL=http://127.0.0.1:39000
export AGENTSCAPE_CONNECTOR_ORIGIN=http://localhost:3000
export AGENTSCAPE_CONNECTOR_PAIRING_TOKEN=...
```

On Windows, the SDK may discover a short-lived Connector handoff from Credential Manager when no explicit Connector URL is configured.

## CLI

```bash
agentscape probe
agentscape image "a red apple" --output reference.png
agentscape create "a red apple" --model <capability-model> --output-dir artifacts/latest
```

All generation work flows through one paired Connector session and normalized capability / Job / Artifact contracts.
