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

原生模式目前刻意拒绝 `scene.save()`、原生项目导入/导出及 `setStyle()`，分别报告 `NATIVE_PROJECT_SAVE_UNSUPPORTED`、`NATIVE_PROJECT_IMPORT_UNSUPPORTED` 和 `NATIVE_RENDERING_OWNED_BY_PROJECT`。不要把原项目伪装成内置 Scene Project；未来将以独立的注入层存档承载 AgentScape 修改，原有项目的材质、动画、资源和源码继续由宿主负责。

场景的可视显示、物理注册与 Agent 动作验收是不同条件：`scene.addModel()` 成功不保证导航或动作执行成功，应继续观察 `scene.observe()` 和 Job 验证证据。

## 4. 本仓库真实验收

```sh
npm ci
npx playwright test tests/browser/native-scene.spec.js
npx vitest run tests/integration/native-scene.test.js tests/integration/native-scene-plugin.test.js
npm run sdk:verify
```

浏览器测试使用真正的 MCP HTTP 服务、Playwright/Chromium 和物理 Runtime，验证 Shader、InstancedMesh、原生动画、对象注入、Agent 导航、卸载及旧会话失效。SDK 验收额外在干净 npm 消费项目中验证模块实例身份和生命周期。不需要 Docker 或模型供应商密钥。
