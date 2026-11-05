# AgentScape v2.1 代码资产开发与验收

本地默认 MCP 使用 QuickJS Worker，不要求 Docker。SDK 默认禁用源码执行，由调用方显式配置。源码执行、资产准入和世界中的交互验证分别报告。没有新增 WorldRuntime、ObjectStore 或 PhysicsSystem。

## 阶段一：执行后端

- `apps/mcp-server/CodeExecutor.js` 的 `createCodeExecutor()` 统一 `environment/run/execute/close` 契约。
- `worker-wasm` 复用 QuickJS 与 `AuthoringSandboxEntry.build()`；同时保留 authoring 文档编辑入口。
- `trusted-local` 必须 `authorized:true`，独立 Node Worker 执行 ESM/异步 `createAsset(THREE)`，输出受验证的 AuthoringDocument。
- `os-isolated` 复用 DockerBuildRunner，无不可用时降级；`disabled` 拒绝源码。
- Worker 时间和内存限制不是 OS 隔离。公共服务设置 `remote:true` 时仅接受 os-isolated/disabled。
- 验证：真实 Three 对象序列化、授权拒绝、取消无限循环、取消后继续构建、异步工厂。

## 阶段二：正式资产链路

- `SceneFacade.addModel()` 增加 `three-code` 分支，保留 Recipe、GLB、MechanicalDraft 分支。
- `prepareThreeCodeAsset()` 根据源码、定义、执行环境生成资产版本；`ProgrammaticAssetBuilder.build()` 复用 AuthoringAssetProducer 与 AssetModule 编译器。
- 无 definition 时编译纯视觉 GLB；有 definition 时严格验证碰撞体、节点名称、机械部件、关节与交互定义，并运行 ArticulationVerifier。
- 编译完成后通过 `AssetModule.installPreparedAssets()` 与原有 Scene 编辑注册对象；失败撤销新增清单与字节，不留下半注册资产。
- `addModel(input,{signal})` 支持取消，错误源码返回有界诊断。保存结果包含编译字节及物理定义，恢复不重新执行源码。
- 验证：视觉立方体、物理箱子、带楼梯和铰链门的房屋、错误源码保护已有世界、准入失败回滚、保存重开。

## 阶段三：MCP 与 Studio

- `startServer()` 和 HeadlessWorldHost 使用同一执行器工厂；默认 loopback 与必需 Bearer 鉴权保持不变。
- `asset_build_submit/status/publish` 保留 requestId 幂等、所有权、构建并发/存储配额、取消；纯视觉构建可省略 definition。
- `scene_add_model` 使用已发布 AssetRef。Studio 连接收到编译字节与定义，经同一个 SceneFacade 的编译资产入口重新验收再注册；没有平行世界写入机制。
- `execution`、`admission`、构建物理验证和 `scene_interact/scene_verify` 的实时证据分开。构建成功不代表交互已完成。
- 验证：真实 HTTP MCP 构建/发布房屋、场景添加、Agent 开关门、静态墙体参与导航网格、动态门排除静态网格、取消循环构建、服务重启恢复、所有权拒绝。

## 阶段四：npm SDK

- 保留一个 `@agentscape/sdk` 包；Node 条件入口、`/node`、`/mcp` 与 `agentscape mcp` CLI。
- 浏览器入口不引入 Node 执行器；浏览器 trusted-local 使用独立模块 Worker。浏览器暂不支持 worker-wasm/os-isolated，显式请求时拒绝。
- 包内包含 Node 运行所需资源和 Worker/QuickJS 构建依赖，安装后不读取仓库源码。
- `sdk:verify` 实际 npm pack、在临时空项目安装、运行代码资产构建、保存恢复、启动关闭 MCP；另一个新进程验证 Recipe 与 StylePack 恢复。
- 未执行正式 npm publish。示例：`examples/three-code/`，需要点击授权按钮才执行受信任源码。

## 支持边界与运行方法

支持可序列化的 Group、Mesh、Object3D、BufferGeometry 和 Basic/Standard/Physical 材质。当前 AuthoringDocument 不传输动画、运行时回调、材质数组或外部纹理引用。根对象须保持单位变换，实例摆放由 Scene API 控制。源码上限 32 KiB，序列化文档上限 2 MiB；这些限制保留现有资源准入边界。

Node 示例及 MCP 环境变量见 `sdk/typescript/README.md`。完整房屋源码与物理定义在 `apps/mcp-server/examples/code-house.js`。生产公网服务需显式配置 OS 隔离，不应将 loopback 服务直接当作公共不可信执行服务。

## Git 与验收记录

开始前检查并备份了已有未提交 diff；保留 Studio 联动、机械资产可靠性与未跟踪世界文件。过程中其他任务继续修改 Studio 自动连接功能，相关修改未清理或重置。各阶段仅提交本任务内容；重叠区域按具体功能增量修改。

最终在保留其他任务修改的当前工作区执行：

| 命令 | 结果 |
|---|---|
| `npm run check` | 通过：架构、资源、世界可用性、类型检查、343 个测试文件、1711 项测试及生产构建；2 项 Docker 测试跳过 |
| `npm run sdk:verify` | 通过：npm pack、干净项目安装、跨进程恢复、包内代码 Worker、MCP 入口 |
| `npm run test:mcp` | 通过：15 个文件、23 项测试；2 项 Docker 测试跳过 |
| `npm run test:browser` | 通过：21 项真实 Chromium 测试，含 Studio 房屋开关门、保存后由浏览器 SDK 恢复并再次开门 |

验收期间未发现 Docker Desktop 或 Docker 后端进程。Docker 专用测试未开启，不计为通过。在线付费模型/生成服务不属于本地执行链路验收。生产构建仍有既有大分块和依赖浏览器兼容性提示，未作为测试失败隐藏。

本地安装包：`.tmp-release/agentscape-sdk-2.0.0-dev.1.tgz`（继续保留现有开发版本号，未正式发布）。独立安装与打包元数据保存在 `.tmp-release/sdk-install.json` 和 `.tmp-release/sdk-pack.json`。最终命令日志为根目录 `.agentscape-v21-*-final.log`。

阶段提交：`fae69fc` 执行后端、`2a2f56a` 代码资产、`5fbe5ab` 本地 MCP、`26eafcc` SDK、`15c22c4` Studio 资产准入与保存；验收、示例和本文档随后独立提交。
