# Your first interactive world

The `/starter/` page is a small SDK/runtime tutorial, not the AgentScape Studio workspace. Run `npm run dev` from the repository root to open Studio at `/`.

Use Node.js 22.12+, npm and a WebGL2 browser. From the repository root:

```sh
npm ci
npm run starter
```

Open the printed `/starter/` URL. The starter world contains an agent, cup, table and chair. Its cup-to-table interaction is one executable example among several object types, not the definition of the world model. Use the asset selector to add more agents, cups, tables or chairs, then move the latest addition and save or restore the world. Every physical action reports verification separately from execution.

No model key, Docker or generation provider is required. Installation requires network access. The five-minute first-use target still requires independent human measurement.

## Files and API

`scene.json` defines the initial composition using the small `agentscape.starter-project` input fixture. `main.js` adapts it to the formal `agentscape.scene-project` and uses `AgentScape.open` from `sdk/typescript`. Studio and Starter share one SceneFacade/Runtime rather than maintaining a second world store.

The bundled assets are agent, cup, table and chair. The selector and `assetPlans` map in `main.js` provide the small extension point for adding another bundled asset. Keep `helper`, `mug` and `desk` IDs while the corresponding guided interaction buttons are enabled. The viewport container needs an explicit width and height. Browser frames continue while interaction jobs run. Headless hosts must call `step` and yield.

The legacy `openStarterScene` adapter remains for existing tests and clients. New code should use the SDK's `observe`, `addModel`, `setTransform`, `interact`, `verify`, `apply`, `setStyle`, `save` and `close` methods. See [SDK](../../sdk/typescript/README.md) and [v1 contracts](../../planning/public-contracts-v1.md).

## Saving and extending

The UI downloads a complete `agentscape.project-bundle` JSON through `SceneHandle.save`. Import prepares a fresh session and keeps the current scene if validation fails. Required dynamic asset bytes and content hashes are included. Built-in versions must match. Historical action evidence is not reused.

This minimal UI limits uploaded saves to 256 KiB and is intended for the bundled learning scene. The Scene bundle pipeline has separately documented larger resource limits. Studio exposes style selection. The SDK supports Recipe and self-contained Visual GLB inputs. Starter does not provide a generic file-asset uploader or hosted share URL. YAML and arbitrary shader/code plugins are outside v1.

The interaction runtime is asset-agnostic. Add a supported built-in asset through the selector and `assetPlans`, or use Studio/project packages for custom GLB assets and their declared capabilities. The cabinet, articulated GLB and detailed joint workflows remain focused acceptance fixtures, rather than the repeated Starter showcase. Their regression coverage remains available through `CabinetCupTask.js` and `npm run acceptance:world`.

Observatory also includes `interaction.place.seat`, which exercises placing an object on a chair surface. This demonstrates that placement can target different supported surfaces without defining a new interaction system.

## Verify

```sh
npm run test:starter
npx playwright install chromium
npm run test:browser:starter
```

Tests execute real Rapier/Recast interactions and fresh-runtime restoration. Browser tests use the production build and preserve failure artifacts. See [release acceptance](../../docs/v2-release.md) for external gates.
