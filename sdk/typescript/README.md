# AgentScape TypeScript SDK

Beta package for the AgentScape 3D world engine. After publication, install with `npm install agentscape3d`. This first public prerelease is intentionally tagged `latest` so the unqualified installation command works; its `2.0.0-beta.1` version still signals pre-release stability. Before publication, build with `node dev/build-sdk.mjs`, then use the resulting `npm pack` tarball.

```js
import { AgentScape } from 'agentscape3d';
const world = await AgentScape.open({ canvas: '#app' });
await world.addModel({ id: 'cup', asset: 'builtin://cup', position: [0, 0, 2] });
const saved = await world.save();
const reopened = await AgentScape.open({ bundle: saved.value });
reopened.close();
world.close();
```

`#app` is an HTML container with an explicit width and height. Rendering schedules automatically when a container is supplied. Headless hosts advance `step()` themselves. Interactions return jobs; query or await them with `getJob` / `waitJob`, and inspect their verification evidence separately.

## Embedding in an existing Three.js scene

Use `AgentScape.attach({scene,camera,renderer,walkableMesh,hostProjectId,hostRevision})` to mount a self-owned Runtime subtree without taking over the host renderer or loop. Call `session.scene.frame(timestamp)` in the host frame callback and `session.close()` to detach. Save only the AgentScape overlay with `session.scene.saveOverlay(storage)`; prepare and commit it with `prepareOverlay(storage,root)`. Use `WorldStorage` with `WorldDirectory` for durable content-addressed blocks. The host project remains responsible for its own source and rendering state. See [the native integration guide](../../docs/native-threejs-integration.md).

The SDK defaults to `monument-hall`; other built-in IDs are resolved through the shared Studio catalog. Some environments require a browser DOM and reject headless Node. Studio preset furniture is not implicitly inserted into Scene Projects. Bundled assets include agent, cup, table and chair. Use await world.setStyle(ref) with builtin://realistic, builtin://toon or builtin://low-poly. Headless hosts validate and defer rendering. This SDK shares the application Scene service and does not maintain another object store.

`npx agentscape3d starter new-directory` (or `agentscape starter new-directory`) scaffolds an empty destination. Install this SDK tarball and Vite in that directory, then `npm run dev`. No provider key or paid service is needed for built-in worlds. Python Connector SDK usage is unchanged.

Code assets require an explicit execution configuration. Node selects the Node entry automatically; `agentscape3d/node` is also available. Docker is not an installation prerequisite.

```js
const world = await AgentScape.open({codeExecution:{mode:'worker-wasm'}});
await world.addModel({id:'cube',asset:{kind:'three-code',source:`
  export function createAsset(THREE) {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),
      new THREE.MeshStandardMaterial({color:'#ee8844'})));
    return root;
  }
`}});
const bundle = (await world.save()).value;
world.close();
```

Node `worker-wasm` runs synchronous source in QuickJS without host filesystem/network bindings. `trusted-local` requires `{mode:'trusted-local',authorized:true}` and runs ESM factories (including async factories) in a dedicated Worker. It has the host's privileges. Browser code execution currently supports this explicitly authorized trusted Worker mode; browser `worker-wasm` and `os-isolated` are rejected. Worker time/memory controls are reliability protection, not OS security isolation. `disabled` rejects code. Public services must use `os-isolated` (configured Docker backend) or `disabled`; no fallback occurs.

An optional `definition` provides the existing programmatic Manifest contract (`id`, `type`, `label`, `actions`, `physics`, named `parts`, joints and interaction targets). Omit it for visual-only assets. Physical assets undergo compiler admission and runtime registration/actuation verification before insertion. Serializable Mesh/Group/Object3D, buffer geometry and Basic/Standard/Physical materials are supported; runtime callbacks, animations, material arrays and external texture references are not transported. Root transforms must be identity; place assets through `position`/`transform`.

Use `addModel(input,{signal})` to cancel. Saved bundles embed versioned compiled assets and their physical definitions and restore without executing source. Build execution, admission and live interaction verification are separate results.

`agentscape3d mcp` (or `agentscape mcp`) starts the local authenticated loopback MCP server. Set `AGENTSCAPE_MCP_TOKENS` to a JSON array such as `[{"identity":"local","token":"a-random-secret-at-least-32-characters"}]` using a freshly generated secret. The default backend is `worker-wasm`. Trusted execution additionally requires `AGENTSCAPE_CODE_EXECUTION=trusted-local` and `AGENTSCAPE_TRUSTED_CODE=1`. Public deployments set `AGENTSCAPE_PUBLIC_SERVICE=1` and configure `os-isolated`; the server rejects unsafe modes. The programmatic entry is `import {startServer} from 'agentscape3d/mcp'`.

## npm 发布门槛（维护者）

当前准备发布 `2.0.0-beta.1`，发布前不得假定 npm 已上线。正式发布前必须在项目根目录通过 `npm run check`、`npm run test:browser` 和 `npm run sdk:verify`，并确认 `git status` 干净、发布版本号未被占用、许可证及依赖清单完整。浏览器测试必须覆盖自动 Studio MCP 连接、手动配对、复杂物理资产创建和跨进程保存/恢复。

发布目标固定为官方 npm Registry (`https://registry.npmjs.org/`) 的公开 npm 包，避免将镜像缓存结果当作发布状态。维护者需拥有 `agentscape3d` 的发布权限，通过 `npm whoami --registry=https://registry.npmjs.org/` 检查认证，再从 `sdk/typescript` 目录使用 `npm pack --dry-run` 审阅归档。`npm publish --tag latest --access public --registry=https://registry.npmjs.org/` 仅在版本确定、全部验收通过且获得发布授权后执行；不要在自动测试中发布。初次发布后验证 `npm view agentscape3d dist-tags --json --registry=https://registry.npmjs.org/`，确认 `latest` 指向 `2.0.0-beta.1`，再在全新项目验证不带标签的安装方式。
