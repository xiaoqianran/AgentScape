# 在现有 Three.js 项目中使用 AgentScape（实验性）

本集成复用项目既有 `SceneFacade`、`WorldRuntime`、物理和交互系统。AgentScape 只向宿主 `THREE.Scene` 挂载自己负责的子树；不接管原项目的 renderer、Shader、Composer、动画循环、其他 Mesh 或原始源码。

## 1. 显式接入（推荐）

在已经安装 `agentscape3d` 的可信 Three.js 项目中：

```js
import { AgentScape } from 'agentscape3d';

// scene / camera / renderer / floor 由原项目创建和管理。
const session = await AgentScape.attach({
  scene,
  camera,
  renderer,
  autoStart: false, // 宿主已有动画循环时，由宿主驱动 Runtime
  walkableMesh: floor, // 从静态地面 Mesh 创建碰撞体与导航来源
});
await session.scene.addModel({ id: 'cup_01', asset: 'builtin://cup', position: [0, 2, 0] });

// 原项目已有的 requestAnimationFrame 回调中：
// session.scene.frame(timestamp);
// renderer.render(scene, camera); // 或原本的 composer.render()

// 原项目仍在运行时，可以安全移除 AgentScape 的整个注入层：
// session.close();
```

- `autoStart: false` 时必须在宿主帧循环中持续调用 `session.scene.frame(timestamp)`，否则物理模拟/Agent Job 不会自行推进。默认 `autoStart: true` 使用独立的 requestAnimationFrame；两种方式只选择一种，不要重复驱动同一 Runtime。
- `colliders` 描述参与 AgentScape 物理引擎的宿主环境。原生可见 Mesh 不会被自动扫描。`walkableMesh` 显式指定静态地面，提取世界坐标碰撞三角网格并作为导航来源；`staticMeshes` 用于其他明确选定的静态障碍物。
- 仅支持可信、保持静止的普通 Mesh；拒绝 SkinnedMesh、InstancedMesh、Morph Mesh、动态标记或过大几何。最多 32 个 Mesh、100,000 个三角面、200,000 个顶点。仍可使用 `navigationRoot` 指定导航根，导航是否成功以 Runtime 真实作业验证为准。
- 必须复用同一份 `three` 构造器。`NATIVE_THREE_INSTANCE_MISMATCH` 说明项目存在不兼容或重复实例；先检查打包器去重，不能靠转换原生对象绕过。
- 仅在可信项目中注入；不要把浏览器内执行任意外来代码当成不可信代码沙箱。

## 2. 完全不改原项目源文件的可选发现路径

`examples/native-scene/project/main.js` 是没有 AgentScape 引用的独立原生项目。Vite 启动阶段配置 `nativeScenePlugin({projectRoots:[...]})`，仅对选定目录下的 `import ... from 'three'` 提供模块 shim，以观察 `WebGLRenderer` 渲染过的 Scene。随后由独立启动文件调用 `listNativeScenes()`、`attachNativeScene()`。

- 这种 shim **不是**对任意项目、任意模块路径或 WebGPU 渲染器的通用拦截。应只对可信、明确配置的项目目录启用。
- 如果愿意在应用入口显式调用 `AgentScape.attach()`，不需要自动发现 shim。
- 本地 MCP 的 HTTP Bridge 是独立服务，浏览器使用本机受限 origin 与自动会话连接；远程部署不得默认开放自动注册。

## 3. 持久化与能力边界

原生模式仍拒绝 `scene.save()`、完整原生项目导入/导出及 `setStyle()`，这些能力会错误地把宿主项目伪装成 AgentScape 项目。现在提供独立的 AgentScape 注入层 Overlay 持久化：

```js
import { AgentScape, WorldStorage, WorldDirectory } from 'agentscape3d';

const session = await AgentScape.attach({
  scene, camera, renderer,
  hostProjectId: 'com.example.my-three-game',
  hostRevision: 'world-layout-v3', // 地面/障碍/导航布局改变时更新
  walkableMesh: floor,
});
const directory = await window.showDirectoryPicker();
const storage = new WorldStorage(new WorldDirectory(directory));

// 保存只包含 AgentScape 管理的实体、状态与资产。
const root = await session.scene.saveOverlay(storage);
// 宿主应用必须把 root 引用保存到自己的项目配置/数据库中。

// 新进程或新挂载后，使用相同 hostProjectId / hostRevision：
const prepared = await session.scene.prepareOverlay(storage, root);
// 先校验和准备所有依赖；原世界此时尚未改变。
await prepared.commit();
// 或直接调用 await session.scene.restoreOverlay(storage, root)。

// 需要搬运时，使用既有 ASWORLD 分块归档协议：
await session.scene.exportOverlay(storage, root, writer);
const importedRoot = await session.scene.importOverlay(storage, source);
```

- 持久化需要显式提供稳定的 `hostProjectId`；可选但建议提供 `hostRevision`，它必须在宿主几何、碰撞或导航布局变化时更新。身份或版本不匹配时拒绝恢复。
- Overlay 复用 `WorldStorage` 的内容寻址块、哈希校验和流式归档。保存返回的 root 引用必须由宿主另行持久化；内容块不会替宿主保存项目文件或配置。
- 仅保存 AgentScape 的实体、资产、实体状态和必要运行配置；不保存宿主源码、Mesh、材质、Shader、动画、相机、渲染器或宿主环境状态。
- `prepareOverlay()` 在独立资源与 Runtime 状态中完成检查；只有 `commit()` 才替换当前 AgentScape 注入层。提交失败由现有 `WorldRuntime.installWorld()` 回滚。准备对象不用时调用 `dispose()`。
- Overlay 是宿主项目的附属数据，不是完整 Three.js 项目备份。宿主仍负责保存自己的源码、模型、相机、灯光和渲染配置。

### 可靠存档指针与自动恢复（PR-05）

`saveOverlay(storage)` 仍提供底层显式 API。推荐使用 `openNativeOverlayCheckpoint` 将存档的完整流程包起来：

```js
import {
  AgentScape, WorldStorage, WorldDirectory,
  IndexedDBNativeOverlayHeadStore, openNativeOverlayCheckpoint,
} from 'agentscape3d';

const session = await AgentScape.attach({
  scene, camera, renderer,
  hostProjectId: 'com.example.my-three-game',
  hostRevision: 'world-layout-v3',
  walkableMesh: floor,
});
const storage = new WorldStorage(
  new WorldDirectory(await navigator.storage.getDirectory())
);
const heads = new IndexedDBNativeOverlayHeadStore({
  key: 'com.example.my-three-game:world-layout-v3'
});
const checkpoint = await openNativeOverlayCheckpoint(session.scene, storage, heads);
// 默认读取并恢复最新存档；没有存档时不改变世界。
await checkpoint.saveLatest(); // 写内容块、验证依赖、最后原子发布 head
```

- 内容块存于浏览器 OPFS，最新 root 引用存于 IndexedDB 的读写事务中。浏览器重新加载时重建 `storage`、`heads`，再调用 `openNativeOverlayCheckpoint()` 即可恢复；无需全量 JSON 和重新导入宿主 Three.js 项目。
- `saveLatest()` 先读取预期 root，再生成新内容块，在隔离环境中完整准备并验证，最后以 compare-and-swap 发布；未准备成功或其他标签页抢先更新 root 时，旧的最后有效存档保持不变。
- `restoreLatest()` 如果 root 的内容块损坏、身份/版本不匹配或提交失败，会抛出明确异常，而不是覆盖当前场景；宿主决定告警、重试或回退。提交失败的 Runtime 回滚使用 PR-04 既有机制。
- 只针对通过 `hostProjectId` 标识的可信原生场景，不替宿主保存其源代码、物理网格或动画。不同浏览器、浏览器配置文件和清空站点存储后的 OPFS/IndexedDB 彼此隔离；若需要跨设备备份，可使用 `exportOverlay` 导出分块归档并由宿主保存。
- 无法使用 IndexedDB 或 OPFS 的非浏览器环境，可注入自定义 `WorldStorage` 块后端和实现 `read()/publish(expected,next)` 的持久 root 后端。`MemoryNativeOverlayHeadStore` 只适合测试，不可当作跨进程持久存储。指针后端的 `publish` 必须具备原子 CAS 语义。

场景的可视显示、物理注册与 Agent 动作验收是不同条件：`scene.addModel()` 成功不保证导航或动作执行成功，应继续观察 `scene.observe()` 和 Job 验证证据。

## 4. 本仓库真实验收

```sh
npm ci
npx playwright test tests/browser/native-scene.spec.js
npx vitest run tests/integration/native-scene.test.js tests/integration/native-scene-plugin.test.js tests/integration/native-scene-overlay.test.js tests/integration/native-overlay-checkpoint.test.js
npm run sdk:verify
```

浏览器测试使用真正的 MCP HTTP 服务、Playwright/Chromium 和物理 Runtime，验证 Shader、InstancedMesh、原生动画、对象注入、Agent 导航、卸载及旧会话失效。SDK 验收额外在干净 npm 消费项目中验证模块实例身份和生命周期。不需要 Docker 或模型供应商密钥。
