# Your first interactive world

This is an experimental learning entry, using the same WorldRuntime, AssetModule, SkillRegistry and SceneSerializer as the main product. It does not start a generation service, internal AI agent or remote code executor.

## Start

From the repository root, on Node.js 22.12+:

```sh
npm ci
npm run starter
```

Open the printed `/starter/` URL. Pick up the cup, place it on the table, add/move a chair, then download the world. Reload and open the downloaded file to restore it. The default Vite port is 5173; if occupied, use the actual port printed in the terminal.

Drag to orbit and scroll to zoom. A WebGL2-capable browser is required. If initialization fails, the page reports it; check your browser GPU/WebGL settings and console. The first startup downloads npm dependencies, but running this example does not need a model key, Docker or provider account.

## Change real files

- `scene.json`: initial instances, their asset IDs and positions in metres, with Y up.
- `main.js`: click handlers, the render/simulation frame loop, file download and restore.
- `style.css`: the surrounding page, separate from world physics.

`scene.json` uses `agentscape.starter-project` v1, a deliberately restricted format distinct from the proposed general project format and the existing runtime snapshot. It is a local input with at most 32 objects. Unknown fields, duplicate IDs and unsupported assets are rejected before a runtime opens. Positions are bounded to this demo environment.

Add this object to the `objects` array:

```json
{ "id": "reading-chair", "asset": "chair", "position": [-4, 0, 3] }
```

Keep `helper`, `mug` and `desk` for the supplied buttons, or update their IDs in `main.js` as well. Supported assets are `agent`, `cup`, `table`, `chair`. They have existing physics definitions; this is not a generic GLB/Visual asset importer. Pick placements that do not overlap other objects.

## Experimental API

Import `openStarterScene` from `application/scene/StarterScene.js`. Pass the parsed project and an optional browser container. Without a container the same world runs headlessly.

| Method | Behavior |
| --- | --- |
| `observe()` | Copies object state, positions, physics-registration status and spatial relations |
| `add({ id, asset, position })` | Registers a new instance of a bundled asset through the existing spawn skill |
| `move({ id, position })` | Edits transform with physics synchronization; held objects are rejected |
| `interact({ action, actorId, … })` | `pickup`/`place` use targetId; `place` optionally uses surfaceId; `navigate` uses position |
| `save()` | Returns an existing SceneSerializer snapshot, not a file path |
| `load(snapshot)` | Restores a bounded snapshot using only this starter's registered assets |
| `frame(timestamp)` | Advances the simulation clock and renders; call from requestAnimationFrame |
| `step()` | Advances one fixed step for headless tests |
| `close()` | Releases runtime resources; repeated close is harmless |

Actions need simulation frames while their promises are pending. Do not stop the frame loop while waiting for `interact`. In headless code, advance `step()` and yield to the event loop; see `tests/integration/starter-scene.test.js`.

Only one mutating operation runs at a time. Concurrent edits, save/load or close return `SCENE_BUSY`. Methods after close reject `SCENE_CLOSED`. This is a local learning interface, not a multi-user service: it does not implement remote request IDs, authorization, revision conflicts, upload protocols or the full public API RFC.

Action results retain `state`, `verified` and the detailed runtime `result`. An object being added does not mean an interaction is verified. Pickup uses the existing kinematic hold mechanism, not a force-based grasp simulation. Place waits for settling and support evidence.

## Save and share locally

The download is a JSON runtime snapshot. The four asset definitions ship with this version of AgentScape, so no extra asset upload is needed. Give the JSON and the same repository revision to another developer; they can open it through this starter. This is local file sharing, not a hosted share URL or a portable arbitrary asset package.

Imported saves are limited to 256 KiB and 32 objects. External asset manifests, rule bundles and advanced world/environment configuration are rejected. Invalid input leaves the previous world intact. Restore creates physics bodies again and clears historical interaction evidence. Save while idle; don't edit object ownership fields manually.

## Verify

```sh
npm run test:starter
npx playwright install chromium
npm run test:browser:starter
```

The integration test executes real Rapier/Recast pickup/place and restores into a fresh Runtime. The browser test uses a production build, clicks the same controls, downloads, reloads and imports the save. It also captures a screenshot in `test-results/browser/`.

General project files, arbitrary GLB import, package uploads and styles remain separate follow-up work. See [the draft contracts](../../planning/public-contracts-v1.md).
