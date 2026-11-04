# AgentScape

**Build interactive 3D worlds that people and AI agents can operate.**

Three.js rendering, Rapier physics and Recast navigation share one world state. Characters can walk to objects, pick them up and place them on surfaces. The runtime reports what actually happened, separately from what was requested.

[简体中文](README.zh-CN.md) · [First world](apps/starter/README.md) · [MCP for AI agents](apps/mcp-server/README.md) · [Contribute](CONTRIBUTING.md)

![Starter after a verified pickup/place and a fresh-page restore](docs/evidence/starter-first-world.png)

## Run your first world

Use Node.js 22.12+ (Node 22 is used in CI), npm and a browser with WebGL2 support.

```sh
git clone https://github.com/xiaoqianran/AgentScape.git
cd AgentScape
npm ci
npm run starter
```

Open the `/starter/` URL printed by Vite, normally `http://127.0.0.1:5173/starter/`.

1. Click **Pick up the cup**, then **Place on the table**. Wait for each verified result.
2. Add a chair and move it.
3. Download the world, reload the page, and open the saved JSON file.

The starter uses bundled assets: **no model API key, generation service or Docker required**. Package installation needs internet access. This is a local demo; a hosted Playground is not published by this change.

## Make it yours

Edit [`apps/starter/scene.json`](apps/starter/scene.json) and reload. Your scene is a real, version-controlled file. The starter currently accepts `agent`, `cup`, `table` and `chair` assets.

```json
{ "id": "reading-chair", "asset": "chair", "position": [-4, 0, 3] }
```

The browser example uses a small **experimental** application API:

```js
import { openStarterScene } from './application/scene/StarterScene.js';

const scene = await openStarterScene({ project, container });
await scene.add({ id: 'seat', asset: 'chair', position: [-4, 0, 3] });
const result = await scene.interact({
  action: 'pickup', actorId: 'helper', targetId: 'mug'
});
const snapshot = scene.save();
```

The host must advance simulation frames while actions run. See the complete [`main.js`](apps/starter/main.js), including scheduling, downloads and restore. This API is in-repository and experimental, not a published npm SDK or the complete Scene API v1.

## Choose an entry point

| You want to… | Start here |
| --- | --- |
| Learn with a small physical scene | `/starter/` and the [starter guide](apps/starter/README.md) |
| Use the editor | `/` with `npm run dev` |
| Connect an external AI agent | [MCP setup](apps/mcp-server/README.md) |
| Build procedural assets in isolation | [Programmatic assets](apps/mcp-server/PROGRAMMATIC-ASSETS.md) |
| Diagnose physics/navigation | `/observatory/` |
| Understand engine boundaries | [Architecture](docs/architecture.md) and [repository layout](docs/repository-layout.md) |

The existing MCP supports isolated worlds, actions, verification, procedural asset builds and trusted save/restore. Remote code builds require a configured Docker sandbox; they do not silently fall back to the server process. MCP sessions do not currently control the Studio's open world.

## Supported today, planned next

- **Implemented:** browser rendering, real rigid bodies, character navigation, pickup/place and articulated interactions, scene serialization, isolated MCP worlds and versioned procedural asset persistence.
- **Starter scope:** four built-in physical assets, JSON project input, add/move, navigate/pickup/place and local snapshot download/restore.
- **Not yet in the starter:** arbitrary GLB upload, Visual-only imports, YAML projects, asset package upload, StylePacks, source-code builds or URL-based sharing.
- **Design proposal:** [Scene API + Asset Package + StylePack](planning/public-contracts-v1.md). These contracts are not released features.

A requested action, a loaded asset and a verified physical outcome are different facts. The starter displays a verified message only when the existing runtime reports verification. Restoring a snapshot does not reuse old interaction evidence.

## Develop and contribute

Examples, documentation, reproduction projects and accessibility improvements are useful contributions alongside engine code. Start with [CONTRIBUTING.md](CONTRIBUTING.md); discuss public API changes before expanding the core.

```sh
npm run test:starter       # Real physics and fresh-runtime restore
npm run test:browser:starter # Production build + browser interaction/download/restore
npm run check              # Architecture, assets, viability, types, tests and build
```

Browser tests require `npx playwright install chromium` first. See the contribution guide for platform setup and optional Docker tests. The existing Python SDK targets generation connectors, not a general world-control API.

## License

[MIT](LICENSE). Third-party dependencies and content have their own terms; see [THIRD_PARTY.md](THIRD_PARTY.md). Include provenance and license information when contributing assets or textures.
