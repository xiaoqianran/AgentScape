# AgentScape npm 拆包与迁移

## Beta 2 发布状态

三个 1.0.0-beta.2 包已经完成官方 npm 首次发布审核。轻量 Core 可使用 npm install agentscape3d@beta three；完整引擎可使用 npm install agentscape3d-engine@beta three；Studio 可使用 npm install agentscape3d-studio@beta。Core 的 latest 仍指向旧综合版 1.0.0-beta.1，新版请显式选择 beta。

- [Core](https://www.npmjs.com/package/agentscape3d)
- [Engine](https://www.npmjs.com/package/agentscape3d-engine)
- [Studio](https://www.npmjs.com/package/agentscape3d-studio)

完整测试证据和已知浏览器回归限制见[Beta 2 发布说明](releases/1.0.0-beta.2.md)。

**目标：** AgentScape 默认是自由 Three.js 语义扩展；Studio、完整引擎及 MCP 仅由应用按需引入，Core 不承担任务编译、安全审批或 Agent 框架职责。

| npm 包 | 功能 | Core 安装时是否引入 |
| --- | --- | --- |
| **agentscape3d** | 纯语义、动作、状态读取及插件钩子 | 是 |
| **agentscape3d-engine** | 旧 WorldRuntime、资源、物理、Node、显式 MCP 入口 | 否 |
| **agentscape3d-studio** | 网站、Studio 和 Web CLI | 否 |

## 默认 Core API

~~~js
import { attach } from 'agentscape3d';

const world = attach(scene);
world.register(object, { id: 'anything', type: '自由语义', actions: { move: () => {} } });
await world.invoke('anything', 'move');
~~~

- 不接管 Renderer/Camera，不修改 Three.js 渲染循环。
- 不内置物体词表、动作白名单、审批、任务编译或沙箱。
- 运行权限由执行代码的宿主 JavaScript 环境决定；需要隔离时由外层按需实现。
- 需要监听或扩展时显式调用 world.use(plugin)，不自动开启插件。

## 旧 API 显式迁移

以前使用：

~~~js
import { AgentScape } from 'agentscape3d';
const world = await AgentScape.open();
~~~

现在改为：

~~~js
import { AgentScape } from 'agentscape3d-engine';
const world = await AgentScape.open();
~~~

其他入口对应：
- **agentscape3d/node** → **agentscape3d-engine/node**
- **agentscape3d/mcp** → **agentscape3d-engine/mcp**
- **npx agentscape3d starter** → **npx agentscape3d-engine starter**
- **npx agentscape3d web** → **npx agentscape3d-studio web**
- 旧版 AgentScape.attach({scene,camera,renderer}) 仍在 Engine；Core 只使用 attach(scene)。

## 开发构建

~~~bash
node dev/build-sdk.mjs --core
node dev/build-sdk.mjs --engine
node dev/build-sdk.mjs --studio
node dev/build-sdk.mjs
~~~

对应发布目录：sdk/typescript、sdk/engine、sdk/studio。本次发布目标为三个包的 1.0.0-beta.2，正式发布后应分别核对官方 npm Registry 的 beta 标签与安装测试。因默认入口发生破坏性变化，原 beta.1 用户需改为显式安装 agentscape3d-engine@beta。

**现阶段范围：** Core / Engine / Studio 已拆为物理包。MCP 仍作为 Engine 的显式子入口，日后可进一步独立发包。Pi/DSH、权限和任务验收属于可选应用层，不需要运行在 Core 中。
