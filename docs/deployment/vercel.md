# AgentScape Vercel deployment

The Vercel project serves the current AgentScape Vite **static Studio and examples** plus a small, opt-in capability adapter API. It is not the long-running MCP, Rapier server or local agent gateway.

## Current public pages

| Page | URL |
| --- | --- |
| Studio | / |
| Home | /home/ |
| Starter | /starter/ |
| Observatory | /observatory/ |
| Multi-file Code Project | /examples/code-project/ |
| Native Three.js scene | /examples/native-scene/ |
| Three.js code assets | /examples/three-code/ |

Short aliases /studio, /code-project, /native-scene and /three-code redirect to those canonical pages. The Vite multi-page build emits all seven independently; Vercel serves dist with framework=vite. Other static assets stay on their original absolute /assets/ paths.

## Optional deployment capability APIs

The repository contains the following Vercel Functions:

- GET /api/capabilities: tells the browser which adapters are configured.
- GET /api/capabilities/health: checks backend reachability (returns unconfigured if unset).
- POST /api/capabilities/agent: forwards to a separately hosted agent adapter.
- POST /api/capabilities/asset-compile: forwards to a separately hosted asset compiler adapter.

These are the server-side environment variable names:

| Capability | Required to enable | Optional |
| --- | --- | --- |
| Agent | AGENT_ADAPTER_URL | AGENT_ADAPTER_AUTHORIZATION, AGENT_ADAPTER_HEALTH_URL |
| Asset compiler | ASSET_COMPILE_ADAPTER_URL | ASSET_COMPILE_ADAPTER_AUTHORIZATION, ASSET_COMPILE_ADAPTER_HEALTH_URL |

The URL must be a network-reachable HTTP(S) service from Vercel; localhost on a PC is **not** reachable from a Vercel Function. Configure values in Vercel Project Settings > Environment Variables, selecting the intended Production/Preview environment. Keep credentials server-side; never set any credential as VITE_* or commit values to the repository.

When no adapter is configured, the site still renders the full browser-side Studio, Starter, code project examples and local browser persistence. Server-dependent generation is explicitly unavailable rather than faked.

MCP studio pairing requires a persistent external MCP server and a localhost or otherwise explicitly authorized connection. The static Vercel site does not automatically attach to a PC's 127.0.0.1:39015, run arbitrary remote scripts, host a persistent MCP server, or provide persistent server-side asset storage.

## Build and deployment

From the repository root with Node 22+:

    npm ci
    npm run check

Vercel builds using npm run build and deploys dist. With Git integration enabled, pushing main triggers a production deployment; do not confuse a successful git push with a completed Vercel deployment.

GitHub Actions Production Smoke Check verifies the seven public pages, their JS assets, and both capability-status endpoints. It runs after a successful production deployment status event and can also be triggered manually. Optional adapters may legitimately be unconfigured. Confirm the latest deployment in Vercel project dashboard and check its source commit.

The local Vite development server also provides capability handlers through its dev plugin; production uses the repository's api/capabilities Vercel Functions. Never deploy the entire MCP process as a function.
