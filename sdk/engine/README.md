# AgentScape Engine (optional)

Install with npm install agentscape3d-engine@beta three.

**agentscape3d-engine** contains the existing full WorldRuntime, physics engine, asset processing, Node integration, and explicit MCP server entry. None of these components is required by agentscape3d Core.

~~~js
import { AgentScape } from 'agentscape3d-engine';
const world = await AgentScape.open();
await world.addModel({ id: 'cup', asset: 'builtin://cup' });
world.close();
~~~

Supported entrypoints: agentscape3d-engine (browser and Node), agentscape3d-engine/node (Node helpers), agentscape3d-engine/mcp (MCP server, opt in).

CLI: npx agentscape3d-engine starter my-world; npx agentscape3d-engine mcp. The web CLI forwards to the optional agentscape3d-studio package if installed.

The old AgentScape.attach({scene,camera,renderer}) and AgentScape.openProject() APIs remain in this package, including legacy execution policies for explicitly selected applications. The Core attach(scene) API is separate and imposes none of those policies.

The full engine bundle is deliberately larger. It reuses implementation sources from the monorepo without duplicating a second WorldRuntime. See docs/sdk-packages.md.
