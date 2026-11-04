# MCP 程序化创作 v0.2

v0.3 更新：这些接口继续保留，但远程执行现已要求 Docker OS 隔离；新增完整程序化资产文件持久化与可信世界恢复接口。下面的 Worker/WASM 描述是 v0.2 的执行基线，最新隔离及保存契约以 [PROGRAMMATIC-ASSETS.md](./PROGRAMMATIC-ASSETS.md) 为准。

AI 可以通过现有 `agentscape-world` 连接提交 Three.js，生成草稿、编译资产并晋升为当前私有世界中的实体。Studio 与 MCP 共用创作文档、资产编译器、晋升控制器和 WorldRuntime；无头创作不需要打开浏览器。

## 接口

所有接口要求 `worldSessionId`；写接口还要求 UUID `requestId`。相同请求重试复用原 ID，不同参数不能使用同一个 ID。

| 工具 | 其他参数 | 结果 |
|---|---|---|
| authoring_execute | code、label（可选）、requestId | 执行、提交草稿版本；失败保持上一个草稿 |
| authoring_observe | 无 | 节点 ID、资产/实体 ID、准入和验证状态 |
| authoring_prepare | nodeId、usage、requestId | 编译为本地资产；不放入世界 |
| authoring_promote | nodeId、usage、allowProvisional=false、requestId | 经放置和物理预检晋升 |
| authoring_update | 与 promote 相同 | 显式更新已晋升实体；失败回滚 |
| authoring_verify | nodeId | 检查物理及导航；未实际执行的交互保持未验证 |
| authoring_export | 无 | 原始成功代码、可编辑文档、晋升关联，原子保存到私有会话目录 |

`usage` 首版支持 `static`、`movable`。原来的九个工具继续可用，总计十六个。`action_execute.spawnAsset` 可以实例化本会话已注册的资产，不接受外部 URL 或其他会话资产。

## 实际工作流

先创建 `monument-hall` 会话，向 `authoring_execute.code` 提交：

```js
const box = new THREE.Mesh(
  new THREE.BoxGeometry(0.3, 0.3, 0.3),
  new THREE.MeshStandardMaterial({ color: 0xff8844 })
);
box.name = 'AI Box';
box.userData.authoringId = 'ai-box';
box.position.set(0, 0.2, 5);
scene.add(box);
```

随后执行 `authoring_observe`、`authoring_prepare(nodeId="ai-box",usage="movable")`。默认编译得到粗碰撞代理，准入可能为 `provisional`；默认晋升会拒绝。只有显式选择 `allowProvisional=true` 才允许插入编辑态实体，不会伪称正式准入通过。

读取晋升结果中的 `entityId`，通过 `action_execute` 执行 `approachAndPickup(actorId="agent_01",targetId=entityId)`，再执行 `approachAndPlace(actorId="agent_01",supportId="table_01",surfaceId="top")`。盒状、圆柱、胶囊碰撞体均走真实碰撞检测与搬运路径。

`world_verify` 新增可选 `criteria`，例如：

```json
[
  {"id":"exists","kind":"object-exists","targetId":"<entityId>"},
  {"id":"picked","kind":"interaction-verified","targetId":"<entityId>","capability":"PICKUP"},
  {"id":"on-table","kind":"relation-exists","subject":"<entityId>","predicate":"ON","object":"table_01","surfaceId":"top"}
]
```

criteria 省略时保留原开柜取杯和最终空手验收；显式空数组会被拒绝。自定义验收只证明请求中的检查，不自动要求空手，也不提升资产准入。草稿应用的 `accepted`、资产 `provisional` 和真实动作 `verified` 是不同证据。

## 执行与支持范围

远程代码在 Worker 中的 QuickJS WebAssembly JavaScript 引擎执行。没有把 Node 函数、模块加载器、环境变量、网络或文件接口注入引擎。Worker 提供额外的墙钟超时和终止能力，普通 Node 子进程或正则检查不是隔离保证。

- 使用本项目固定的 Three.js；代码可使用 `THREE`、`scene`、`clear`。
- 同步构建 Mesh、Group、Object3D；支持 Basic、Standard、Physical 材质及 RGBA Uint8 DataTexture。
- 支持原有草稿继续修改。成功代码经版本提交；失败、超时、内存超限不替换旧草稿。重试不会重复执行或重复记录源码。
- 明确拒绝外部资源、ModelRef、异步执行、定时器、onFrame、渲染回调、ShaderMaterial、相机、灯光、蒙皮、InstancedMesh 和动画；不宣称任意 Three.js 无损执行。
- 代码最多32768字符；默认执行时间1500ms、QuickJS分配预算96MiB、Worker墙钟上限12秒。预算不是整个服务的操作系统级硬内存隔离。
- 文档最多2Mi字符、128节点、16层；几何先物化为 BufferGeometry，再检查最多20000顶点/120000索引；拒绝原始几何参数，防止小文档引发无界分配。
- DataTexture 每边最多256像素，跨运行时只传递数据。Node 使用有像素预算的嵌入图片解码器加载编译纹理，不调用 DOM 或外部图片 URL。
- 每世界累计成功源码最多262144字符，注册资产预算32个，实体及动作仍受原会话预算控制。

## 保存边界

`authoring_export` 是源码与创作文档导出，scope 为 `authoring-source-and-document-only`，包含成功代码、文档和晋升记录；不包含编译资产字节。原 `world_export` 仍只导出场景 JSON。

本阶段尚未提供完整项目导入、重启后世界恢复、Studio 实时连接、截图、自定义行为或 Shader 扩展。内存世界重启即释放。完整资产打包与恢复是下一阶段，不能把上述两个导出接口描述为完整项目保存恢复。
