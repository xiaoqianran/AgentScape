# AgentScape Remote MCP v0.3

新增容器隔离的程序化资产构建/发布、不可变版本与文件存储、可信世界保存恢复。原有 33 个工具继续兼容；新增 4 个 Studio Live Bridge 配对/会话工具，使用同一个 `agentscape-world` 连接。契约、示例、隔离设施和保存边界见 [PROGRAMMATIC-ASSETS.md](./PROGRAMMATIC-ASSETS.md)。

Scene 工具为 `scene_observe`、`scene_apply`、`scene_add_model`、`scene_interact`、`scene_job`、`scene_cancel`、`scene_verify`、`scene_save`、`scene_set_style`。它们使用与 SDK/Studio 相同的 Scene 应用服务和 Runtime。`scene_interact` 立即返回 JobRef，由宿主推进模拟，调用方轮询任务并分别检查执行状态与验证证据。Recipe 可以直接作为 scene_add_model 的 model.asset 输入，无需生成 JavaScript。

外部 GLB 可通过 `scene_add_model` 的 `mode: "prepare"` 生成能力候选，再以默认 `mode: "add"` 附审核参数完成编译、物理验证和注册；配套 URDF 复用既有 Compiler Provider。接口、证据边界、Studio 审核入口和传输配额见 [资产交互化流程](../../docs/asset-interaction-pipeline.md)。

`scene_observe({ worldSessionId, target, actor? })` 等价于 SDK 的 `scene.inspect(target, { actor })`，返回资产或环境契约的统一能力说明。省略 target 时，场景观察的 `affordances` 包含这些对象的能力列表（最多 100 项，total 为总数）。能力在每次查询时读取当前状态，不额外保存对象状态。

每项动作包含 `parameters`、`execution`、`available` 和不可用时的 `reason`。未提供 actor 时，具身动作的 available 为 null，表示未检查可达性；提供后复用当前距离、遮挡及持有能力检查。available 只描述当前检查结果，不能替代执行后的碰撞、放置空间或关节完成验证。

`execution: interaction` 的动作统一调用 `scene_interact`；`world-action` 的环境契约现也可通过同一个 `scene_interact` 调用（open/close、turn_on/turn_off、pull_out/return、write），交由 Runtime 的 `WorldCommands.executeAffordance` 执行并核对后置状态。`editor` 使用 `scene_apply`，不代表 Agent 施力。环境契约的 `evidenceKind` 和 `physicsVerified=false` 不得冒充真实物理力学验证。Studio 的同一交互入口与验收边界参见 [统一交互](../../docs/studio-unified-interactions.md)。

通用物理操作不要求 Manifest 声明专用动作：动态刚体可发现 push/drag/rotate，真实滑动/旋转关节可发现 slide/rotateJoint。固定、持有、忙碌或缺少物理解算能力的对象会返回具体阻塞原因。物理元数据的 body 为资产声明，currentBody 为查询时的实际刚体类型。

| action | args | 执行和验证 |
| --- | --- | --- |
| push / drag | direction: 非零水平向量；distance: (0, 5] 米；maxForce?: (0, 1000] 牛，默认 100 | 从实际包围盒计算接触代理位置，通过 applyForce 驱动；验证位移、偏移和静止状态 |
| rotate | axis: 非零世界轴；angle: [-π, π] 弧度且非零；maxTorque?: (0, 1000] 牛米，默认 100 | applyTorque 驱动；验证真实姿态、轴向偏移与角速度 |
| slide / rotateJoint | part: 部件名；target: 绝对关节坐标，或 distance / angle: 相对变化量（二选一） | 仅驱动真实物理关节，检查限位并复用现有关节稳定、停滞与超时验证 |

例如 `scene_interact({ worldSessionId, requestId, interaction: { actor: "agent_01", target: "new_box", action: "push", args: { direction: [1, 0, 0], distance: 1 } } })` 返回 JobRef，随后使用 scene_job 查询结果。成功必须同时有终态 succeeded 和 verification.status=verified。实际证据区分 rigid-body-force、rigid-body-torque 和 joint-motor。

这些操作使用现有 1.5 米交互半径内的接触代理，推/拖会选择相应方向的可达站位；执行中持续复核距离、遮挡、持有状态和碰撞。它不是手指抓取，graspVerified 不会被标为 true。遇阻、偏移、超时或取消时保留真实的部分运动，报告未验证；不修改物体坐标来完成目标。箱子推动一米、不同质量、墙体阻挡、椅子拖动、轮子扭矩、滑动/旋转关节及取消均有 Runtime 验收，推动一米还覆盖真实 HTTP MCP 客户端。

保存和历史快照从 PhysicsSystem 读取部件的实际姿态及电机目标；恢复时按快照恢复，不另建关节状态缓存。实时物理操作与快照恢复路径分开。

注意：Headless MCP 没有渲染画布。调用 `scene_set_style` 成功后，返回的 `status=deferred`、`rendered=false`、`applied=null` 表示 StylePack 已记录到场景配置，**不表示实际画面已经切换或视觉渲染通过验收**。请在 Studio 或带图形渲染器的 SDK 客户端另行验证视觉效果；不要把无渲染器时的 deferred 状态误报为已应用。

`scene_save` 返回有资源字节和锁定哈希的完整项目包，仍受服务端导出配额限制。旧 world_export 的 JSON-only 语义保留。新版资产引用 `asset://sha256/<版本摘要>` 可以引用同一身份已发布的 pa_ 资产；未发布或其他身份的资产不能借此接入世界。

v0.2 的七个草稿接口和参数化 `world_verify` 保留；远程源码执行现已要求同一受限容器，不再仅依赖 Worker/WASM。原草稿工作流见 [AUTHORING.md](./AUTHORING.md)。

独立 Node.js 进程，为外部 Agent 提供可观察、可执行、可验证的私有 3D 世界。无需内部 LLM，不调用在线生成。SDK 固定为官方 MCP v2 2.4.0。

```mermaid
flowchart TD
 Client[ChatGPT / Claude / Codex / OpenCode] --> HTTP[MCP Streamable HTTP + Bearer 鉴权]
 HTTP --> Sessions[SessionManager: 身份、TTL、互斥、幂等]
 Sessions --> Host[HeadlessWorldHost: 正式 createSession、固定时步]
 Host --> Tools[AgentTools / SkillRegistry / Policy]
 Tools --> Commands[WorldCommands / Runtime mutation 与 History]
 Commands --> Runtime[WorldRuntime / Physics / Navigation / Interaction]
 Host --> Queries[WorldQueries / WorldObservation / Acceptance]
```

## Windows 启动

在独立检出目录执行。Node.js 20+，本次使用本机 Node.js；安装依赖不会加载 Studio 私有配置。

```powershell
cd D:\a_programming_list\A-Python-Project\wk08\AgentScape
npm ci
$credential = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:AGENTSCAPE_MCP_TOKENS = ConvertTo-Json -Compress -AsArray @{ identity = 'my-agent'; token = $credential }
npm run mcp:serve
```

客户端请求头配置 `Authorization: Bearer <credential>`，URL 为 `http://127.0.0.1:39015/mcp`。凭据需通过私有配置安全交给客户端。服务不打印凭据。环境变量包含 JSON 数组，可为不同客户端配置不同 identity/token。相同 identity 代表同一访问主体，能够共享该主体创建的世界。不要复用 Studio 或模型 API 密钥。

只监听 127.0.0.1，端口冲突直接失败。Ctrl+C 关闭全部世界。默认快照写入当前检出的 `.mcp-sessions/<worldSessionId>/`，不会加载 Studio 存档。工作目录必须是独立检出。

## 工具接口

| 工具 | 参数 | 结果 |
|---|---|---|
| session_create | template: monument-hall（默认） | worldSessionId、tick、状态；预置 agent_01 / cabinet_01 / cup_01 / table_01，杯子位于柜内 |
| session_status | worldSessionId | 世界与执行状态、闲置到期时间 |
| session_close | worldSessionId | 取消执行并释放 Runtime |
| world_observe | worldSessionId、offset=0、limit=25（最多50） | 有界对象、Agent、空间关系和分页游标 |
| object_inspect | worldSessionId、id | 对象与关节、空间证据 |
| skills_list | worldSessionId | 六个审核动作及各自 JSON Schema |
| action_execute | worldSessionId、skill、args、requestId（UUID） | state、真实 Runtime result、steps、tick |
| world_verify | worldSessionId | verified/unverified、逐项验收证据、持物状态 |
| world_export | worldSessionId | fileName、bytes、snapshot、scope=scene-json-only |

MCP Transport 使用无状态 HTTP；没有 MCP 协议会话 ID，worldSessionId 专属于世界生命周期。每个工具调用仍要求 Bearer 鉴权。SDK 处理协议消息及参数验证；工具执行错误返回 isError 和脱敏错误码。

动作白名单：spawnAsset、moveObject、navigateTo、approachAndInteract、approachAndPickup、approachAndPlace。参数完全遵循 skills_list 返回的 Schema；拒绝未知字段。初始资产为本地 agent / cabinet / cup / table，也允许实例化当前会话已编译注册的创作资产。动作接口不能指定 URL 或磁盘目录；Three.js 代码只能通过 authoring_execute 在受限引擎内执行。profile、actor 的授权身份均由服务端固定，actorId 只是世界内对象 ID。

按顺序调用（每次动作生成独立 requestId；重试相同动作使用原 ID）：

```json
{"skill":"approachAndInteract","args":{"actorId":"agent_01","targetId":"cabinet_01","action":"open"}}
{"skill":"approachAndPickup","args":{"actorId":"agent_01","targetId":"cup_01"}}
{"skill":"approachAndPlace","args":{"actorId":"agent_01","supportId":"table_01","surfaceId":"top"}}
```

以上动作参数还需添加 worldSessionId 和 requestId。之后执行 world_verify、world_export、session_close。调用成功不代表动作成功：读取 state（verified / unverified / blocked / failed / requested）和 result 中的最终证据。请求型返回不提升为 verified。

单世界只允许一个操作，包括读取、验收和导出；并发返回 SESSION_BUSY。Runtime 负责事务、回滚和 History。requestId 绑定动作和参数，冲突拒绝；会话内最多保存256个动作幂等记录，不丢弃后重放。

## 安全与资源

默认最多4个世界，空闲15分钟回收；每世界64个对象、256次动作；单动作最多12000个 1/60 秒模拟步和30秒墙钟时间。每12步让出事件循环。取消/超时重复终止 Runtime interaction/locomotion，并给予最多240步清理；无法收敛则关闭该 Host，禁止继续动作。

HTTP 请求体最多64 KiB，每身份每分钟120次请求；Host 白名单默认 localhost/127.0.0.1，Origin 默认全部拒绝（无 Origin 的非浏览器客户端可用）。headers 10秒、request 35秒超时。快照最多4 MiB，临时文件 JSON 复核后原子 rename；客户端不能指定路径。快照是 SceneSerializer JSON，不包含完整 GLB/纹理作品包。

对象和动作预算限制会话增长；当前 Node.js 同进程承载多个 Runtime，不提供每会话操作系统级硬内存隔离。需要硬内存限制时应采用受限进程/容器部署，不应将本版宣传为任意用户公网沙箱。

进程崩溃后内存世界丢失，启动时不会恢复任何旧世界、鉴权所有权或临时快照；旧的快照和未发布 .tmp 文件可能留在私有目录，须由服务拥有者离线清理。v0.1 不支持快照导入，错误导入不构成开放接口。

## 远程连接

通过可信 TLS 反向代理或隧道转发到 127.0.0.1:39015，保留 Authorization。代理应将上游 Host 设为 localhost；浏览器客户端需由部署代码向 startServer 的 security.origins 传入明确完整 Origin，禁止通配。默认 CLI 不开放跨域浏览器访问。不要暴露本地端口。

这是私有 Bearer 部署，不包含 OAuth 授权发现；要求 OAuth 的托管客户端需要额外授权层。已通过 PC2 AgentDock 的真实工具调用验证完整工作流，部署详情见 DEPLOYMENT-PC2.md；其他客户端各自的直连配置尚未验证。

## 文件职责与验证

- main.mjs：独立 HTTP 启动及关闭、官方 SDK Transport。
- registerTools.js：九工具、严格动作参数 Schema、调用映射。
- security.js：私有身份鉴权、Host/Origin、请求体和频率预算。
- SessionManager.js：所有权、互斥、幂等、TTL、原子导出。
- HeadlessWorldHost.js：复用 createSession/WorldBuilder/AgentTools，独立模拟驱动、动作证据和释放。
- tasks.jsonl：阶段任务；acceptance-evidence.json：真实 MCP 验收记录。
- tests/mcp/：官方 HTTP Client 物理任务、隔离、安全和生命周期自动断言。
- 根 package.json/lock：固定 MCP 依赖和启动/测试脚本；.gitignore：排除私有会话目录。

```powershell
npm run test:mcp
npm run check
```

测试覆盖未鉴权、Origin、请求体限制、频率限制、端口冲突、跨身份隔离、未知 Session、非法参数、白名单、幂等冲突、互斥、取消、超时、异常解锁、TTL、关闭释放、导出预算、原子发布和残留文件不恢复。真实任务使用 Rapier、Recast、柜体 GLB；没有在线模型调用。

已知语义限制：资产/布局准入仍可能 provisional；这与真实动作及最终支撑关系 verified 是不同证据。pickup 为 kinematic attachment，不证明夹持力。未提供截图、在线生成、Studio 同步、多用户公网账号、完整作品包迁移。

机械资产 v1：scene_add_model 的 model.asset 可提交 agentscape.mechanical-draft JSON（几何节点、旋转铰链、滑轨），先经过 GLB 编译与隔离物理验证。详见 [机械资产创建工作台](../../docs/capabilities/mechanical-asset-workbench.md)。

Studio Live Bridge：调用 studio_pair_create 取得一次性配对码，然后在本机 Studio 的「MCP 连接」中明确授权；通过返回的 worldSessionId 使用既有 Scene 工具操作浏览器当前世界。切换世界自动撤销连接。完整说明见 [Studio Live Bridge](../../docs/mcp-studio-live-bridge.md)。

本机 Studio MCP 自动连接默认开启：打开 Studio 后由浏览器自动注册当前世界，认证 MCP 客户端可省略 Scene 工具的 worldSessionId；手动配对仍可在高级设置中使用。见 [自动连接说明](../../docs/mcp-studio-auto-connect.md)。
