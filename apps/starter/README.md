# Your first interactive world

Use Node.js 22.12+, npm and a WebGL2 browser. From the repository root:

```sh
npm ci
npm run starter
```

Open the printed /starter/ URL. Pick up the cup, place it on the table, add/move a chair, download, reload and reopen. Each physical action reports verification separately from execution. No model key, Docker or generation provider is required. Installation requires network access; the five-minute first-use target still requires independent human measurement.

## Files and API

scene.json retains the small agentscape.starter-project input fixture for compatibility. main.js adapts that input to the formal agentscape.scene-project and uses AgentScape.open from sdk/typescript. There is one SceneFacade/Runtime, not another world store.

The four bundled assets are agent, cup, table and chair. Keep helper, mug and desk IDs for the existing buttons. Edit main.js if changing those controls. The viewport container needs an explicit width and height. Browser frames continue while interaction jobs run; headless hosts must call step and yield.

The legacy openStarterScene adapter remains for existing tests/clients. New code should use the SDK's observe/addModel/setTransform/interact/verify/apply/setStyle/save/close methods. See [SDK](../../sdk/typescript/README.md) and [v1 contracts](../../planning/public-contracts-v1.md).

## Saving

The UI downloads a complete agentscape.project-bundle JSON through SceneHandle.save. Import prepares a fresh session and keeps the current scene if validation fails. Required dynamic asset bytes and content hashes are included; built-in versions must match. Historical action evidence is not reused.

This minimal UI limits uploaded saves to 256 KiB and is intended for the bundled learning scene. The Scene bundle pipeline has separately documented larger resource limits. Studio exposes style selection; the SDK supports Recipe and self-contained Visual GLB inputs. The Starter does not provide a generic file-asset uploader or hosted share URL. YAML and arbitrary shader/code plugins are outside v1.

## Verify

```sh
npm run test:starter
npx playwright install chromium
npm run test:browser:starter
```

Tests execute real Rapier/Recast interactions and fresh-runtime restoration. Browser tests use the production build and preserve failure artifacts. See [release acceptance](../../docs/v2-release.md) for external gates.
