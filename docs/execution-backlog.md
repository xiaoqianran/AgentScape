# AgentScape Execution Backlog

> 本文保留早期任务拆分讨论，作为历史参考，不再维护任务状态。唯一任务真相源是各主要所有者旁边的 `tasks.jsonl`；文件发现、字段和更新规则见 [Planning](../planning/README.md)。`status-and-roadmap.md` 只负责产品成熟度与大方向。
>
> Last reviewed: 2026-09-10 · Repository: `AgentScape` · Baseline branch: `main`

## 0. 如何维护这张表

### 0.1 当前任务来源

当前使用 **JSONL + Git**。任务记录分布在 `planning/tasks.jsonl`、`application/tasks.jsonl` 及各主要模块、应用、SDK、服务的 `tasks.jsonl`，每条任务只存一份。运行 `npm run planning:list` 聚合查看，运行 `npm run planning:ready` 查看依赖已完成的待执行任务。

本文件不是 JSONL 的导出来源。下方表格中的 ID、状态、尺寸及维护建议属于历史快照，不能用于领取任务或覆盖当前 JSONL 记录。

### 0.2 原子任务规则

一个任务必须同时满足：

1. 只有 **一个可观察结果**；不能写“实现物理引擎”“完善交互系统”。
2. 通常只涉及 **1 个生产文件 + 1 个测试文件**；跨域任务先拆 contract，再拆各域实现。
3. 目标工作量 **20–90 分钟**。超过 90 分钟，在领取前继续拆成新的稳定 ID。
4. 必须有明确 DoD（Definition of Done），最好是一条可以运行的测试/命令。
5. 不允许用“优化一下 / 完善一下 / 支持更多”作为任务描述。
6. 发现前置问题时，不把原任务无限扩张；新增一个 blocker 任务并写入 `Depends`。

### 0.3 状态与优先级

- `READY`：前置条件已经满足，可以直接领取。
- `IN_PROGRESS`：已经有人领取；同一任务只能有一个 owner。
- `BLOCKED`：明确依赖其他任务或外部能力。
- `DISCOVERY`：只允许调查/实验，不允许顺便落大规模实现。
- `DEFERRED`：当前明确不做。
- `DONE`：DoD 已满足，并在 Evidence 中写测试/commit/PR。

优先级：`P0` 当前闭环阻塞；`P1` 近期质量/能力；`P2` 扩展；`P3` 研究性。

任务尺寸：`XS` 20–40 分钟；`S` 40–90 分钟。任何 `M` 都视为“还没拆完”。

### 0.4 更新协议

领取和完成任务时，仅修改任务所属的 `tasks.jsonl`，按 Planning 约定更新状态、依赖与验收条件。不要更新本文表格，也不要从 Markdown 重新导出或复制任务。Ready Queue 由待执行状态与跨文件依赖共同计算。

## 1. 当前功能地图（按真实代码，而不是旧 roadmap）

| 域 | 当前真实能力 | 主要代码所有者 | 当前边界 / 明显缺口 |
|---|---|---|---|
| Composition Root | 初始化 Runtime、Generation、Skills、Agent、Studio、持久化 | `apps/studio/main.js`, `modules/world/runtime/WorldRuntime.js` | 启动链仍需要更强 smoke/故障可见性 |
| Core | EventBus、Policy、Trace、错误、渲染创建/探针 | `foundation/*` | Trace 仍是进程内轻量链；缺统一 schema/version 约束 |
| Rendering | WebGPU/WebGL2、GPU probes、Gaussian visual、post-FX | `modules/rendering/*`, `RenderingSystem.js` | probes 多于产品化预算/降级策略 |
| Artifact | Descriptor、Registry、Lease、stream hash、MIME/结构 gate、持久化 | `modules/artifact/*` | archive/bundle fail-closed；格式扩展需逐个安全实现 |
| Asset | Manifest、Catalog、Manager、Local Library、Admission | `modules/asset/*` | 自动语义/关节/抓取证据仍弱 |
| Asset Compiler | 19-stage 浏览器编译流水线 + 可选服务端 CoACD | `modules/asset/compiler/*` | segmentation/semantics/joint target automation 仍是主要缺口 |
| Generation | Provider capability、Connector session、Job、Artifact import、组合路由 | `modules/generation/*` | 需要持续做断线恢复、E2E、provider capability contract 收敛 |
| World IR | revision/provenance/entities/spatial/physics/interactions/rules/acceptance | `modules/world/spec/*` | 全局 constraints 仍 fail-closed；planner revision 还可扩展 |
| World Compiler | resolve/admission/layout/behavior/physics/instantiate/relation/verify | `modules/world/compiler/*` | 增量重编译目前只覆盖有限 impact classes |
| Runtime | 对象、事务、撤销、序列化、环境切换、authority | `modules/world/runtime/WorldRuntime.js` | snapshot/authority 和异步系统仍需更多竞态测试 |
| Physics | `PhysicsSystem` 语义层 + Rapier/Jolt/Transform backend | `modules/world/runtime/physics/*`, `PhysicsSystem.js` | backend 抽象已经存在；不要再建 PhysicsManager。未来重点是 parity/quality/新 capability |
| Navigation | Recast/Detour NavMesh + TileCache 动态障碍 | `NavigationSystem.js`, `navigation/*` | Crowd/off-mesh/大世界增量 tile 尚未产品化 |
| Locomotion | path → character movement → grounded/block result | `LocomotionSystem.js`, Physics backend | 动态重规划/多 agent 避让仍有限 |
| Spatial | bounds、near、raycast、collision、support、receptacle/free-space | `SpatialSystem.js`, `SceneGraph.js` | 语义关系仍偏几何启发式 |
| Interaction | approach/open/close/pickup/carry/place/inside/recovery | `InteractionSystem.js` | grasp/IK/force/payload 仍是后续研究域 |
| Behavior / Rules | RuntimeCommand、precondition/effect/verifier、event→state rule | `modules/world/runtime/behavior/*` | rule effect 目前主要是 `set-state` |
| Verification | WorldValidator、Finding、Acceptance、ArticulationVerifier、Repair | `modules/world/verification/*` | repair strategy 很有限；跨域 Finding→局部重编译还可增强 |
| Agent | ToolCalling loop、mutation barrier、fresh replan、recovery ledger、proposal gates | `modules/agent/*` | 需要继续缩小 model 自由度并增强任务级评测 |
| Studio | 编辑、图片工作台、生成、资产、场景、任务、运行、debug、持久化 | `apps/studio/*` | 正在成为唯一产品工作台；新 Image→3D 流程仍处开发态 |
| Observatory | 资源/Gaussian + 旧 physics/spatial/nav/interaction/generation/agent labs | `apps/observatory/*` | 多个 Lab 已标 Deprecated；只保留诊断价值，不继续承载产品功能 |
| Generated World | PLY/GLB mesh、SPZ visual、semantics、navigation artifact → Environment | `modules/world/loadGeneratedWorld.js` | 3DGS/SPZ 只负责视觉；可走物理仍依赖 mesh/collider/nav |
| Content | Monument Hall / Ruined Courtyard / Grand Urban Block | `modules/world/content/*` | fixture 可继续向旗舰交互闭环服务 |
| Asset Compiler Service | URL/verified upload、CoACD、per-part geometry、URDF proposal | `services/asset-compiler/*` | URL 路径应继续收缩；优先 verified bytes |
| Python SDK | Connector capability/session/jobs/artifacts/CLI/Text→3D | `sdk/python/agentscape/*` | 与浏览器 JS contract 必须做 parity |
| API / Tooling / CI | local capability API、gateway、validators、experiments、viability | `api/*`, `dev/*`, `.github/*` | 应逐步把“架构不变量”自动化而不是靠文档记忆 |

## 2. 当前最先跑的可执行闭环（Agent → 环境 → 走动 → 交互）

这一组不要求新增功能，先证明当前 Runtime 基线可靠。每一步失败时再把失败点转成对应域的工程任务。

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| RUN-001 | P0 | XS | READY | verify | 启动 Agent gateway 并确认进程保持运行 | `apps/server/openai-compatible-agent-gateway.mjs` | — | `npm run agent:gateway` 启动后无 startup error | — | — |
| RUN-002 | P0 | XS | READY | verify | 启动 Studio 并确认 Runtime 进入 ready | `apps/studio/main.js` | RUN-001 | 页面显示 Runtime ready，console 无初始化异常 | — | — |
| RUN-003 | P0 | XS | READY | verify | 确认 `agent_01` 在当前世界存在 | `modules/agent/bootstrapWorld.js` | RUN-002 | `listObjects` 返回 `agent_01` | — | — |
| RUN-004 | P0 | XS | READY | verify | 运行“导航状态”Runtime Test | `apps/studio/agent/AgentRuntimeTestRunner.js` | RUN-003 | navigation `state=ready` 且 locomotion 非 missing | — | — |
| RUN-005 | P0 | XS | READY | verify | 运行“走到杯子前”Runtime Test | same | RUN-004 | `navigateTo` 返回 `arrived` | — | — |
| RUN-006 | P0 | XS | READY | verify | 运行“走到柜子前”Runtime Test | same | RUN-004 | `navigateTo` 返回 `arrived` | — | — |
| RUN-007 | P0 | XS | READY | verify | 运行“拿起杯子”Runtime Test | same | RUN-005 | pickup=`held`，carry target=`cup_01` | — | — |
| RUN-008 | P0 | XS | READY | verify | 运行“杯子放桌上”Runtime Test | same | RUN-007 | placed + supportVerified + settled | — | — |
| RUN-009 | P0 | XS | READY | verify | 运行“打开柜门”Runtime Test | same | RUN-006 | action-completed + articulation verified open | — | — |
| RUN-010 | P0 | S | READY | verify | 用自然语言让 ToolCallingAgent 完成一次走动任务 | `modules/agent/ToolCallingAgent.js` | RUN-005 | agent 调 tool 后返回 taskStatus=completed | — | — |
| RUN-011 | P0 | S | READY | verify | 用自然语言让 Agent 完成 pickup→place | same | RUN-008,RUN-010 | 无 unresolved mutation，最终 taskStatus=completed | — | — |
| RUN-012 | P0 | S | READY | verify | 保存一次完整 Agent execution/trace 作为当前基线 | `TraceRecorder.js`, RunsPanel | RUN-011 | 可重看 tool sequence，`verifyTrace` 成功 | — | — |

## 3. Core / Runtime 基础设施

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| CORE-001 | P1 | XS | READY | test | 为 EventBus `on()` 返回的 unsubscribe 增加幂等测试 | `foundation/EventBus.js` | — | 连续 unsubscribe 两次不抛错且不再收到事件 | — | — |
| CORE-002 | P1 | XS | READY | test | 为 `EventBus.clear()` 增加 wildcard listener 清理测试 | same | CORE-001 | clear 后普通与 `*` listener 都不触发 | — | — |
| CORE-003 | P1 | XS | READY | test | 固定 EventBus event envelope 的 `type/at` 语义 | same | — | 添加 deterministic clock seam 或断言 `at` 为有限时间值 | — | — |
| CORE-004 | P1 | XS | READY | test | 为 PolicyEngine 未知 profile 增加 deny 行为测试 | `foundation/PolicyEngine.js` | — | 未知 profile 对有权限 skill 返回 missing | — | — |
| CORE-005 | P1 | XS | READY | test | 为 admin `*` permission 增加回归测试 | same | — | 任意声明 permission 均 allow | — | — |
| CORE-006 | P1 | XS | READY | test | 为 TraceRecorder payload depth truncation 增加边界测试 | `foundation/TraceRecorder.js` | — | 超过 MAX_DEPTH 变为 `[truncated]` | — | — |
| CORE-007 | P1 | XS | READY | test | 为 TraceRecorder typed-array compact 增加测试 | same | — | trace 不保存原始大 bytes，只保留类型+bytes | — | — |
| CORE-008 | P1 | XS | READY | test | 为 trace ring-buffer anchor hash 增加溢出验证 | same | — | 超 limit 后 `verify()` 仍通过 | — | — |
| CORE-009 | P1 | XS | READY | test | 增加 trace 中间条目被篡改的失败测试 | same | CORE-008 | `verify()` 返回 hash_mismatch | — | — |
| CORE-010 | P2 | S | READY | code | 给 AgentScapeError 增加可序列化 `toJSON()` | `foundation/errors.js` | — | 输出仅 code/message/details，不含 stack | — | — |
| CORE-011 | P2 | XS | READY | test | 对 `toJSON()` 增加 secret-like details 不自动扩张测试 | same | CORE-010 | schema 固定且 stack 不泄漏 | — | — |
| RT-001 | P1 | XS | READY | test | 测试 `WorldRuntime.beginMutation()` 嵌套所有权拒绝 | `WorldRuntime.js` | — | 第二个 owner 不能偷偷开启事务 | — | — |
| RT-002 | P1 | XS | READY | test | 测试 mutation handler throw 后 history cancel | same | RT-001 | snapshot 与 history index 回到调用前 | — | — |
| RT-003 | P1 | S | READY | test | 测试 `exclusiveMutation` 并发第二请求的明确结果 | same | RT-001 | 并发 mutation 不交叉修改 authority | — | — |
| RT-004 | P1 | XS | READY | test | 测试 `clearObjects({silent:true})` 不产生用户 history | same | — | clear 完成且 history 不新增可撤销 entry | — | — |
| RT-005 | P1 | S | READY | test | 测试环境 replace 失败后的旧环境恢复 | `WorldRuntime.js` | — | scene/physics/navigation/environment identity 恢复 | — | — |
| RT-006 | P1 | S | READY | test | 测试 environment systems teardown 后无旧 collider | same | RT-005 | backend debug snapshot 不含旧环境 collider | — | — |
| RT-007 | P1 | XS | READY | test | 测试 duplicate 后 instanceId 唯一 | same | — | 原对象与副本 id 不冲突 | — | — |
| RT-008 | P1 | XS | READY | test | 测试 remove held object 会清理 carry ownership | `WorldRuntime.js`,`InteractionSystem.js` | — | remove 后 carryStatus=empty | — | — |
| RT-009 | P1 | XS | READY | test | 测试 serialize 不写 Three/native backend 对象 | `SceneSerializer.js` | — | JSON.stringify 可成功且无 native handles | — | — |
| RT-010 | P1 | XS | READY | test | 测试 restore 遇到未知 asset fail-closed | same | — | 明确错误，场景不部分恢复 | — | — |
| RT-011 | P1 | S | READY | test | 测试 restore 中途失败的全量 rollback | same | RT-010 | 失败后与 before snapshot 等价 | — | — |
| RT-012 | P2 | XS | READY | test | 测试 CommandHistory 空栈 undo/redo | `CommandHistory.js` | — | 返回稳定 noop，不改变 snapshot | — | — |
| RT-013 | P2 | XS | READY | test | 测试 undo 后新 mutation 清空 redo 分支 | same | — | redo 不可再执行旧分支 | — | — |
| RT-014 | P2 | XS | READY | test | 测试 history limit 淘汰最老 entry | same | — | 超 limit 后长度稳定、最新可 undo | — | — |
| RT-015 | P2 | S | DISCOVERY | experiment | 记录 SimulationSession/Clock 当前 ownership 与暂停语义 | `modules/world/runtime/simulation/*` | — | 文档 1 段 + 对应现有测试定位，不改架构 | — | — |

## 4. Rendering / GPU / Generated Visual

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| REND-001 | P1 | XS | READY | test | 为 renderer mode 非法值 normalization 增加测试 | `modules/rendering/createRenderer.js` | — | 非法 mode 回落策略稳定 | — | — |
| REND-002 | P1 | S | READY | test | WebGPU 初始化失败时验证 WebGL2 fallback diagnostics | same | REND-001 | diagnostics 明确 requested/backend/fallback | — | — |
| REND-003 | P1 | XS | READY | test | RendererProbe 在无 timestamp-query 时返回 supported=false | `RendererProbe.js` | — | 不抛错，GPU timing 标 unavailable | — | — |
| REND-004 | P2 | XS | READY | test | WebGPUComputeProbe 固定 1024 元素结果 parity | `WebGPUComputeProbe.js` | — | CPU verifier 0 mismatch | — | — |
| REND-005 | P2 | XS | READY | test | SpatialProbe 对边界半径点定义包含/排除规则 | `WebGPUSpatialProbe.js` | — | CPU/GPU mask 同一边界约定 | — | — |
| REND-006 | P2 | XS | READY | test | CompactionProbe 验证输出索引无重复 | `WebGPUCompactionProbe.js` | — | duplicate index 被 verifier 拒绝 | — | — |
| REND-007 | P2 | XS | READY | test | IndirectDraw command 参数布局加单测 | `WebGPUIndirectDrawProbe.js` | — | indexCount/instanceCount 等字段固定 | — | — |
| REND-008 | P1 | XS | READY | test | Gaussian budget 对 `maxSplats=0` 明确行为 | `loadGaussianSplatVisual.js` | — | 返回空或明确错误，测试固定 | — | — |
| REND-009 | P1 | S | READY | test | Gaussian budget 超限抽样保持 deterministic | same | REND-008 | 同输入两次选中相同 splat 集 | — | — |
| REND-010 | P1 | S | READY | test | Generated visual load 失败不影响 mesh physics world | `RenderingSystem.js` | — | visual failure 被诊断，world mesh 仍运行 | — | — |
| REND-011 | P2 | XS | READY | test | PostFX option normalization 非有限数字 fail/normalize | `WebGpuPostFxPipeline.js` | — | 不向 GPU 传 NaN/Infinity | — | — |
| REND-012 | P2 | S | READY | test | PostFX dispose 后重复 dispose 幂等 | same | — | 第二次 dispose 不抛且无资源访问 | — | — |
| REND-013 | P1 | XS | READY | test | `resize()` 零尺寸 viewport 不创建非法 render target | `RenderingSystem.js` | — | 0×0 情况不抛/不 NaN | — | — |
| REND-014 | P2 | S | DISCOVERY | experiment | 记录当前 3 个内建 world 的 draw call/vertex/texture baseline | Studio + RendererProbe | RUN-002 | 每个 world 一行 baseline 数据 | — | — |
| REND-015 | P2 | S | BLOCKED | code | 把 baseline 预算阈值显示到 DeveloperSettings | `DeveloperSettings.js` | REND-014 | 超预算有 advisory，不改变 Runtime truth | — | — |

## 5. Artifact：Provider 输出到可信本地 bytes

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| ART-001 | P1 | XS | READY | test | descriptor id 拒绝斜杠/空格/控制字符 | `modules/artifact/ArtifactDescriptor.js` | — | 三类非法 ID 都返回 `ARTIFACT_ID_INVALID` | — | — |
| ART-002 | P1 | XS | READY | test | descriptor hash 只接受 lowercase canonical sha256 | same | — | uppercase/长度错误 hash 被拒绝 | — | — |
| ART-003 | P1 | XS | READY | test | descriptor 禁止 `signedUrl`/`token`/`filePath` 字段 | same | — | 深层嵌套 forbidden field 也被拒绝 | — | — |
| ART-004 | P1 | XS | READY | test | producer operation 必须 provider-scoped + `.vN` | same | — | 非稳定 operation 被拒绝 | — | — |
| ART-005 | P1 | XS | READY | test | lineage 禁止 self-reference | same | — | 自引用返回 `ARTIFACT_LINEAGE_INVALID` | — | — |
| ART-006 | P1 | XS | READY | test | lineage 禁止重复 parent edge | same | ART-005 | 同 artifact+relation 第二次被拒绝 | — | — |
| ART-007 | P1 | XS | READY | test | available connector location 必须有 safe access handle | same | — | 缺 access 被拒绝 | — | — |
| ART-008 | P1 | XS | READY | test | local-cache access key 只能 safe artifact id 字符集 | same | — | path-like cache key 被拒绝 | — | — |
| ART-009 | P1 | XS | READY | test | retention expiry 早于 createdAt 被拒绝 | same | — | 返回稳定 contract error | — | — |
| ART-010 | P1 | XS | READY | test | untrusted descriptor 不能自报 integrity=verified | same | — | 返回 `ARTIFACT_INTEGRITY_EVIDENCE_REQUIRED` | — | — |
| ART-011 | P1 | XS | READY | test | Registry 相同 ID+相同 immutable signature 幂等 | `ArtifactRegistry.js` | — | 第二次 register 返回同事实不新增索引 | — | — |
| ART-012 | P1 | XS | READY | test | Registry 相同 ID+不同 hash 冲突 | same | — | `ARTIFACT_IDENTITY_CONFLICT` | — | — |
| ART-013 | P1 | XS | READY | test | hash index 对多个不同 ID 同 hash 可检索 | same | — | `findByHash` 返回排序稳定的全部 IDs | — | — |
| ART-014 | P1 | XS | READY | test | location 更新不能改变 kind/scope/access identity | same | — | 冲突返回 `ARTIFACT_LOCATION_IDENTITY_CONFLICT` | — | — |
| ART-015 | P1 | XS | READY | test | 被 lease 的 location 不能删除 | same | — | `ARTIFACT_LOCATION_LEASED` | — | — |
| ART-016 | P1 | XS | READY | test | expired lease 不阻塞 location 删除 | same | ART-015 | includeExpired=false 后可删除 | — | — |
| ART-017 | P1 | XS | READY | test | integrity verify 的 bytes/hash/mime 任一不匹配均失败 | same | — | 三个独立 case 都是 mismatch | — | — |
| ART-018 | P1 | XS | READY | test | integrity reject 后状态保存 rejection code/time | same | — | get() 返回 rejected evidence | — | — |
| ART-019 | P1 | S | READY | test | Importer Content-Length 大于 maxBytes 在读 stream 前拒绝 | `ArtifactImporter.js` | — | reader 未启动、无 byteStore commit | — | — |
| ART-020 | P1 | S | READY | test | Importer stream 实际 bytes 超 descriptor 时立即 cancel | same | ART-019 | reader.cancel 被调用且 cache 回滚 | — | — |
| ART-021 | P1 | S | READY | test | Importer hash mismatch 后不留下 local-cache location | same | — | Registry/location/byteStore 三者无残留 | — | — |
| ART-022 | P1 | S | READY | test | Importer writer commit 后 registry 更新失败时删除 committed cache | same | — | 无 orphan cache | — | — |
| ART-023 | P1 | XS | READY | test | Importer chunkCount 超上限 fail-closed | same | — | `ARTIFACT_STREAM_LIMIT` | — | — |
| ART-024 | P1 | XS | READY | test | GLB magic/version/declared length 分别验证 | `ArtifactContentGate.js` | — | 每种坏 header 有稳定错误 | — | — |
| ART-025 | P1 | XS | READY | test | PNG/JPEG/WebP signature 分别验证 | same | — | MIME spoof 三个 case 被拒绝 | — | — |
| ART-026 | P1 | XS | READY | test | PLY/SPZ signature 分别验证 | same | — | 错 magic 被拒绝 | — | — |
| ART-027 | P1 | S | READY | test | JSON maxDepth 与 maxNodes 各自触发限制 | same | — | 两类结构炸弹不进入无界解析路径 | — | — |
| ART-028 | P1 | XS | READY | test | archive MIME 明确 fail-closed | same | — | zip/tar/gzip 返回 `ARTIFACT_ARCHIVE_UNSUPPORTED` | — | — |
| ART-029 | P2 | S | DISCOVERY | research | 为 zip bundle 定义最大 entries/总解压比/路径规则 | `docs/*` | ART-028 | 只提交约束文档，不实现 parser | — | — |
| ART-030 | P2 | S | BLOCKED | code | 实现 zip central-directory 仅元数据预检 | new bounded parser | ART-029 | 不解压 bytes 即拒绝 path traversal/超 entry count | — | — |
| ART-031 | P1 | S | READY | test | persisted verified descriptor 缺 byte entry 时 hydrate fail-closed | `ArtifactModule.js` | — | `ARTIFACT_PERSISTENCE_INTEGRITY_MISMATCH` | — | — |
| ART-032 | P1 | S | READY | test | persisted byte hash 被改后 hydrate 拒绝 | same | — | contentHash mismatch 被捕获 | — | — |
| ART-033 | P2 | XS | READY | test | `persistArtifact` 缺 descriptor 或 entry 返回 false | same | — | 无异常、无部分写入 | — | — |

## 6. Asset Manifest / Catalog / Manager / Library

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| ASSET-001 | P1 | XS | READY | test | Manifest actions 禁止重复 | `modules/asset/schema.js` | — | duplicate action → INVALID_MANIFEST | — | — |
| ASSET-002 | P1 | XS | READY | test | compiled source 必须有 storage key | same | — | 缺 key 被拒绝 | — | — |
| ASSET-003 | P1 | XS | READY | test | box collider halfExtents 必须 3 个正有限值 | same | — | 0/NaN/长度错分别失败 | — | — |
| ASSET-004 | P1 | XS | READY | test | cylinder/capsule 半高与半径必须正值 | same | — | 0/负数 fail | — | — |
| ASSET-005 | P1 | XS | READY | test | convexHull 至少 4 个有限点且长度 %3=0 | same | — | 三类非法 hull fail | — | — |
| ASSET-006 | P1 | XS | READY | test | joint axis 不能零向量 | same | — | zero axis 被拒绝 | — | — |
| ASSET-007 | P1 | XS | READY | test | joint limits 必须升序 | same | — | min>=max 被拒绝 | — | — |
| ASSET-008 | P1 | XS | READY | test | articulation target 必须落在 limits 内 | same | — | 越界 open/close target 被拒绝 | — | — |
| ASSET-009 | P1 | XS | READY | test | open/close action 必须同时存在 joint/collider/target | same | — | 任缺一项 fail | — | — |
| ASSET-010 | P1 | XS | READY | test | part parent 不能形成自环 | same | — | self-parent fail | — | — |
| ASSET-011 | P1 | S | READY | test | part hierarchy 多节点 cycle 被拒绝 | `modules/asset/parts.js`,`schema.js` | ASSET-010 | A→B→A fail | — | — |
| ASSET-012 | P1 | XS | READY | test | receptacle id 唯一 | `modules/asset/schema.js` | — | duplicate id fail | — | — |
| ASSET-013 | P1 | XS | READY | test | receptacle size 必须正有限 vec3 | same | — | 非法 size fail | — | — |
| ASSET-014 | P1 | XS | READY | test | holdAnchor quaternion 必须有限 4 元素 | same | — | invalid rotation fail | — | — |
| ASSET-015 | P1 | S | READY | test | interactionContract entityId 必须等于 manifest.id | same | — | cross-asset contract fail | — | — |
| ASSET-016 | P1 | XS | READY | test | interaction contract ids 必须唯一 | same | — | duplicate contract fail | — | — |
| ASSET-017 | P1 | XS | READY | test | Catalog empty query 返回稳定前 N 项 | `AssetCatalog.js` | — | 顺序与 limit 有测试 | — | — |
| ASSET-018 | P1 | XS | READY | test | Catalog exact id/label 比 substring 排名高 | same | — | exact match 排第一 | — | — |
| ASSET-019 | P1 | XS | READY | test | 中文 token 查询不被英文 stopword 逻辑丢弃 | same | — | 中文 label 可搜索 | — | — |
| ASSET-020 | P1 | XS | READY | test | resolveExisting 显式 assetId 优先于 query | same | — | 已存在 ID 直接 found | — | — |
| ASSET-021 | P1 | XS | READY | test | AssetManager register 同 manifest 幂等 | `AssetManager.js` | — | 重复注册不产生第二份 factory/resource | — | — |
| ASSET-022 | P1 | S | READY | test | AssetManager 不兼容同 ID manifest 拒绝覆盖 | same | — | source/physics identity 改变时 fail | — | — |
| ASSET-023 | P1 | S | READY | test | instantiate GLB 缺声明 part node 时 fail-closed | same | — | 不把缺 part 的对象放入 scene | — | — |
| ASSET-024 | P1 | S | READY | test | instantiate 失败时临时 Three resources 被 dispose | same | — | geometry/material 不泄漏 | — | — |
| ASSET-025 | P1 | XS | READY | test | AssetModule hydrate 只恢复 compiled manifest | `AssetModule.js` | — | builtin/repo manifest 不重复持久化 | — | — |
| ASSET-026 | P1 | XS | READY | test | approveAsset 对未知 asset fail | `LocalAssetLibrary.js` | — | 明确错误，不写 library | — | — |
| ASSET-027 | P1 | S | READY | test | LocalAssetLibrary hydrate 缺 compiled bytes 标记不可用 | same | — | library 不宣称 ready | — | — |
| ASSET-028 | P1 | S | READY | test | VerifiedArtifactAssetPipeline 拒绝 Artifact ID=Asset ID | `VerifiedArtifactAssetPipeline.js` | — | `ASSET_IDENTITY_COLLISION` | — | — |
| ASSET-029 | P1 | XS | READY | test | pipeline 只接受 verified GLB | same | — | declared/rejected/非 GLB 各自 fail | — | — |
| ASSET-030 | P1 | XS | READY | test | local-cache entry hash/bytes/mime/id 全部复核 | same | — | 任一 mismatch → `ARTIFACT_CACHE_IDENTITY_MISMATCH` | — | — |
| ASSET-031 | P1 | S | READY | test | 已注册相同 source Artifact 的 Asset 可安全 reuse | same | — | reused=true，compiler 不重跑 | — | — |
| ASSET-032 | P1 | S | READY | test | 同 assetId 不同 Artifact provenance 冲突 | same | — | `ASSET_ID_CONFLICT` | — | — |
| ASSET-033 | P1 | S | READY | test | compile rejected 时不注册 manifest | same | — | status=asset-rejected + manager.has=false | — | — |
| ASSET-034 | P1 | S | READY | test | pipeline finally 总是 release compile lease | same | — | success/reject/throw 三路 leasesFor=[] | — | — |
| ASSET-035 | P1 | XS | READY | test | assetAdmission provider/compiler/runtime 三层 reason 不串层 | `modules/asset/admission.js` | — | 每个 reason 只出现在对应 layer | — | — |
| ASSET-036 | P1 | XS | READY | test | legacy builtin 无任何 required layer 保持 ready | same | — | 不被新 admission 误降级 | — | — |
| ASSET-037 | P1 | XS | READY | test | executable articulation 未 runtime verify 必须 provisional | same | — | reason=`ARTICULATION_UNVERIFIED` | — | — |
| ASSET-038 | P2 | S | READY | code | Catalog summary 增加 admission status 的安全摘要 | `AssetCatalog.js` | ASSET-035 | list/search 能区分 ready/provisional/rejected，不暴露内部证据 | — | — |

## 7. Asset Compiler：拆到每一个 Pass

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| COMP-001 | P1 | XS | READY | test | AssetCompiler 固定 pass 顺序快照测试 | `AssetCompiler.js` | — | 19 个 pass 顺序变化必须显式更新测试 | — | — |
| COMP-002 | P1 | XS | READY | test | URL `content-length` 超 100MiB 在读取 body 前拒绝 | same | — | reader 未消费 | — | — |
| COMP-003 | P1 | S | READY | test | chunked GLB 超预算时 cancel reader | same | — | `ASSET_INPUT_TOO_LARGE` + reader.cancel | — | — |
| COMP-004 | P1 | XS | READY | test | 每个 pass emit started/completed 且名称一致 | same | — | 成功编译事件成对 | — | — |
| COMP-005 | P1 | S | READY | test | pass throw 时不 emit completed、不写 compiled store | same | — | store.put 未调用 | — | — |
| COMP-006 | P1 | XS | READY | test | GLTFInspectPass 拒绝无 scene/mesh GLB | `GLTFInspectPass.js` | — | inspection 不产生伪 geometry | — | — |
| COMP-007 | P1 | XS | READY | test | GLTFInspectPass 统计 node/mesh/material/texture 数稳定 | same | — | fixture 数量精确断言 | — | — |
| COMP-008 | P1 | XS | READY | test | StructurePass 对 duplicate node name 记录 ambiguity | `StructurePass.js` | — | 后续 proposal 不误绑 node | — | — |
| COMP-009 | P1 | XS | READY | test | NormalizeTransformPass 单位缩放 deterministic | `NormalizeTransformPass.js` | — | 相同 fixture 输出完全相同 | — | — |
| COMP-010 | P1 | XS | READY | test | NormalizeTransformPass 极小/极大 bounds 有 guard | same | — | 不产生 NaN/Infinity scale | — | — |
| COMP-011 | P1 | XS | READY | test | GeometryPass 计算 bounds/ground offset | `GeometryPass.js` | — | fixture 数值在 tolerance 内 | — | — |
| COMP-012 | P1 | XS | READY | test | GeometryPass 非有限 vertex fail-closed | same | — | 不输出 collider | — | — |
| COMP-013 | P1 | XS | READY | test | SemanticHeuristicPass 仅输出 advisory semantics | `SemanticHeuristicPass.js` | — | heuristic 不直接创建 executable action | — | — |
| COMP-014 | P1 | S | READY | test | Semantic heuristic 对 door/drawer 名称仅生成候选而非已验证 joint | same | — | provenance level 保持 heuristic | — | — |
| COMP-015 | P1 | XS | READY | test | ArticulationCandidatePass duplicate candidate 去重 | `ArticulationCandidatePass.js` | — | 同 node/type 不重复 | — | — |
| COMP-016 | P1 | S | READY | test | articulation candidate 无 axis/limits 不可提升 executable | same | — | 只保留 candidate evidence | — | — |
| COMP-017 | P1 | XS | READY | test | ColliderFallbackPass 空 geometry 不生成零尺寸 collider | `ColliderFallbackPass.js` | — | 明确 issue/reject | — | — |
| COMP-018 | P1 | XS | READY | test | fallback AABB reason 写入 quality provenance | same | — | `FALLBACK_BOX_COLLIDER` 可追踪 | — | — |
| COMP-019 | P1 | S | READY | test | RemoteEnrichmentPass provider 未配置时纯 passthrough | `RemoteEnrichmentPass.js` | — | 不改变原 geometry/semantics | — | — |
| COMP-020 | P1 | S | READY | test | Remote provider 错误只降级 advisory，不破坏 fallback | same | — | 本地 compiler 仍完成 | — | — |
| COMP-021 | P1 | XS | READY | test | SegmentMaterializePass 对 face segment 越界 fail | `SegmentMaterializePass.js` | — | 不生成损坏 GLB | — | — |
| COMP-022 | P1 | S | READY | test | materialize 后每个新 Part node mesh face 数与证据一致 | same | — | face ownership 守恒 | — | — |
| COMP-023 | P1 | XS | READY | test | SegmentationEvidencePass duplicate segment id 拒绝 | `SegmentationEvidencePass.js` | — | issue=`SEGMENTATION_ID_INVALID` | — | — |
| COMP-024 | P1 | XS | READY | test | segment labeledFaces 不能超过 source faceCount | same | — | `SEGMENTATION_COVERAGE_INVALID` | — | — |
| COMP-025 | P1 | S | READY | test | JointFramePass node local→parent frame 数值测试 | `JointFramePass.js` | — | fixture anchor/axis 在 tolerance 内 | — | — |
| COMP-026 | P1 | S | READY | test | JointFramePass 非均匀 scale 明确 unsupported | same | — | `JOINT_FRAME_SCALE_UNSUPPORTED` | — | — |
| COMP-027 | P1 | XS | READY | test | PartColliderPass 每个 executable part 至少有 collider | `PartColliderPass.js` | — | 缺 collider 时不提升 action | — | — |
| COMP-028 | P1 | S | READY | test | Part collider 使用 owned mesh bounds 而非 whole asset bounds | same | — | door collider 不覆盖 cabinet root | — | — |
| COMP-029 | P1 | XS | READY | test | PartProposalPass node missing/ambiguous 分开报 code | `PartProposalPass.js` | — | 两种 fixture 分别命中对应 code | — | — |
| COMP-030 | P1 | S | READY | test | PartProposal parent hierarchy 必须匹配 GLB node ancestry | same | — | mismatch 不 promote | — | — |
| COMP-031 | P1 | S | READY | test | PartGeometryEnrichment 忽略 provider 返回未知 part | `PartGeometryEnrichmentPass.js` | — | issue=`PART_GEOMETRY_UNKNOWN_PART` | — | — |
| COMP-032 | P1 | S | READY | test | per-part provider 单 part 失败不影响其他 part | same | — | good part enrichment 保留 | — | — |
| COMP-033 | P1 | S | READY | test | ArticulatedCollisionPass root/part collider overlap policy 有 fixture | `ArticulatedCollisionPass.js` | — | 不把 solver-parent 接触误判硬失败 | — | — |
| COMP-034 | P1 | S | READY | test | articulated sweep 发现严重自碰撞时 quality reason 稳定 | same | — | hard/advisory 等级固定 | — | — |
| COMP-035 | P1 | XS | READY | test | OptimizeGLBPass 优化前后 scene node identity 保持 | `OptimizeGLBPass.js` | — | part node 名不丢 | — | — |
| COMP-036 | P1 | S | READY | test | 优化后 material/texture 引用仍有效 | same | — | parse optimized GLB 成功 | — | — |
| COMP-037 | P1 | XS | READY | test | ResourceBudgetPass advisory/hard vertex 阈值边界测试 | `ResourceBudgetPass.js` | — | 1,000,000/3,000,000 边界行为固定 | — | — |
| COMP-038 | P1 | XS | READY | test | drawcall/texture dimension/VRAM 阈值各有单测 | same | — | 每类至少 advisory+hard case | — | — |
| COMP-039 | P1 | S | READY | test | CompileQualityPass hard reason 一定导致 rejected | `CompileQualityPass.js` | — | hard 非空→status rejected | — | — |
| COMP-040 | P1 | S | READY | test | provider-only grasp evidence 永不被标 AgentScape verified | same | — | 仅 provisional reason | — | — |
| COMP-041 | P1 | XS | READY | test | ManifestPass source key 与 optimized bytes storage key 一致 | `ManifestPass.js` | — | pipeline 可反查 bytes | — | — |
| COMP-042 | P1 | S | READY | test | ManifestPass provenance 包含 compiler version + quality | same | — | manifest 可审计 | — | — |
| COMP-043 | P1 | S | DISCOVERY | research | 列出自动 joint inference 最小证据：axis/origin/limits/type | compiler docs | COMP-025 | 形成 1 页 evidence contract，不写模型调用 | — | — |
| COMP-044 | P2 | S | BLOCKED | code | 增加 `jointProposal` 纯数据 schema validator | new compiler helper | COMP-043 | invalid proposal 全部 fail-closed，不接 runtime | — | — |
| COMP-045 | P2 | S | BLOCKED | test | 用 hinge fixture 验证 jointProposal→PartProposal 的单一 promotion 条件 | compiler pass | COMP-044 | 只有证据完整候选才 promote | — | — |
| COMP-046 | P1 | S | DISCOVERY | research | 列出抓取候选提升为 runtime grasp 所需最小证据 | compiler/interaction docs | — | 明确 pose/clearance/contact/backend verification 字段 | — | — |
| COMP-047 | P2 | S | BLOCKED | code | 为 grasp evidence 建只读 schema，不接 pickup | `modules/asset/schema.js` or dedicated schema | COMP-046 | manifest 可携带但 runtime 不执行 | — | — |

## 8. Generation / Connector / Jobs / Provider Capability

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| GEN-001 | P1 | XS | READY | test | Connector endpoint 拒绝非 loopback host | `ConnectorSession.js` | — | LAN/public IP → `CONNECTOR_ENDPOINT_NOT_LOOPBACK` | — | — |
| GEN-002 | P1 | XS | READY | test | Connector endpoint 拒绝 query/hash/path/userinfo | same | — | 四类 URL fail | — | — |
| GEN-003 | P1 | XS | READY | test | requested scopes 去重并拒绝未知 scope | same | — | escalation 请求 fail | — | — |
| GEN-004 | P1 | XS | READY | test | paired response contractVersion mismatch fail | same | — | `CONNECTOR_CONTRACT_MISMATCH` | — | — |
| GEN-005 | P1 | XS | READY | test | paired response clientIdentity mismatch fail | same | — | `CONNECTOR_CLIENT_MISMATCH` | — | — |
| GEN-006 | P1 | XS | READY | test | Connector 不允许当前 origin 时 fail | same | — | `CONNECTOR_ORIGIN_MISMATCH` | — | — |
| GEN-007 | P1 | XS | READY | test | session expiresAt<=now 直接拒绝 | same | — | 不保存 token | — | — |
| GEN-008 | P1 | XS | READY | test | revoke 清空内存 token 且之后 request 失败 | `ConnectorClient.js` | — | session revoked，authorizationValue 不可用 | — | — |
| GEN-009 | P1 | XS | READY | test | caller 不能自己传 Authorization header | same | — | `CONNECTOR_AUTH_HEADER_FORBIDDEN` | — | — |
| GEN-010 | P1 | XS | READY | test | Connector path encoded `..` 被拒绝 | same | — | path escape 不发 fetch | — | — |
| GEN-011 | P1 | XS | READY | test | capability snapshot 递归拒绝 secret-like field | `ConnectorCapabilityAdapter.js` | — | nested apiKey/token fail | — | — |
| GEN-012 | P1 | XS | READY | test | snapshot connector id/instance/version 与 session 全绑定 | same | — | 任一 mismatch fail | — | — |
| GEN-013 | P1 | XS | READY | test | capability revision/hash 与 session 不同 fail | same | — | stale snapshot 不进入 registry | — | — |
| GEN-014 | P1 | XS | READY | test | expired capability snapshot fail | same | — | Registry 不被修改 | — | — |
| GEN-015 | P1 | S | READY | test | applyProviderSnapshot 替换旧 connector snapshot 不残留 capability | `providers/ProviderRegistry.js` | — | removed operation 查不到 | — | — |
| GEN-016 | P1 | XS | READY | test | Job request secret-like key 深层拒绝 | `GenerationJobProjection.js` | — | metadata/options/inputs 都覆盖 | — | — |
| GEN-017 | P1 | XS | READY | test | Job operation 必须 provider scoped + `.vN` | same | — | invalid operation fail | — | — |
| GEN-018 | P1 | XS | READY | test | terminal Job 不允许状态回退 | same | — | succeeded→running fail | — | — |
| GEN-019 | P1 | XS | READY | test | `connection_required` 可恢复到 running | same | — | transition 被允许 | — | — |
| GEN-020 | P1 | XS | READY | test | 同 event sequence 不同 facts 冲突 | `GenerationJobStore.js` | — | `JOB_EVENT_CONFLICT` | — | — |
| GEN-021 | P1 | XS | READY | test | 低于 current event sequence 的快照被视为 stale | same | — | canonical job 不回退 | — | — |
| GEN-022 | P1 | XS | READY | test | idempotencyKey 相同 requestHash 不同冲突 | same | — | `JOB_IDEMPOTENCY_CONFLICT` | — | — |
| GEN-023 | P1 | S | READY | test | `replaceAllAtomically` 任一 job 非法时旧 store 完整保留 | same | — | 0 个 partial replace | — | — |
| GEN-024 | P1 | XS | READY | test | Job submit 只允许 capability 宣告的 outputRoles | `ConnectorJobClient.js` | — | 未声明 role fail | — | — |
| GEN-025 | P1 | XS | READY | test | submit response immutable identity 必须匹配 request | same | — | provider/hash/revision 等 mismatch fail | — | — |
| GEN-026 | P1 | XS | READY | test | list response 缺 jobs[] fail-closed | same | — | store 不清空 | — | — |
| GEN-027 | P1 | S | READY | test | Reconciler bootstrap 对 active jobs 逐个恢复 | `GenerationJobReconciler.js` | — | recovered 列表包含所有 active IDs | — | — |
| GEN-028 | P1 | XS | READY | test | Connector 断线时 overlay 不改 canonical job status | same | — | canonical running + transport connection_required | — | — |
| GEN-029 | P1 | XS | READY | test | event cursor 同 sequence 同 signature 幂等 | same | — | 不二次 reconcile | — | — |
| GEN-030 | P1 | XS | READY | test | event cursor 同 sequence 不同 envelope 冲突 | same | — | `CONNECTOR_JOB_EVENT_CONFLICT` | — | — |
| GEN-031 | P1 | XS | READY | test | local image upload 只接受 PNG | `ConnectorArtifactClient.js` | — | JPEG/WebP 当前明确 unsupported | — | — |
| GEN-032 | P1 | S | READY | test | upload response hash/bytes/mime 与本地 approved bytes 复核 | `GenerationRuntime.js` | — | 任一 mismatch → `LOCAL_IMAGE_UPLOAD_INTEGRITY_MISMATCH` | — | — |
| GEN-033 | P1 | S | READY | test | local upload 注册 Artifact 后保存 local-cache verified bytes | same | GEN-032 | registry integrity=verified + persisted cache | — | — |
| GEN-034 | P1 | XS | READY | test | `approved-image` policy 下 `canGenerateAsset=false` | same | — | Agent 不再宣称 Text→3D | — | — |
| GEN-035 | P1 | XS | READY | test | `approved-image` 下 `generateAsset` 返回 image_input_required | same | GEN-034 | 不提交 Job | — | — |
| GEN-036 | P1 | S | READY | test | composed Text→Image→3D route 把 image job 设为 parent | `GenerationOrchestrator.js` | — | asset job parent.jobId=image job | — | — |
| GEN-037 | P1 | XS | READY | test | route 需要的 capability required input 无 default 时 fail | same | — | `GENERATION_CAPABILITY_INCOMPLETE` | — | — |
| GEN-038 | P1 | XS | READY | test | generation wait timeout 返回 job/provider/operation 信息 | same | — | `GENERATION_TIMEOUT` details 完整且无 secret | — | — |
| GEN-039 | P1 | S | READY | test | provider succeeded 但缺 PNG source 时 composed route fail | same | — | `GENERATION_SOURCE_ARTIFACT_INVALID` | — | — |
| GEN-040 | P1 | S | READY | test | world generation 缺 required artifact role fail | same | — | `GENERATION_WORLD_ARTIFACTS_INCOMPLETE` | — | — |
| GEN-041 | P1 | S | READY | test | world artifact import 按 role 逐个校验并缓存 | same | GEN-040 | 每个 required role integrity verified | — | — |
| GEN-042 | P1 | S | READY | test | `generateAndCompileAsset` provider-succeeded→import→compile→admission 顺序固定 | same | — | stage 状态不可跳跃 | — | — |
| GEN-043 | P1 | XS | READY | test | persisted world bundle 同 job 同 role 重复时拒绝 ambiguity | `PromptHybridWorldOrchestrator.js` | — | `GENERATED_WORLD_BUNDLE_AMBIGUOUS` | — | — |
| GEN-044 | P1 | XS | READY | test | persisted world bundle 缺 required role 拒绝 | same | — | `GENERATED_WORLD_BUNDLE_INCOMPLETE` | — | — |
| GEN-045 | P1 | S | READY | test | Hybrid World replace environment 后 WorldBuilder reject 时完全 rollback | same | — | old env + scene + authority 恢复 | — | — |
| GEN-046 | P1 | S | READY | test | Hybrid World rollback 自身失败时 AggregateError 保留双错误 | same | GEN-045 | error.code=`PROMPT_HYBRID_WORLD_ROLLBACK_FAILED` | — | — |
| GEN-047 | P1 | S | READY | test | Studio image-object resumeJobId 不重复 submit | `StudioBuildController.js` | — | existing job 只 get/reconcile | — | — |
| GEN-048 | P1 | XS | READY | test | resume Job metadata.assetId 与 draft assetId 不同则拒绝 | same | GEN-047 | 不编译错误资产 | — | — |
| GEN-049 | P1 | S | READY | verify | 固定一张小 PNG 真实跑 Connector upload→Job submit smoke | Connector + test provider | RUN-002 | 得到 jobId 且 idempotency 可重复 | — | — |
| GEN-050 | P1 | S | BLOCKED | verify | 固定 station PNG 跑 Image→3D→GLB→Asset E2E | external provider | GEN-049 | Artifact hash verified + Asset admission 输出可解释 | — | — |

## 9. Physics：不是“做一个物理引擎”，而是以下可独立领取的原子任务

> 当前事实：`PhysicsBackend` 抽象已经存在；Rapier 与 Jolt 都实现 rigid-body / articulated-body / character-controller / collision / joints / scene-query。`TransformPhysicsBackend` 是 `PhysicsBackend.js` 内的 render-only backend。这里不再创建新的 PhysicsManager，而是围绕 **contract、backend parity、PhysicsSystem 语义、character、query、contact、counterfactual** 逐步加固。

### 9.1 Backend contract 与 capability

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| PHY-001 | P1 | XS | READY | test | 固定 `PHYSICS_BACKEND_CAPABILITIES` capability 集合 | `PhysicsBackend.js` | — | capability 名称增删必须显式更新测试 | — | — |
| PHY-002 | P1 | XS | READY | test | backend capability 自动去重 | same | — | 重复输入只保留 1 个 | — | — |
| PHY-003 | P1 | XS | READY | test | backend executionModes 自动去重 | same | — | profile 无重复 mode | — | — |
| PHY-004 | P1 | XS | READY | test | backend qualities 只输出 realtime/deterministic boolean | same | — | 未声明值固定 false | — | — |
| PHY-005 | P1 | XS | READY | test | 未实现 contract method 明确指出 backend identity + method | same | — | dummy backend 调 `createBody` 得稳定错误 | — | — |
| PHY-006 | P1 | XS | READY | test | Transform backend 只宣告 render-only | same | — | 无 solver capabilities；deterministic/realtime=true | — | — |
| PHY-007 | P1 | XS | READY | test | PhysicsSystem 将 runtime capability 与 backend capability 去重合并 | `PhysicsSystem.js` | PHY-001 | `profile().capabilities` 无重复 | — | — |
| PHY-008 | P1 | XS | READY | test | 无 collision/scene-query backend 不宣称 counterfactual-query | same | PHY-007 | Transform profile 无 counterfactual-query | — | — |
| PHY-009 | P1 | XS | READY | test | render-only 由 Runtime 提供，而不是伪装成 backend solver mode | same | PHY-006 | profile 同时区分 backendExecutionModes/runtimeExecutionModes | — | — |
| PHY-010 | P1 | XS | READY | test | solverEnabled 只由 rigid-body capability 决定 | same | — | Transform=false，Rapier/Jolt=true | — | — |

### 9.2 World / Body 生命周期

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| PHY-011 | P1 | XS | READY | test | Rapier `init()` 可重复调用后仍可创建 world | `RapierPhysicsBackend.js` | — | 两次 init 不破坏 createWorld | — | — |
| PHY-012 | P1 | XS | READY | test | Jolt 未 init 时 `createWorld()` 明确失败 | `JoltPhysicsBackend.js` | — | 错误包含 init prerequisite | — | — |
| PHY-013 | P1 | XS | READY | test | `PhysicsSystem.resetWorld()` 清空 entries/provenance | `PhysicsSystem.js` | — | reset 后 counts=0 | — | — |
| PHY-014 | P1 | XS | READY | test | resetWorld 删除旧 character controller | same | PHY-013 | backend remove controller 被调用一次 | — | — |
| PHY-015 | P1 | XS | READY | test | resetWorld dispose 旧 world 后创建新 world | same | PHY-013 | 新旧 world identity 不同 | — | — |
| PHY-016 | P1 | XS | READY | test | Rapier createBody fixed 类型 round-trip | `RapierPhysicsBackend.js` | — | bodyType=`fixed` | — | — |
| PHY-017 | P1 | XS | READY | test | Rapier createBody dynamic 类型 round-trip | same | — | bodyType=`dynamic` | — | — |
| PHY-018 | P1 | XS | READY | test | Rapier createBody kinematic 类型 round-trip | same | — | bodyType=`kinematic` | — | — |
| PHY-019 | P1 | XS | READY | test | Jolt fixed/dynamic/kinematic 三种 body type round-trip | `JoltPhysicsBackend.js` | — | 三种类型逐一正确 | — | — |
| PHY-020 | P1 | XS | READY | test | body position/rotation 创建参数 round-trip | both backends | PHY-016,PHY-019 | 两 backend pose 在 tolerance 内 | — | — |
| PHY-021 | P1 | XS | READY | test | `setBodyType` fixed→dynamic→kinematic round-trip | both | PHY-020 | 类型每次立即可读 | — | — |
| PHY-022 | P1 | XS | READY | test | `setBodyPose(next=false)` 立即改变当前 pose | both | PHY-020 | current pose 更新 | — | — |
| PHY-023 | P1 | XS | READY | test | `setBodyPose(next=true)` 不提前改变 current pose | both | PHY-022 | step 前 current 不变、next 可读 | — | — |
| PHY-024 | P1 | XS | READY | test | Jolt step 消费 `nextPose` 且只消费一次 | `JoltPhysicsBackend.js` | PHY-023 | step 后 nextPose=null | — | — |
| PHY-025 | P1 | XS | READY | test | `translateBody` 只增加给定 delta | both | PHY-020 | pose delta 精确 | — | — |
| PHY-026 | P1 | XS | READY | test | `translateBody(clearLinearVelocity=true)` 清零线速度 | both | PHY-025 | linearSpeed≈0 | — | — |
| PHY-027 | P1 | XS | READY | test | `clearBodyMotion` 清零 linear + angular | both | — | 两 speed≈0 | — | — |
| PHY-028 | P1 | XS | READY | test | `bodyMotion` sleeping/speed 字段 shape parity | both | — | 两 backend 返回同 schema | — | — |
| PHY-029 | P1 | XS | READY | test | removeBody 对不存在/已删除 body 幂等 | both | — | 第二次 remove 不抛 | — | — |
| PHY-030 | P1 | S | READY | test | Jolt removeBody 同时删除相关 joint/collider semantic handles | `JoltPhysicsBackend.js` | PHY-029 | world maps 不留 handle | — | — |

### 9.3 Collider 创建、shape 与 provenance

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| PHY-031 | P1 | XS | READY | test | Rapier box collider 创建 + snapshot | `RapierPhysicsBackend.js` | — | kind=box + halfExtents 正确 | — | — |
| PHY-032 | P1 | XS | READY | test | Rapier cylinder collider 创建 + snapshot | same | — | radius/halfHeight 正确 | — | — |
| PHY-033 | P1 | XS | READY | test | Rapier capsule collider 创建 + snapshot | same | — | radius/halfHeight 正确 | — | — |
| PHY-034 | P1 | XS | READY | test | Rapier convexHull 创建 + snapshot | same | — | vertices 可回读 | — | — |
| PHY-035 | P1 | XS | READY | test | Rapier trimesh 仅允许 body collider，不进入 query-shape | same | — | createCollider 成功；createQueryShape 返回 unsupported/null | — | — |
| PHY-036 | P1 | XS | READY | test | Jolt box collider 创建 + snapshot | `JoltPhysicsBackend.js` | — | kind=box + halfExtents 正确 | — | — |
| PHY-037 | P1 | XS | READY | test | Jolt cylinder collider 创建 + snapshot | same | — | radius/halfHeight 正确 | — | — |
| PHY-038 | P1 | XS | READY | test | Jolt capsule collider 创建 + snapshot | same | — | radius/halfHeight 正确 | — | — |
| PHY-039 | P1 | XS | READY | test | Jolt convexHull 创建 + snapshot | same | — | vertices 可回读 | — | — |
| PHY-040 | P1 | XS | READY | test | Jolt trimesh 明确 unsupported，不静默丢弃 | same | — | 稳定 TypeError/code | — | — |
| PHY-041 | P1 | XS | READY | test | collider local translation 反映到 world snapshot | both | PHY-031,PHY-036 | world position 正确 | — | — |
| PHY-042 | P1 | XS | READY | test | collider local rotation 反映到 world snapshot | both | PHY-041 | quaternion 在 tolerance 内 | — | — |
| PHY-043 | P1 | XS | READY | test | 多 collider body 返回稳定创建顺序 | both | — | colliders()[i] 对应 specs[i] | — | — |
| PHY-044 | P1 | XS | READY | test | mass 在多 collider Rapier 中均分 | `RapierPhysicsBackend.js` | — | 总 mass 与请求一致 | — | — |
| PHY-045 | P1 | XS | READY | test | Jolt dynamic body `mass` 通过 ScaleToMass 生效 | `JoltPhysicsBackend.js` | — | motion mass 在 tolerance 内 | — | — |
| PHY-046 | P1 | XS | READY | test | friction 写入 backend body/collider | both | — | 查询/行为 fixture 证明值生效 | — | — |
| PHY-047 | P1 | XS | READY | test | PhysicsSystem environment collider provenance | `PhysicsSystem.js` | — | kind=environment + environmentId | — | — |
| PHY-048 | P1 | XS | READY | test | object root collider provenance | same | — | objectId + `$root` + colliderIndex | — | — |
| PHY-049 | P1 | XS | READY | test | articulated part collider provenance | same | — | objectId + partName + index | — | — |
| PHY-050 | P1 | XS | READY | test | remove body 同时清理 colliderProvenance | same | PHY-048 | provenance map 无孤儿 key | — | — |

### 9.4 Articulation / Joint

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| PHY-051 | P1 | XS | READY | test | Rapier revolute joint 创建 | `RapierPhysicsBackend.js` | — | hinge 存在且 limits 生效 | — | — |
| PHY-052 | P1 | XS | READY | test | Rapier prismatic joint 创建 | same | — | slider 存在且 limits 生效 | — | — |
| PHY-053 | P1 | XS | READY | test | Rapier parent/child joint contacts disabled | same | PHY-051 | solver 不产生 parent-child contact impulse | — | — |
| PHY-054 | P1 | XS | READY | test | Rapier setJointTarget 写 motor position | same | PHY-051 | step 后 coordinate 朝 target 收敛 | — | — |
| PHY-055 | P1 | XS | READY | test | Jolt zero joint axis 拒绝 | `JoltPhysicsBackend.js` | — | `Joint axis must be non-zero` | — | — |
| PHY-056 | P1 | XS | READY | test | Jolt revolute world-frame anchor 转换 | same | — | parent/child world points 对齐 | — | — |
| PHY-057 | P1 | XS | READY | test | Jolt prismatic world-frame axis 转换 | same | — | axis 与旋转后的 parent axis 一致 | — | — |
| PHY-058 | P1 | XS | READY | test | Jolt joint collision filter capacity 自动扩容 | same | — | >16 subgroup 不丢旧 disabled pairs | — | — |
| PHY-059 | P1 | XS | READY | test | Jolt 多 joint 同一 body pair 用引用计数 | same | — | 删除一 joint 后碰撞仍 disabled | — | — |
| PHY-060 | P1 | XS | READY | test | Jolt 最后一条 pair joint 删除后重新允许碰撞 | same | PHY-059 | pair count=0 后 EnableCollision | — | — |
| PHY-061 | P1 | XS | READY | test | Jolt `_removeJoint` 不额外 Release native constraint | same | — | 删除 joint + body 不触发 ownership crash | — | — |
| PHY-062 | P1 | XS | READY | test | Jolt setJointTarget revolute 使用 TargetAngle | same | — | hinge motor target 正确 | — | — |
| PHY-063 | P1 | XS | READY | test | Jolt setJointTarget prismatic 使用 TargetPosition | same | — | slider motor target 正确 | — | — |
| PHY-064 | P1 | S | READY | test | PhysicsSystem attach root→child part 建 body/joint 顺序 | `PhysicsSystem.js` | — | parent body 一定先于 child | — | — |
| PHY-065 | P1 | S | READY | test | nested articulated part parent body 缺失时整体 attach rollback | same | PHY-064 | created bodies 全删除 | — | — |
| PHY-066 | P1 | S | READY | test | transform-only backend 仍保存 articulation rest pose | same | — | 无 solver body 也可读 part state | — | — |
| PHY-067 | P1 | XS | READY | test | articulationState prismatic coordinate 以 rest-zero 为基准 | same | — | 移动 d → coordinate≈d | — | — |
| PHY-068 | P1 | XS | READY | test | articulationState revolute coordinate wrap 到 [-π,π] | same | — | 穿过 ±π 不产生 2π 跳变 | — | — |
| PHY-069 | P1 | XS | READY | test | articulationState tolerance hinge=.08 / slider=.03 固定 | same | — | 两种 joint tolerance 不漂移 | — | — |
| PHY-070 | P1 | S | READY | test | articulationColliderPoses hinge 围绕 child anchor 旋转 | same | PHY-068 | pivot 不漂移 | — | — |
| PHY-071 | P1 | S | READY | test | articulationColliderPoses prismatic 沿 world axis 平移 | same | PHY-067 | 位移方向/距离正确 | — | — |
| PHY-072 | P1 | XS | READY | test | invalid articulation axis 返回 checked=false 而非 NaN | same | — | reason=`JOINT_AXIS_UNAVAILABLE` | — | — |

### 9.5 Transform / Held / Carry physics

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| PHY-073 | P1 | XS | READY | test | `setPosition` root body 平移 parts 同一 delta | `PhysicsSystem.js` | PHY-064 | root/parts world delta 相同 | — | — |
| PHY-074 | P1 | XS | READY | test | beginTransform 暂时把 root body 设 kinematic | same | — | originalType 被保存 | — | — |
| PHY-075 | P1 | XS | READY | test | beginTransform 暂时把 articulated parts 设 kinematic | same | PHY-074 | 每 part originalType 保存 | — | — |
| PHY-076 | P1 | XS | READY | test | syncTransform 把 Three root pose 写回 body | same | PHY-074 | backend pose 与 object world pose 一致 | — | — |
| PHY-077 | P1 | XS | READY | test | syncTransform 把每个 part node world pose 写回 part body | same | PHY-075 | 所有 part pose 一致 | — | — |
| PHY-078 | P1 | XS | READY | test | endTransform 恢复 root 原 body type | same | PHY-074 | dynamic/fixed 均恢复 | — | — |
| PHY-079 | P1 | XS | READY | test | endTransform 恢复每个 part 原 body type并 wake | same | PHY-075 | 原类型恢复 | — | — |
| PHY-080 | P1 | XS | READY | test | setHeld(true) 保存原类型并改 kinematic | same | — | heldOriginalType 存在 | — | — |
| PHY-081 | P1 | XS | READY | test | setHeld(false) 恢复原类型并清 motion | same | PHY-080 | 释放后 speed≈0 | — | — |
| PHY-082 | P1 | XS | READY | test | transform-only setHeld 只维护语义 flag | same | — | 无 native method 调用 | — | — |
| PHY-083 | P1 | XS | READY | test | setHeldTarget 使用 next pose 而非瞬移 current pose | same | PHY-023 | step 前 current 不跳 | — | — |
| PHY-084 | P1 | XS | READY | test | anchorPose 将 local translation 正确旋转到 world | same | — | 90° yaw fixture 正确 | — | — |
| PHY-085 | P1 | XS | READY | test | anchorPose 合成 root + local quaternion | same | — | quaternion normalized | — | — |
| PHY-086 | P1 | XS | READY | test | bodyPoseClear 在无 collision backend 返回 capability unavailable | same | PHY-008 | 不伪装为 clear | — | — |
| PHY-087 | P1 | XS | READY | test | bodyPoseClear 对 articulated carry object 明确 unsupported | same | — | `CARRY_BODY_UNSUPPORTED` | — | — |
| PHY-088 | P1 | XS | READY | test | bodyPoseClear 当前只接受 capsule/cylinder carry collider | same | — | box 返回 `CARRY_COLLIDER_UNSUPPORTED` | — | — |
| PHY-089 | P1 | S | READY | test | bodyPoseClear target overlap 返回具体 blockedBy owner | same | — | `CARRY_TARGET_BLOCKED` + object id | — | — |
| PHY-090 | P1 | S | READY | test | bodyMotionClear sweep hit 返回 toi + blockedBy | same | — | `CARRY_SWEEP_BLOCKED` | — | — |
| PHY-091 | P1 | XS | READY | test | bodyMotionClear sweep clear 后仍执行 final pose overlap check | same | PHY-090 | endpoint overlap 不能漏检 | — | — |

### 9.6 Character controller / Locomotion physics

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| PHY-092 | P1 | XS | READY | test | character controller 默认 offset=.02 | both backends | — | 两 backend 同语义配置 | — | — |
| PHY-093 | P1 | XS | READY | test | 默认 autostepHeight=.3 | both | — | 0.25m step 可过、明显更高 step 被挡 | — | — |
| PHY-094 | P1 | XS | READY | test | 默认 autostepMinWidth=.2 | both | — | 过窄台阶不会错误自动登阶 | — | — |
| PHY-095 | P1 | XS | READY | test | 默认 snapToGround=.3 | both | — | 小落差 grounded 保持 | — | — |
| PHY-096 | P1 | XS | READY | test | 默认 maxSlopeClimbAngle=π/4 | both | — | 低于/高于阈值 fixture 行为分开 | — | — |
| PHY-097 | P1 | XS | READY | test | 非 kinematic body moveCharacter 返回 unavailable | both | — | success=false + code stable | — | — |
| PHY-098 | P1 | XS | READY | test | character body 多于 1 collider 明确 unavailable | both | — | 不静默选第一个 | — | — |
| PHY-099 | P1 | S | READY | test | 平地前进 movement 与 desiredTranslation 同向 | both | — | 两 backend 位移误差在 tolerance 内 | — | — |
| PHY-100 | P1 | S | READY | test | 墙体阻挡时 movement 被裁剪 | both | — | 不穿墙且 collisions 非空 | — | — |
| PHY-101 | P1 | XS | READY | test | character result `grounded` 在平地为 true | both | — | 两 backend parity | — | — |
| PHY-102 | P1 | XS | READY | test | character result collision normal 为有限 vec3 | both | — | 无 NaN/Infinity | — | — |
| PHY-103 | P1 | XS | READY | test | predicate 可忽略一个 collider | both | — | ignored collider 不阻挡 movement | — | — |
| PHY-104 | P1 | XS | READY | test | predicate 不影响非忽略 collider | both | PHY-103 | 第二障碍仍阻挡 | — | — |
| PHY-105 | P1 | XS | READY | test | cancelCharacterMovement 覆盖 pending next pose | both | PHY-023 | cancel 后 step 不继续旧 movement | — | — |
| PHY-106 | P1 | XS | READY | test | Jolt CharacterVirtual 每次 move 都 release native temporary | `JoltPhysicsBackend.js` | — | repeated 100 次无 native leak/crash | — | — |
| PHY-107 | P1 | XS | READY | test | Jolt character 支撑半径 capsule/cylinder 正确 | same | — | supporting volume radius 与 spec 一致 | — | — |
| PHY-108 | P1 | XS | READY | test | Jolt character 支撑半径 box 使用 X/Z 最小 half extent | same | — | 数值测试固定 | — | — |
| PHY-109 | P1 | XS | READY | test | Jolt convex hull 支撑半径无有效点时安全 fallback | same | — | 返回 .1，不 NaN | — | — |
| PHY-110 | P1 | S | READY | parity | Rapier/Jolt wall-blocking 结果语义 parity | physics parity tests | PHY-100 | 都 blocked，不要求逐浮点相等 | — | — |
| PHY-111 | P1 | S | READY | parity | Rapier/Jolt grounded 语义 parity | same | PHY-101 | 同一 flat-ground fixture 都 grounded | — | — |
| PHY-112 | P1 | S | READY | parity | Rapier/Jolt snap-to-ground parity | same | PHY-095 | 小台阶下降都保持可行 | — | — |
| PHY-113 | P1 | S | READY | parity | Rapier/Jolt autostep parity | same | PHY-093 | 可过/不可过案例分类一致 | — | — |
| PHY-114 | P1 | S | READY | parity | Rapier/Jolt slope limit parity | same | PHY-096 | 分类一致 | — | — |
| PHY-115 | P1 | S | READY | parity | Rapier/Jolt ignoreIds/predicate parity | same | PHY-103 | 忽略对象集行为一致 | — | — |

### 9.7 Scene Query：ray / overlap / cast / penetration

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| PHY-116 | P1 | XS | READY | test | createQueryShape box round-trip | both | — | 可用于 overlap | — | — |
| PHY-117 | P1 | XS | READY | test | createQueryShape cylinder round-trip | both | — | 可用于 overlap | — | — |
| PHY-118 | P1 | XS | READY | test | createQueryShape capsule round-trip | both | — | 可用于 overlap | — | — |
| PHY-119 | P1 | XS | READY | test | createQueryShape convexHull round-trip | both | — | 可用于 overlap | — | — |
| PHY-120 | P1 | XS | READY | test | disposeQueryShape 可重复调用/不双 free | both | PHY-116 | 第二次不 crash | — | — |
| PHY-121 | P1 | XS | READY | test | intersectionsWithShape excludeCollider 生效 | both | — | self collider 不返回 | — | — |
| PHY-122 | P1 | XS | READY | test | intersectionsWithShape excludeBody 生效 | both | — | 同 body 所有 collider 排除 | — | — |
| PHY-123 | P1 | XS | READY | test | intersections callback 返回 false 时提前停止 | both | — | 只回调首个有效命中 | — | — |
| PHY-124 | P1 | S | READY | test | castCollider 返回最小 TOI 命中 | both | — | 远近两障碍选最近 | — | — |
| PHY-125 | P1 | XS | READY | test | castCollider maxToi 截断远命中 | both | PHY-124 | >maxToi 不返回 | — | — |
| PHY-126 | P1 | XS | READY | test | raycast 零方向返回 null | both | — | 不产生 native error | — | — |
| PHY-127 | P1 | XS | READY | test | raycast maxDistance<=0 返回 null | both | — | 不查询 world | — | — |
| PHY-128 | P1 | S | READY | test | raycast 返回最近 collider 与 world-distance TOI | both | — | 距离语义一致 | — | — |
| PHY-129 | P1 | XS | READY | test | raycast predicate 可过滤近命中选择下一命中 | both | — | 近物被忽略后返回远物 | — | — |
| PHY-130 | P1 | S | READY | parity | Rapier/Jolt raycast distance parity | parity tests | PHY-128 | distance 在 tolerance 内 | — | — |
| PHY-131 | P1 | S | READY | parity | Rapier/Jolt shape-cast TOI parity | same | PHY-124 | normalized TOI 在 tolerance 内 | — | — |
| PHY-132 | P1 | S | READY | parity | Rapier/Jolt overlap classification parity | same | PHY-121 | 相同 fixture hit/no-hit 一致 | — | — |
| PHY-133 | P1 | S | READY | parity | Rapier/Jolt penetration 符号统一为负 distance | same | — | overlap depth 两 backend 都 `<0` | — | — |
| PHY-134 | P1 | S | READY | parity | Rapier/Jolt shapesIntersect boolean parity | same | — | 分离/接触/交叠 fixture 一致 | — | — |

### 9.8 Contact evidence 与 debug truth

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| PHY-135 | P1 | XS | READY | test | Rapier contact evidence 标 `solver-contact` | `RapierPhysicsBackend.js` | — | evidenceKind/impulseAvailable=true | — | — |
| PHY-136 | P1 | XS | READY | test | Rapier active contact 只统计 distance<=ε 或 impulse>ε | same | — | 分离 manifold 不误报 active | — | — |
| PHY-137 | P1 | XS | READY | test | Rapier totalImpulse 汇总全部 active contacts | same | — | fixture 数值正确 | — | — |
| PHY-138 | P1 | XS | READY | test | Jolt contact evidence 标 `geometric-contact` | `JoltPhysicsBackend.js` | — | impulseAvailable=false,totalImpulse=null | — | — |
| PHY-139 | P1 | XS | READY | test | Jolt joint-parent/child pair 从 geometric contact 中排除 | same | PHY-059 | disabled pair 不出现在 contacts | — | — |
| PHY-140 | P1 | XS | READY | test | Jolt contact penetration depth 转换为负 minDistance | same | — | depth>0 → minDistance<0 | — | — |
| PHY-141 | P1 | XS | READY | test | PhysicsSystem contact debug 去重 collider pair | `PhysicsSystem.js` | — | A-B 与 B-A 只保留一条 | — | — |
| PHY-142 | P1 | XS | READY | test | contact debug source/target 带 provenance | same | PHY-047,PHY-048 | object/environment 可定位 | — | — |
| PHY-143 | P1 | XS | READY | test | contact anchor 明确是 collider midpoint | same | — | anchorKind 固定 | — | — |
| PHY-144 | P1 | XS | READY | test | Physics debug snapshot schemaVersion=1 固定 | same | — | bodies/colliders/joints/contacts/metrics 均存在 | — | — |
| PHY-145 | P1 | XS | READY | test | Jolt debug 明确 nativeGeometryAvailable=false | `JoltPhysicsBackend.js` | — | 不伪装 native debug geometry | — | — |
| PHY-146 | P1 | XS | READY | test | Rapier debug nativeGeometry=false 时不调用 debugRender | `RapierPhysicsBackend.js` | — | probe 可禁用昂贵 geometry | — | — |

### 9.9 Physics → Navigation obstacle projection

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| PHY-147 | P1 | XS | READY | test | box collider 投影到 nav obstacle AABB | `PhysicsSystem.js` | — | center/halfExtents 正确 | — | — |
| PHY-148 | P1 | XS | READY | test | rotated box 使用 conservative world AABB | same | — | 不低估旋转后的 footprint | — | — |
| PHY-149 | P1 | XS | READY | test | cylinder obstacle AABB 考虑 world rotation | same | — | y-axis 倾斜不低估 | — | — |
| PHY-150 | P1 | XS | READY | test | capsule obstacle AABB 考虑 world rotation | same | — | footprint conservative | — | — |
| PHY-151 | P1 | XS | READY | test | convexHull obstacle 从 transformed vertices 算 AABB | same | — | bounds 与 fixture 一致 | — | — |
| PHY-152 | P1 | XS | READY | test | nav obstacle ID 稳定为 object:part:colliderIndex | same | — | 同 collider pose 改变不改 ID | — | — |
| PHY-153 | P1 | XS | READY | test | held object 是否进入 nav obstacle 的当前策略固定 | same | — | 测试明确当前语义，不随实现漂移 | — | — |
| PHY-154 | P1 | XS | READY | test | environment colliders 不作为 dynamic obstacle 重复投影 | same | — | 静态环境不进入动态列表 | — | — |

### 9.10 Counterfactual physics

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| PHY-155 | P1 | XS | READY | test | articulation sample count 小 delta 仍不少于 minSamples | `PhysicsSystem.js` | — | >=5 | — | — |
| PHY-156 | P1 | XS | READY | test | articulation sample count 大 delta 不超过 maxSamples | same | — | <=33 | — | — |
| PHY-157 | P1 | XS | READY | test | sample count 缺 part/coordinate 时返回 checked=false | same | — | reason 稳定 | — | — |
| PHY-158 | P1 | S | READY | test | hinge counterfactual 采样覆盖 current→target 两端 | same | PHY-155 | samples 含 0 与 1 endpoint | — | — |
| PHY-159 | P1 | S | READY | test | prismatic counterfactual 采样覆盖完整行程 | same | PHY-155 | 无跳段 | — | — |
| PHY-160 | P1 | S | READY | test | 单 blocker sweep 返回 firstBlockedSample | same | — | blocker + sample index 可解释 | — | — |
| PHY-161 | P1 | S | READY | test | parent joint-connected collider 不作为 blocker | same | PHY-139 | parent contact 不误阻塞动作 | — | — |
| PHY-162 | P1 | S | READY | test | 第三对象 blocker 仍能 veto articulation | same | — | blockedBy 指向第三对象 | — | — |
| PHY-163 | P1 | XS | READY | test | counterfactual 不 mutate live body pose | same | — | before/after pose 完全相同 | — | — |
| PHY-164 | P1 | XS | READY | test | query temporary shape 全部 finally dispose | same | — | success/failure 都无临时 shape leak | — | — |
| PHY-165 | P1 | S | READY | parity | Rapier/Jolt counterfactual clear/blocked 分类 parity | parity tests | PHY-160 | 同 fixture 分类一致 | — | — |
| PHY-166 | P1 | S | READY | parity | Rapier/Jolt 第三对象 veto parity | same | PHY-162 | blockedBy semantic owner 一致 | — | — |
| PHY-167 | P1 | S | READY | test | counterfactual evidence geometry 标出 backend + query kind | same | — | evidence 不冒充 live simulation | — | — |
| PHY-168 | P2 | S | DISCOVERY | research | 定义 counterfactual convergence 误差指标 | physics docs/tests | PHY-165 | 写出位置/TOI/depth/classification 4 个 tolerance | — | — |
| PHY-169 | P2 | S | BLOCKED | test | 把 convergence tolerance 变成跨 backend regression gate | parity tests | PHY-168 | CI 可判定 pass/fail | — | — |

### 9.11 Physics 后续能力：先定义证据，再决定是否实现

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| PHY-170 | P2 | S | DISCOVERY | research | 盘点现有 manifest 对 restitution/damping/gravityScale 的表达缺口 | `modules/asset/schema.js`,`PhysicsBackend.js` | — | 输出字段候选+backend 支持矩阵 | — | — |
| PHY-171 | P2 | S | BLOCKED | contract | 若 PHY-170 证明必要，仅给 Manifest 增 1 个物理字段并做 schema test | `modules/asset/schema.js` | PHY-170 | 一次只加一个字段 | — | — |
| PHY-172 | P3 | S | DISCOVERY | research | Soft-body 能力只做 backend feasibility spike | physics experiment | — | 记录 Rapier/Jolt/WebGPU 可选路径，不改 production | — | — |
| PHY-173 | P3 | S | DISCOVERY | research | Cloth 能力只做 1 张 10×10 grid benchmark | physics experiment | — | 得到 frame time/memory/solver stability 数据 | — | — |
| PHY-174 | P3 | S | DISCOVERY | research | fluid 不进入 PhysicsSystem 前先定义 Runtime capability contract | docs | — | 明确它是否 solver、visual 或 environment field | — | — |
| PHY-175 | P2 | S | DISCOVERY | research | 多角色物理碰撞层需求矩阵 | docs/tests | — | agent/held/static/dynamic/environment 至少 5 类 pair policy | — | — |

## 10. Navigation / Recast / TileCache

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| NAV-001 | P1 | XS | READY | test | `invalidate()` 将 static dirty 且记录 reason | `NavigationSystem.js` | — | status 可观察 dirty/reason | — | — |
| NAV-002 | P1 | XS | READY | test | dynamic body spawn 不触发 static navmesh rebuild | same | — | build count 不增加 | — | — |
| NAV-003 | P1 | XS | READY | test | fixed body spawn 触发 static invalidation | same | — | 下一次 query rebuild | — | — |
| NAV-004 | P1 | XS | READY | test | fixed body remove 触发 static invalidation | same | — | stale mesh 不继续使用 | — | — |
| NAV-005 | P1 | XS | READY | test | fixed body transform 触发 static invalidation | same | — | 新 path 反映新障碍 | — | — |
| NAV-006 | P1 | XS | READY | test | articulated/dynamic transform 只走 obstacle reconcile | same | — | static build count 不变 | — | — |
| NAV-007 | P1 | XS | READY | test | `ensureBuilt()` 并发调用共享同一 build promise | same | — | backend.build 只执行一次 | — | — |
| NAV-008 | P1 | XS | READY | test | build 失败后 pending promise 被清理 | same | NAV-007 | 下一次 ensureBuilt 可重试 | — | — |
| NAV-009 | P1 | XS | READY | test | dispose 发生在 build pending 时不安装过期 navmesh | same | NAV-007 | disposed system 保持 unavailable | — | — |
| NAV-010 | P1 | XS | READY | test | collectStaticMeshes 只收 environment + fixed records | same | — | dynamic/kinematic 不进 static geometry | — | — |
| NAV-011 | P1 | XS | READY | test | static mesh world transform 被 bake | same | — | translated mesh vertices 正确 | — | — |
| NAV-012 | P1 | XS | READY | test | 无 triangle mesh 时 build 返回明确 unavailable | same | — | 不创建空 query | — | — |
| NAV-013 | P1 | XS | READY | test | dynamic obstacle stable ID 不随 pose 改变 | same | PHY-152 | 同对象更新映射为 update 而非 remove+add | — | — |
| NAV-014 | P1 | XS | READY | test | 新 obstacle 触发 queue add | same | — | operations.add=1 | — | — |
| NAV-015 | P1 | XS | READY | test | pose changed obstacle 触发 update | same | NAV-013 | operations.update=1 | — | — |
| NAV-016 | P1 | XS | READY | test | 消失 obstacle 触发 remove | same | — | operations.remove=1 | — | — |
| NAV-017 | P1 | S | READY | test | obstacle reconcile 失败保留旧 snapshot 以便重试 | same | — | 下次 ensureCurrent 仍能重放差异 | — | — |
| NAV-018 | P1 | XS | READY | test | TileCache 单次 flush 不超过内部安全批量 | `RecastNavigationBackend.js` | — | 70 obstacles 可分批完成 | — | — |
| NAV-019 | P1 | S | READY | test | 70 个 obstacle add 最终全部进入 TileCache | same | NAV-018 | sync success 且数量=70 | — | — |
| NAV-020 | P1 | S | READY | test | add/update/remove 混合队列最终一致 | same | NAV-018 | backend snapshot 与 descriptors 相同 | — | — |
| NAV-021 | P1 | XS | READY | test | duplicate obstacle descriptor ID fail-closed | same | — | 不产生 ambiguous cache state | — | — |
| NAV-022 | P1 | XS | READY | test | obstacle size 非有限/非正值被拒绝 | same | — | backend 不接收 NaN/0 box | — | — |
| NAV-023 | P1 | XS | READY | test | path start off-navmesh 返回 `START_OFF_NAVMESH` | `NavigationSystem.js` | — | 与 NO_PATH 分离 | — | — |
| NAV-024 | P1 | XS | READY | test | path end off-navmesh 返回 `END_OFF_NAVMESH` | same | — | 与 NO_PATH 分离 | — | — |
| NAV-025 | P1 | XS | READY | test | 两端有效但不可达返回 `NO_PATH` | same | — | endpoint projection 仍 valid | — | — |
| NAV-026 | P1 | XS | READY | test | path 未到 endTolerance 返回 partial/明确状态 | same | — | 不误报 arrived | — | — |
| NAV-027 | P1 | XS | READY | test | maxSnapDistance 影响 query half extents 但保持正有限 | same | — | 0/负数输入有规范化 | — | — |
| NAV-028 | P1 | XS | READY | test | suppressedObstacleIds 只在 query scope 生效 | same | — | query 后 TileCache canonical obstacles 不变 | — | — |
| NAV-029 | P1 | S | READY | test | `suggestActions` 只对 actionable dynamic obstacle 做 counterfactual | same | — | environment/static obstacle 不被建议搬走 | — | — |
| NAV-030 | P1 | S | READY | test | suppress 单个 blocker 后有路则建议对应 action | same | NAV-029 | suggestion 带 blocker id + improved route | — | — |
| NAV-031 | P1 | S | READY | test | suppress blocker 仍无路时不生成虚假建议 | same | NAV-030 | suggestions 不含无效 candidate | — | — |
| NAV-032 | P1 | XS | READY | test | `canReach()` 只包装 path 可达语义 | same | — | reachable 与 findPath status 一致 | — | — |
| NAV-033 | P1 | XS | READY | test | debugSnapshot 输出 build revision/obstacle count | same | — | 可定位当前 nav truth | — | — |
| NAV-034 | P1 | XS | READY | test | Recast `clear()` 可重复调用 | `RecastNavigationBackend.js` | — | 第二次不抛/无旧 native ref | — | — |
| NAV-035 | P1 | XS | READY | test | Recast library load 并发只初始化一次 | same | — | init promise dedupe | — | — |
| NAV-036 | P1 | S | READY | test | rawRoute waypoint 顺序 start→end 固定 | same | — | 不倒序、不重复相邻点 | — | — |
| NAV-037 | P1 | XS | READY | test | queryRoute suppressed IDs 不修改 canonical obstacle map | same | NAV-028 | before/after map 相同 | — | — |
| NAV-038 | P2 | S | DISCOVERY | research | 定义 off-mesh link 最小 contract | `docs/navigation.md` | — | start/end/type/cost/requiredCapability 字段明确 | — | — |
| NAV-039 | P2 | S | BLOCKED | contract | 为 navigation artifact 增加 off-mesh link schema validator | nav schema | NAV-038 | 只验证，不执行 | — | — |
| NAV-040 | P2 | S | DISCOVERY | research | 定义 Recast Crowd 是否归 Navigation 或 Locomotion | docs | — | ownership decision + rejection alternatives | — | — |
| NAV-041 | P2 | S | DISCOVERY | research | 记录 Grand Urban Block 当前 navmesh build time | experiment | RUN-002 | cold/warm 两个数 + triangle count | — | — |
| NAV-042 | P2 | S | BLOCKED | experiment | 尝试 tile-level incremental static rebuild spike | tooling experiment | NAV-041 | 只输出 feasibility/perf，不接 production | — | — |

## 11. Locomotion：Path → Character Movement → Arrival

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| LOC-001 | P1 | XS | READY | test | navigate 缺对象返回 missing/明确错误 | `LocomotionSystem.js` | — | 不创建 task | — | — |
| LOC-002 | P1 | XS | READY | test | navigate 调 Navigation.findPath 一次 | same | — | path failure 不创建 movement task | — | — |
| LOC-003 | P1 | XS | READY | test | start off-navmesh 原样传播给 caller | same | NAV-023 | status 不被改写成 generic failed | — | — |
| LOC-004 | P1 | XS | READY | test | end off-navmesh 原样传播 | same | NAV-024 | 状态保真 | — | — |
| LOC-005 | P1 | XS | READY | test | no-path 原样传播 | same | NAV-025 | 状态保真 | — | — |
| LOC-006 | P1 | XS | READY | test | speed<=0 拒绝或规范化为安全正值 | same | — | 不出现除零/反向无限循环 | — | — |
| LOC-007 | P1 | XS | READY | test | waypointTolerance<=0 有明确规范化 | same | — | finite positive tolerance | — | — |
| LOC-008 | P1 | XS | READY | test | timeout<=0 立即/明确失败 | same | — | 不创建永不结束 task | — | — |
| LOC-009 | P1 | XS | READY | test | navigate 同一 actor 新任务会取消旧任务 | same | — | old promise 得到 CANCELLED/REPLACED | — | — |
| LOC-010 | P1 | XS | READY | test | status 无 task 时返回 stable idle/missing shape | same | — | UI 可安全读取 | — | — |
| LOC-011 | P1 | XS | READY | test | update dt=0 不推进 waypoint | same | — | pose 不变 | — | — |
| LOC-012 | P1 | XS | READY | test | waypoint 到 tolerance 内递增 index | same | — | 不多走一个 frame | — | — |
| LOC-013 | P1 | XS | READY | test | 最后 waypoint 到达返回 `arrived` | same | — | promise resolve 一次 | — | — |
| LOC-014 | P1 | XS | READY | test | Physics moveCharacter failure 传播 `PHYSICS_BLOCKED` | same | — | blocker details 可观察 | — | — |
| LOC-015 | P1 | S | READY | test | movement 被墙裁成近零时判 blocked 而非无限等待 | same | PHY-100 | bounded frames 后结束 | — | — |
| LOC-016 | P1 | XS | READY | test | grounded/collisions 保存到 locomotion status | same | — | status 包含最新 physics evidence | — | — |
| LOC-017 | P1 | XS | READY | test | timeout 到达时 cancel pending character movement | same | PHY-105 | next pose 被覆盖 | — | — |
| LOC-018 | P1 | XS | READY | test | `cancel(id)` resolve 当前 task 一次 | same | — | 再 cancel 返回 false/noop | — | — |
| LOC-019 | P1 | XS | READY | test | `cancelAll()` 结束所有 actors | same | — | task map empty | — | — |
| LOC-020 | P1 | XS | READY | test | Runtime dispose 调 cancelAll | WorldRuntime | LOC-019 | 无悬挂 promise | — | — |
| LOC-021 | P1 | S | READY | test | dynamic blocker 移动后下一次 navigate 使用新 nav obstacle truth | nav+loc test | NAV-015 | 新路线反映 blocker 新位置 | — | — |
| LOC-022 | P2 | S | DISCOVERY | research | 定义“移动中路径失效”检测信号 | docs/tests | — | blocker/path revision/timeout 三类 trigger 明确 | — | — |
| LOC-023 | P2 | S | BLOCKED | code | 增加只在当前 waypoint blocked 时触发一次 replan | `LocomotionSystem.js` | LOC-022 | 单次 bounded replan，无循环 | — | — |
| LOC-024 | P2 | S | BLOCKED | test | replan 后仍 blocked 返回最终可解释状态 | same | LOC-023 | attempts/reason 可读 | — | — |
| LOC-025 | P2 | S | DISCOVERY | research | 两 agent 相向行走的最小 collision/avoidance fixture | tests/experiment | PHY-175 | 只建立 failing/behavior baseline | — | — |

## 12. Spatial：几何观察、Support、Inside、Free-space

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| SPA-001 | P1 | XS | READY | test | snapshot 一次更新所有 object matrixWorld | `SpatialSystem.js` | — | 后续 query 使用同 revision geometry | — | — |
| SPA-002 | P1 | XS | READY | test | getBounds 未知 id 返回 null/明确错误 | same | — | caller 不崩 | — | — |
| SPA-003 | P1 | XS | READY | test | getBounds nested mesh 使用 world transform | same | — | translated/rotated fixture bounds 正确 | — | — |
| SPA-004 | P1 | XS | READY | test | getBounds 空 Group 有稳定行为 | same | — | 不返回 Infinity bounds | — | — |
| SPA-005 | P1 | XS | READY | test | findNearby 排除自身 | same | — | result 无 query id | — | — |
| SPA-006 | P1 | XS | READY | test | findNearby 按距离升序稳定排序 | same | — | 等距时用 id tie-break | — | — |
| SPA-007 | P1 | XS | READY | test | radius<0 拒绝/规范化 | same | — | 不返回全世界 | — | — |
| SPA-008 | P1 | XS | READY | test | raycast direction 零向量 fail/null | same | — | 无 NaN ray | — | — |
| SPA-009 | P1 | XS | READY | test | raycast 返回 instance root id 而非 child mesh 名 | same | — | nested mesh hit → object id | — | — |
| SPA-010 | P1 | XS | READY | test | raycast maxDistance 截断远物体 | same | — | 远 hit 不返回 | — | — |
| SPA-011 | P1 | XS | READY | test | isColliding ignore IDs 生效 | same | — | ignored overlap 不计 | — | — |
| SPA-012 | P1 | XS | READY | test | isColliding margin 正负边界有规范化 | same | — | 负 margin 不扩大 box | — | — |
| SPA-013 | P1 | XS | READY | test | touching AABB 在默认 margin 下语义固定 | same | — | contact/overlap classification 有测试 | — | — |
| SPA-014 | P1 | XS | READY | test | support surface 必须来自 manifest 声明 | same | — | 未声明 surface 不启发式猜 | — | — |
| SPA-015 | P1 | XS | READY | test | support surface local center/size 转 world bounds | same | — | rotated support fixture 正确/或明确不支持 rotation | — | — |
| SPA-016 | P1 | XS | READY | test | getReceptacle 默认选择规则稳定 | same | — | 未给 ID 时行为固定 | — | — |
| SPA-017 | P1 | XS | READY | test | receptacle ID 不存在返回明确 unavailable | same | — | 不 fallback 到另一个 receptacle | — | — |
| SPA-018 | P1 | XS | READY | test | insideStatus subject 完全在 receptacle 内=true | same | — | fixture verified | — | — |
| SPA-019 | P1 | XS | READY | test | insideStatus 越界一个 axis=false | same | — | reason/axis 可解释 | — | — |
| SPA-020 | P1 | XS | READY | test | inside tolerance 仅作用边界，不允许无限大 | same | — | 非有限 tolerance 拒绝 | — | — |
| SPA-021 | P1 | XS | READY | test | findFreeSpaceInside grid=1 检查中心候选 | same | — | clear 时返回中心 | — | — |
| SPA-022 | P1 | XS | READY | test | findFreeSpaceInside grid 非正整数规范化 | same | — | bounded candidate count | — | — |
| SPA-023 | P1 | S | READY | test | free-space poseClear callback 可 veto 几何候选 | same | — | callback false 候选被跳过 | — | — |
| SPA-024 | P1 | XS | READY | test | supportStatus 垂直 gap 超 tolerance=false | same | — | gap 数值可读 | — | — |
| SPA-025 | P1 | XS | READY | test | supportStatus 水平 footprint 不重叠=false | same | — | 不仅看 Y 高度 | — | — |
| SPA-026 | P1 | XS | READY | test | findFreeSpace 默认 grid=5 候选数有上限 | same | — | 不随 surface 无限搜索 | — | — |
| SPA-027 | P1 | S | READY | test | findFreeSpace 避开现有 object bounds | same | — | 返回无 overlap candidate | — | — |
| SPA-028 | P1 | S | READY | test | free-space ignore held object 可用于 place planning | same | — | held id 不阻挡自身 release candidate | — | — |
| SPA-029 | P1 | S | READY | test | SceneGraph ON 关系由 supportStatus 派生 | `SceneGraph.js` | SPA-024 | 关系与几何一致 | — | — |
| SPA-030 | P1 | S | READY | test | SceneGraph INSIDE 关系由 insideStatus 派生 | same | SPA-018 | 关系与几何一致 | — | — |
| SPA-031 | P1 | XS | READY | test | SceneGraph NEAR 距离阈值边界固定 | same | — | threshold 上/下分类明确 | — | — |
| SPA-032 | P1 | XS | READY | test | relation refresh 后移除过期 ON/INSIDE | same | — | 物体移走后旧 relation 消失 | — | — |
| SPA-033 | P2 | S | DISCOVERY | research | 定义 OBB/convex spatial query 是否值得替换 AABB | experiment | — | 对 3 个 rotated fixtures 量误差/成本 | — | — |

## 13. Interaction：Approach / Open / Pickup / Carry / Place / Recovery

### 13.1 通用状态与 ownership

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| INT-001 | P1 | XS | READY | test | setHumanViewPose null 清空观察视角 | `InteractionSystem.js` | — | debug 不继续使用旧 pose | — | — |
| INT-002 | P1 | XS | READY | test | setHumanViewPose 拒绝非有限 pose | same | — | 不写 NaN | — | — |
| INT-003 | P1 | XS | READY | test | `isHeld` 以 ObjectStore heldBy 为 truth | same | — | agentHeld cache 不可单独伪造 held | — | — |
| INT-004 | P1 | XS | READY | test | heldByAgent 无持有返回 null | same | — | stable API | — | — |
| INT-005 | P1 | XS | READY | test | rebuildHeldOwnership 从 store 重建 actor→object | same | — | restore 后 cache 正确 | — | — |
| INT-006 | P1 | XS | READY | test | 同 actor 多个 held objects 的损坏状态 fail/reconcile | same | — | 不静默选随机对象 | — | — |
| INT-007 | P1 | XS | READY | test | beforeRemove 被持有物体先 release ownership | same | RT-008 | remove 后 actor 空手 | — | — |
| INT-008 | P1 | XS | READY | test | cancelPending 结束 articulation + settle pending tasks | same | — | pending maps 为空 | — | — |
| INT-009 | P1 | XS | READY | test | supports 只读 manifest.actions | same | — | 不通过 node name 猜 action | — | — |
| INT-010 | P1 | XS | READY | test | assertSupports 未声明 action 返回 ACTION_UNSUPPORTED | same | — | 稳定 code | — | — |

### 13.2 人类编辑 pickup/drop/place

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| INT-011 | P1 | XS | READY | test | pickup 未声明 pickup action 拒绝 | same | INT-010 | scene 不 mutate | — | — |
| INT-012 | P1 | XS | READY | test | pickup 已被其他 actor 持有拒绝 | same | — | heldBy 不被覆盖 | — | — |
| INT-013 | P1 | XS | READY | test | pickup 成功写 heldBy + Physics.setHeld | same | PHY-080 | store/physics truth 一致 | — | — |
| INT-014 | P1 | XS | READY | test | drop 无 held object 返回 noop/明确状态 | same | — | 不抛 generic error | — | — |
| INT-015 | P1 | XS | READY | test | drop 成功清 heldBy + Physics release | same | PHY-081 | 双 truth 一致 | — | — |
| INT-016 | P1 | S | READY | test | place 使用 Spatial.findFreeSpace 生成位置 | same | SPA-027 | 位置在 support 且 clear | — | — |
| INT-017 | P1 | S | READY | test | place 无 free space 时保持 held 状态 | same | INT-016 | mutation rollback | — | — |
| INT-018 | P1 | S | READY | test | placeInside 使用 receptacle free-space | same | SPA-023 | insideStatus=true | — | — |
| INT-019 | P1 | S | READY | test | placeInside 失败时 object 仍 held | same | INT-018 | ownership 不丢 | — | — |

### 13.3 Interaction pose / 可达性

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| INT-020 | P1 | XS | READY | test | actorBoxAt 使用 actor 当前 manifest bounds | same | — | box size 与 agent collider/bounds 一致 | — | — |
| INT-021 | P1 | XS | READY | test | interactionStatusAt 超 maxDistance=false | same | — | reason=`OUT_OF_RANGE`/当前稳定 reason | — | — |
| INT-022 | P1 | XS | READY | test | target 被遮挡时 LOS 状态不可交互 | same | — | blocker id 可观察 | — | — |
| INT-023 | P1 | XS | READY | test | ignoreIds 可忽略 held object LOS/blocking | same | — | self-carry 不阻挡 actor | — | — |
| INT-024 | P1 | XS | READY | test | allowClearEndpoint 仅放宽终点接触，不放宽中间 sweep | same | — | wall still blocks | — | — |
| INT-025 | P1 | S | READY | test | findInteractionPose 生成 bounded candidate 数 | same | — | 没有无界 spiral/search | — | — |
| INT-026 | P1 | S | READY | test | candidateFilter 可 veto stance | same | — | veto candidate 不返回 | — | — |
| INT-027 | P1 | S | READY | test | actionSweepBounds 将 open/close part sweep 纳入 stance filter | same | — | actor 不站在门扫掠区 | — | — |
| INT-028 | P1 | XS | READY | test | 无合法 interaction pose 返回可解释 reason | same | — | 不返回 arbitrary target center | — | — |
| INT-029 | P1 | S | READY | test | findInteractionPose 同时满足 Nav reachability + interactionStatus | same | NAV-032 | 返回 pose 两个 gate 都 pass | — | — |

### 13.4 Approach + open/close

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| INT-030 | P1 | S | READY | test | approachAndInteract 先找 pose 再 navigate | same | INT-029 | 调用顺序固定 | — | — |
| INT-031 | P1 | XS | READY | test | navigate 失败时绝不调用 articulation action | same | LOC-014 | target state 不变 | — | — |
| INT-032 | P1 | XS | READY | test | 到达后重新验证 interactionStatus | same | — | stale pose 不直接执行 | — | — |
| INT-033 | P1 | XS | READY | test | findPartForAction 显式 partName 优先 | same | — | 指定 part 不被自动候选替换 | — | — |
| INT-034 | P1 | XS | READY | test | 找不到支持 action 的 part 返回 unsupported | same | — | 不驱动未知 joint | — | — |
| INT-035 | P1 | XS | READY | test | setArticulationAction target 来自 manifest articulationTargets | same | ASSET-008 | 不由 LLM 提供数值 | — | — |
| INT-036 | P1 | XS | READY | test | articulation task key object+part 唯一 | same | — | 不同 part 可并行区分 | — | — |
| INT-037 | P1 | XS | READY | test | 同 part 新 articulation action 替换/拒绝旧 task 语义固定 | same | — | 不存在两个 motor owner | — | — |
| INT-038 | P1 | S | READY | test | updateArticulationTasks 在 target tolerance 内完成 | same | PHY-069 | result=`action-completed` | — | — |
| INT-039 | P1 | S | READY | test | articulation timeout/failure 输出 coordinate/target/error | same | — | failure attribution 有数值证据 | — | — |
| INT-040 | P1 | S | READY | test | completion 只有 runtime measured coordinate 后才 promote verified | same | — | provider/compiler evidence 不够 | — | — |
| INT-041 | P1 | S | READY | test | open counterfactual blocked 时不启动 live motor | same | PHY-160 | 直接返回 blocked/recovery | — | — |
| INT-042 | P1 | S | READY | test | third-object counterfactual blocker 暴露 blockerId | same | PHY-162 | recovery 可消费 | — | — |

### 13.5 Pickup / Carry

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| INT-043 | P1 | XS | READY | test | assertAgentCarryable 检查 pickup capability | same | — | unsupported 不进入 plan | — | — |
| INT-044 | P1 | XS | READY | test | assertAgentCarryable 检查 target 未被持有 | same | — | ownership conflict 可解释 | — | — |
| INT-045 | P1 | XS | READY | test | holdAnchor 使用 manifest anchor 或稳定 fallback | same | — | anchor 来源可识别 | — | — |
| INT-046 | P1 | XS | READY | test | carryStandOff 根据 actor/held bounds 计算有限距离 | same | — | 不出现负距离 | — | — |
| INT-047 | P1 | XS | READY | test | holdPoseAt yaw 旋转 anchor 正确 | same | PHY-084 | world hold pose 正确 | — | — |
| INT-048 | P1 | XS | READY | test | reorientHeldToward 单帧 yaw 不超过 maxStep | same | — | 大角度分帧旋转 | — | — |
| INT-049 | P1 | XS | READY | test | pickupSupportIds 收集当前 ON support | same | SPA-029 | support ids 稳定 | — | — |
| INT-050 | P1 | XS | READY | test | pickupStanceBounds 排除 support footprint 危险区 | same | — | agent stance 不压入桌体 | — | — |
| INT-051 | P1 | S | READY | test | findPickupPlan 包含 interactionPose + anchor + support context | same | — | plan 字段完整 | — | — |
| INT-052 | P1 | S | READY | test | transferPickupToAnchor 分阶段检查 direct/sweep/final pose | same | PHY-090 | 任一 phase block 返回对应 evidence | — | — |
| INT-053 | P1 | S | READY | test | transfer 失败后 object pose/held state rollback | same | INT-052 | no partial pickup | — | — |
| INT-054 | P1 | S | READY | test | approachAndPickup navigate→revalidate→transfer 顺序 | same | INT-051 | 阶段顺序固定 | — | — |
| INT-055 | P1 | S | READY | test | pickup 成功后 `carryStatus` target/heldBy/pose 有一致 truth | same | INT-054 | status=held | — | — |
| INT-056 | P1 | XS | READY | test | Runtime update 每帧将 held object 追随 actor anchor | same | — | next pose 更新 | — | — |
| INT-057 | P1 | XS | READY | test | carry movement 遇 blocker 不允许 held object穿墙 | same | PHY-090 | actor/held transfer 被阻挡或调整 | — | — |

### 13.6 Place / settle

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| INT-058 | P1 | S | READY | test | approachAndPlace 未持有物体时 fail-fast | same | — | 不导航到 support | — | — |
| INT-059 | P1 | S | READY | test | approachAndPlace 先找 support free-space | same | SPA-027 | 无位置不移动 actor | — | — |
| INT-060 | P1 | S | READY | test | release transfer 做 sweep + final pose clearance | same | PHY-091 | blocked 时仍 held | — | — |
| INT-061 | P1 | XS | READY | test | release 成功后 body type 恢复 dynamic | same | PHY-081 | Physics truth 正确 | — | — |
| INT-062 | P1 | XS | READY | test | waitForObjectSettle linear threshold=.04 默认固定 | same | — | 边界测试 | — | — |
| INT-063 | P1 | XS | READY | test | waitForObjectSettle angular threshold=.12 默认固定 | same | — | 边界测试 | — | — |
| INT-064 | P1 | XS | READY | test | stableDuration=.35 连续稳定而非累计离散稳定 frame | same | — | 中间抖动会重置稳定计时 | — | — |
| INT-065 | P1 | XS | READY | test | settle timeout=4s 返回 timeout reason | same | — | pending task 被清理 | — | — |
| INT-066 | P1 | S | READY | test | placement settle 完成后复核 supportStatus | same | SPA-024 | supportVerified=true 才 completed | — | — |
| INT-067 | P1 | S | READY | test | settle 后滑出 support 返回未验证 | same | INT-066 | 不误报 placed | — | — |
| INT-068 | P1 | XS | READY | test | finishPlacementSettle promise 只 resolve 一次 | same | — | map cleanup | — | — |

### 13.7 Recovery / blocker cleanup

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| INT-069 | P1 | XS | READY | test | markRecoveryHeld 保存 blocker/target/part/action lineage | same | — | status 可回读 | — | — |
| INT-070 | P1 | XS | READY | test | cleanupReleaseCandidates bounded candidate 数 | same | — | 不无限搜索 | — | — |
| INT-071 | P1 | S | READY | test | cleanup candidate 必须满足 free pose + sweep clearance | same | PHY-090 | blocked candidate 被拒绝 | — | — |
| INT-072 | P1 | S | READY | test | cleanup plan 优先释放 recovery-held blocker | same | — | blocker identity 保持 | — | — |
| INT-073 | P1 | S | READY | test | cleanup plan 无安全 release 时返回明确 unresolved | same | — | 不随意 drop | — | — |
| INT-074 | P1 | S | READY | test | cleanupRecoveryBlocker 必须先 navigate 到安全释放位 | same | — | nav fail 不 release | — | — |
| INT-075 | P1 | S | READY | test | cleanup release 后等待 settle | same | — | settled 后才清 recovery held | — | — |
| INT-076 | P1 | XS | READY | test | dropHeld 正常 drop 也走 settle evidence | same | — | result 包含 settled | — | — |
| INT-077 | P1 | S | READY | test | articulationFailureAttribution 区分 blocked/timeout/coordinate mismatch | same | — | 三类 code 分离 | — | — |
| INT-078 | P1 | S | READY | test | recovery cleanup 后重新验证原 articulation counterfactual | same | PHY-160 | blocker 清走才继续 action | — | — |
| INT-079 | P1 | S | READY | test | recovery 失败保持 unresolved mutation 证据 | agent+interaction | — | Agent 不能直接声称完成 | — | — |
| INT-080 | P2 | S | DISCOVERY | research | 定义 grasp pose runtime verification 最小 fixture | docs/tests | COMP-046 | 碰撞/接触/可达/持有四项条件 | — | — |
| INT-081 | P3 | S | DISCOVERY | research | 定义 IK 是否属于 InteractionSystem 或 Actor controller | docs | — | ownership 决策，不写 IK engine | — | — |
| INT-082 | P3 | S | DISCOVERY | research | 定义 force/torque interaction evidence schema | docs | — | 不改 current open/pickup semantics | — | — |

## 14. World IR / Revision / Compiler / Verification

### 14.1 World IR schema 与引用完整性

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| WIR-001 | P1 | XS | READY | test | WorldIR 顶层拒绝未知字段 | `modules/world/spec/WorldIR.js` | — | unknown key fail-closed | — | — |
| WIR-002 | P1 | XS | READY | test | schemaVersion 非支持版本拒绝 | same | — | v0/v2 都明确错误 | — | — |
| WIR-003 | P1 | XS | READY | test | revision.id 必填且非空 | same | — | 缺/空 fail | — | — |
| WIR-004 | P1 | XS | READY | test | provenance 必须保留 planner/source lineage | same | — | 关键字段缺失 fail | — | — |
| WIR-005 | P1 | XS | READY | test | entity id 唯一 | same | — | duplicate id fail | — | — |
| WIR-006 | P1 | XS | READY | test | entity assetId 必填 | same | — | 不产生无资产实体 | — | — |
| WIR-007 | P1 | XS | READY | test | entity position 只接受有限 vec3 | same | — | NaN/Infinity fail | — | — |
| WIR-008 | P1 | XS | READY | test | entity rotation 只接受有限 quaternion | same | — | invalid q fail | — | — |
| WIR-009 | P1 | XS | READY | test | spatial relation subject/object 必须存在 | same | — | dangling ref fail | — | — |
| WIR-010 | P1 | XS | READY | test | ON relation surfaceId 只在 target manifest/contract 后续解析 | same | — | IR 只保留意图，不伪造 surface | — | — |
| WIR-011 | P1 | XS | READY | test | observation anchor 目前只允许 NEAR | same | — | ON/INSIDE anchor fail | — | — |
| WIR-012 | P1 | XS | READY | test | runtime reserved state key 拒绝 | same | — | heldBy 等不可由 Planner 设置 | — | — |
| WIR-013 | P1 | XS | READY | test | initial state 只接受 JSON scalar | same | — | object/array fail | — | — |
| WIR-014 | P1 | XS | READY | test | OPEN/CLOSE/PICKUP interaction 必须 targetId | same | — | missing target fail | — | — |
| WIR-015 | P1 | XS | READY | test | PLACE interaction 必须 supportId | same | — | missing support fail | — | — |
| WIR-016 | P1 | XS | READY | test | SWITCH 必须 stateKey + scalar value | same | — | 缺字段 fail | — | — |
| WIR-017 | P1 | XS | READY | test | interaction target/support 引用必须存在 | same | — | dangling interaction fail | — | — |
| WIR-018 | P1 | XS | READY | test | physics execution mode 只接受已声明枚举 | same | — | arbitrary string fail | — | — |
| WIR-019 | P1 | XS | READY | test | physics quality 只接受 deterministic/realtime/fallback | same | — | unknown quality fail | — | — |
| WIR-020 | P1 | XS | READY | test | acceptance object-exists 引用必须存在 | same | — | dangling acceptance fail | — | — |
| WIR-021 | P1 | XS | READY | test | acceptance state-equals 必须 stateKey/value | same | — | incomplete clause fail | — | — |
| WIR-022 | P1 | XS | READY | test | acceptance relation-exists predicate 合法 | same | — | unknown predicate fail | — | — |
| WIR-023 | P1 | XS | READY | test | no-unresolved acceptance 不接受额外 target | same | — | schema strict | — | — |

### 14.2 Planner Proposal / World Revision

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| REV-001 | P1 | XS | READY | test | Planner proposal 编译出的 revision id 由 Runtime 生成 | `WorldPlannerProposal.js` | — | caller 不能指定已签发 revision | — | — |
| REV-002 | P1 | XS | READY | test | proposal provenance 记录 parentRevisionId | same | — | lineage 可追踪 | — | — |
| REV-003 | P1 | XS | READY | test | `set-position` 只能改存在 entity | `WorldRevision.js` | — | unknown id fail | — | — |
| REV-004 | P1 | XS | READY | test | `replace-asset` assetId 必填 | same | — | 空 asset fail | — | — |
| REV-005 | P1 | XS | READY | test | `set-initial-state` 禁止 reserved key | same | WIR-012 | same contract | — | — |
| REV-006 | P1 | XS | READY | test | `set-capability-intent` capability 枚举合法 | same | — | unknown capability fail | — | — |
| REV-007 | P1 | XS | READY | test | `set-physics-requirement` execution/quality 合法 | same | WIR-018 | invalid requirement fail | — | — |
| REV-008 | P1 | XS | READY | test | proposal edits 不允许空列表伪装 changed plan | same | — | no-op proposal fail/noop | — | — |
| REV-009 | P1 | XS | READY | test | nextRevisionId 必须与 base 不同 | same | — | unchanged id fail | — | — |
| REV-010 | P1 | XS | READY | test | impact classifier `set-initial-state`→incremental-state | same | — | classification stable | — | — |
| REV-011 | P1 | XS | READY | test | `set-capability-intent`→behavior impact | same | — | classification stable | — | — |
| REV-012 | P1 | XS | READY | test | `set-physics-requirement`→physics impact | same | — | classification stable | — | — |
| REV-013 | P1 | XS | READY | test | `set-position`→position impact | same | — | classification stable | — | — |
| REV-014 | P1 | XS | READY | test | replace-asset/set-generation→full impact | same | — | classification stable | — | — |

### 14.3 World Compilation / Pipeline stages

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| WCP-001 | P1 | XS | READY | test | 固定 pipeline stage 顺序 | `createWorldPipeline.js` | — | stage reorder 必须显式更新测试 | — | — |
| WCP-002 | P1 | XS | READY | test | normalize stage 不 mutate caller input | pipeline | — | input deepEqual before/after | — | — |
| WCP-003 | P1 | XS | READY | test | resolve assets 对 missing asset 输出 Finding/明确状态 | same | — | 不在 resolver 内偷偷 generate | — | — |
| WCP-004 | P1 | XS | READY | test | asset admission rejected 阻断 instantiate | same | ASSET-033 | spawn 未调用 | — | — |
| WCP-005 | P1 | XS | READY | test | provisional asset 依据 policy 决定 advisory/hard | same | ASSET-035 | reason 层次清楚 | — | — |
| WCP-006 | P1 | XS | READY | test | WorldCompilation 拒绝 dangling relation | `WorldCompilation.js` | WIR-009 | compile fail | — | — |
| WCP-007 | P1 | XS | READY | test | global `spatial.constraints` 当前 fail-closed | same | — | 明确 unsupported，不忽略 | — | — |
| WCP-008 | P1 | XS | READY | test | unsupported fallback policy fail-closed | same | — | 不自动替换语义 | — | — |
| WCP-009 | P1 | S | READY | test | Composer 相同输入 deterministic layout | `WorldComposer.js` | — | 两次输出 position 完全相同 | — | — |
| WCP-010 | P1 | XS | READY | test | Composer candidate 数 bounded | same | — | 大 relation 集不会无界搜索 | — | — |
| WCP-011 | P1 | XS | READY | test | ON 关系 placement 先经过 manifestPoseClear | same | PHY-086 | blocked candidate 不采用 | — | — |
| WCP-012 | P1 | XS | READY | test | INSIDE 关系 placement 走 receptacle free-space | same | SPA-023 | inside candidate 可验证 | — | — |
| WCP-013 | P1 | XS | READY | test | NEAR relation 满足最大距离/不强制接触 | same | — | relation geometry 合理 | — | — |
| WCP-014 | P1 | S | READY | test | 多 relation 同 entity 冲突时返回 layout finding | same | — | 不静默覆盖前一个 placement | — | — |
| WCP-015 | P1 | XS | READY | test | Behavior admission 缺 target capability 时 hard reject | `WorldBehaviorCompiler.js` | — | RuntimeCommand 不生成 | — | — |
| WCP-016 | P1 | XS | READY | test | PhysicsAdmission 缺 backend capability 输出 reason | `WorldPhysicsAdmission.js` | PHY-007 | reason 带 required/available | — | — |
| WCP-017 | P1 | XS | READY | test | validation-only requirement 可由 Rapier/Jolt 满足 | same | — | admission pass | — | — |
| WCP-018 | P1 | XS | READY | test | render-only requirement 可由 Runtime transform-state 满足 | same | PHY-009 | admission pass | — | — |
| WCP-019 | P1 | XS | READY | test | instantiate 使用 canonical WorldBuilder/Runtime mutation | pipeline | — | 不绕过 ObjectStore/Physics | — | — |
| WCP-020 | P1 | S | READY | test | instantiate 第 N 个实体失败时已 spawn 实体 rollback | same | RT-002 | scene 回到 before | — | — |
| WCP-021 | P1 | XS | READY | test | apply relations 只记录 declarative/verified evidence，不伪造 | same | — | unsupported relation 不被标 verified | — | — |
| WCP-022 | P1 | S | READY | test | final validation hard finding → world-rejected | same | — | admission 不覆盖 hard failure | — | — |
| WCP-023 | P1 | S | READY | test | acceptance incomplete → world-provisional/incomplete，不 ready | same | — | final status 语义稳定 | — | — |
| WCP-024 | P1 | XS | READY | test | world-ready 只有 validation + acceptance 均满足 | same | — | 双 gate | — | — |
| WCP-025 | P1 | XS | READY | test | PipelineEngine stage error 保存 stage name | `PipelineEngine.js` | — | failure 可定位 | — | — |
| WCP-026 | P1 | XS | READY | test | PipelineEngine state artifact 合并不 mutate 上一 stage artifact | same | — | stage isolation | — | — |

### 14.4 Retry / Recompile

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| WRT-001 | P1 | XS | READY | test | WorldRetry 只对 missing asset finding 可重试 | `WorldRetry.js` | — | layout/validation finding 不 retry | — | — |
| WRT-002 | P1 | XS | READY | test | retry budget 默认/最大次数固定为 bounded | same | — | 超预算返回 exhausted | — | — |
| WRT-003 | P1 | XS | READY | test | 同 missing asset 不重复生成多次 | same | GEN-022 | idempotent route | — | — |
| WRT-004 | P1 | S | READY | test | canonical resolver 与 retry generate flag 不互相冲突 | same + pipeline | WRT-003 | missing→generate→resolve 闭环一次完成 | — | — |
| WRT-005 | P1 | XS | READY | test | retry attempt 保存 findings/evidence lineage | same | — | 每 attempt 可审计 | — | — |
| WRC-001 | P1 | XS | READY | test | Recompiler 拒绝 baseRevisionId 与 current world 不匹配 | `WorldRecompiler.js` | — | stale revision fail | — | — |
| WRC-002 | P1 | XS | READY | test | incremental-state 只改 state，不 respawn entity | same | REV-010 | instance identity 保持 | — | — |
| WRC-003 | P1 | S | READY | test | behavior recompile 替换 runtime commands/rules 原子化 | same | REV-011 | failure rollback old behavior | — | — |
| WRC-004 | P1 | S | READY | test | position recompile 走 canonical transform + physics sync | same | REV-013 | scene/body/nav truth 一致 | — | — |
| WRC-005 | P1 | S | READY | test | physics recompile 不支持的变更 fail-closed | same | REV-012 | 不部分改 backend | — | — |
| WRC-006 | P1 | S | READY | test | full impact 明确回退 full pipeline 而非伪增量 | same | REV-014 | execution path 可断言 | — | — |
| WRC-007 | P1 | S | READY | test | recompile 后总是重新 WorldValidator | same | — | old finding evidence 不复用 | — | — |
| WRC-008 | P1 | S | READY | test | recompile validation reject 时恢复 before snapshot | same | RT-002 | scene/state/relations 恢复 | — | — |

### 14.5 Behavior / Rule Runtime

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| BEH-001 | P1 | XS | READY | test | RuntimeCommand schema/version 固定 | `BehaviorCompiler.js` | — | unknown version rejected | — | — |
| BEH-002 | P1 | XS | READY | test | OPEN/CLOSE precondition=`target-supports-capability` | same | — | command contract exact | — | — |
| BEH-003 | P1 | XS | READY | test | PICKUP precondition=`target-carryable` | same | — | exact contract | — | — |
| BEH-004 | P1 | XS | READY | test | PLACE preconditions 包含 holds-object + support-target | same | — | 两项都存在 | — | — |
| BEH-005 | P1 | XS | READY | test | SWITCH value 仅 scalar | same | WIR-016 | object value fail | — | — |
| BEH-006 | P1 | XS | READY | test | duplicate commandId fail | same | — | compileBehaviorGraph 拒绝 | — | — |
| BEH-007 | P1 | XS | READY | test | verify OPEN 必须 status/target/action/settled 全匹配 | same | — | 缺任一项 unverified | — | — |
| BEH-008 | P1 | XS | READY | test | verify PICKUP 必须 held + targetId | same | — | false positive 不通过 | — | — |
| BEH-009 | P1 | XS | READY | test | verify PLACE 必须 supportVerified + settled | same | — | false positive 不通过 | — | — |
| BEH-010 | P1 | XS | READY | test | execute command unknown capability fail | same | — | 不调用 runtime | — | — |
| RULE-001 | P1 | XS | READY | test | Rule id 唯一 | `RuleGraph.js` | — | duplicate fail | — | — |
| RULE-002 | P1 | XS | READY | test | Rule event 必填 | same | — | empty event fail | — | — |
| RULE-003 | P1 | XS | READY | test | 当前 effect 只允许 set-state | same | — | spawn/move 等 effect fail | — | — |
| RULE-004 | P1 | XS | READY | test | equals condition scalar 比较用 Object.is | same | — | false/0/null 边界准确 | — | — |
| RULE-005 | P1 | XS | READY | test | not-equals condition inverse 正确 | same | — | 边界准确 | — | — |
| RULE-006 | P1 | XS | READY | test | evaluate 仅匹配相同 event | same | — | 其他 event 无 effects | — | — |
| RULE-007 | P1 | XS | READY | test | RuleRuntime 相同 effect 去重 | `RuleRuntime.js` | — | target/state/value 相同只执行一次 | — | — |
| RULE-008 | P1 | XS | READY | test | maxCascadeDepth 达上限抛稳定错误 | same | — | `RULE_CASCADE_DEPTH_EXCEEDED` | — | — |
| RULE-009 | P1 | XS | READY | test | RuleRuntime start 幂等 | same | — | 不重复订阅 EventBus | — | — |
| RULE-010 | P1 | XS | READY | test | stop 后事件不再执行 rule | same | — | effects=0 | — | — |
| RULE-011 | P1 | S | READY | test | rule effect mutation failure rollback整批 effects | same | RT-002 | 前面已改 state 恢复 | — | — |
| RULE-012 | P2 | S | DISCOVERY | research | 定义第二种 rule effect 的选择标准，而非直接扩语法 | docs | — | 比较 emit-event / execute-command / set-state | — | — |

### 14.6 Validation / Finding / Repair / Acceptance

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| VER-001 | P1 | XS | READY | test | Finding id deterministic/stable | `Finding.js` | — | 同 facts 同 id | — | — |
| VER-002 | P1 | XS | READY | test | Finding severity 只允许 hard/advisory | same | — | unknown severity fail | — | — |
| VER-003 | P1 | XS | READY | test | below-ground hard finding 含 object id + depth | `WorldValidator.js` | — | evidence 可用于 repair | — | — |
| VER-004 | P1 | XS | READY | test | floating 当前只 advisory | same | — | 不错误阻断 world | — | — |
| VER-005 | P1 | S | READY | test | ordinary overlap 产生 collision finding | same | — | 两对象 ids + overlap evidence | — | — |
| VER-006 | P1 | S | READY | test | held object 与 holder/carry context 不误报 collision | same | INT-055 | carry special case pass | — | — |
| VER-007 | P1 | S | READY | test | INSIDE 已验证 relation 不把容器接触误报碰撞 | same | SPA-030 | expected contact exempt | — | — |
| VER-008 | P1 | XS | READY | test | ON inverse relation 不重复生成冲突 finding | same | SPA-029 | relation direction稳定 | — | — |
| VER-009 | P1 | S | READY | test | ArticulationVerifier 只有 live Runtime evidence 才 verified | `ArticulationVerifier.js` | INT-040 | compiler/provider 证据不能直接过 | — | — |
| VER-010 | P1 | XS | READY | test | acceptance object-exists 成功/失败 | `WorldAcceptance.js` | — | 两 case | — | — |
| VER-011 | P1 | XS | READY | test | acceptance state-equals 读取 Runtime current state | same | — | 非计划初始值 | — | — |
| VER-012 | P1 | XS | READY | test | acceptance relation-exists 读取 SceneGraph current | same | — | stale planned relation 不够 | — | — |
| VER-013 | P1 | XS | READY | test | acceptance interaction-verified 要求 verifier evidence | same | VER-009 | 未验证 interaction incomplete | — | — |
| VER-014 | P1 | XS | READY | test | acceptance no-unresolved 读取 unresolved findings/mutations | same | — | 有 unresolved 时 incomplete | — | — |
| VER-015 | P1 | S | READY | test | acceptance replay 在 world change 后会重新失败 | same | — | 不是缓存 true | — | — |
| REP-001 | P1 | XS | READY | test | RepairEngine 仅接受 known hard finding | `RepairEngine.js` | — | advisory/unknown 不 mutate | — | — |
| REP-002 | P1 | XS | READY | test | below_ground→lift 只改 Y 轴最小必要量 | same | VER-003 | X/Z 不变 | — | — |
| REP-003 | P1 | S | READY | test | overlap→separate 位移 bounded | same | VER-005 | 不把对象移出世界极远 | — | — |
| REP-004 | P1 | S | READY | test | repair 后必须重新 validate 对应 finding | same | — | finding 消失才 repair-applied | — | — |
| REP-005 | P1 | S | READY | test | repair 未解决问题时 rollback | same | RT-002 | before snapshot 恢复 | — | — |
| REP-006 | P2 | S | DISCOVERY | research | 为 floating advisory 定义是否应存在自动 repair | docs | — | 决策：repair/no-repair + evidence | — | — |
| REP-007 | P2 | S | DISCOVERY | research | 建 Finding→impact class 映射表 | docs/tests | — | 每当前 Finding 对应 state/behavior/physics/position/full/no-repair | — | — |
| REP-008 | P2 | S | BLOCKED | code | 用映射表驱动局部 recompile 入口而非 hardcode if | recompiler | REP-007 | 当前 finding cases parity | — | — |

## 15. Agent / Skills / LLM Gateway

### 15.1 Skill Registry：模型只能看到合法、最小的工具面

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| AGT-001 | P1 | XS | READY | test | register 缺 name 拒绝 | `SkillRegistry.js` | — | 稳定错误 | — | — |
| AGT-002 | P1 | XS | READY | test | register 缺 handler 拒绝 | same | — | 稳定错误 | — | — |
| AGT-003 | P1 | XS | READY | test | duplicate skill name 拒绝 | same | — | 不覆盖原 handler | — | — |
| AGT-004 | P1 | XS | READY | test | skill 默认 version/permissions/mutates/history 固定 | same | — | default contract snapshot | — | — |
| AGT-005 | P1 | XS | READY | test | `agent:false` skill 不出现在 definitions | same | — | 内部 skill 不暴露 LLM | — | — |
| AGT-006 | P1 | XS | READY | test | definitions 强制 `additionalProperties:false` | same | — | 模型不能塞未声明字段 | — | — |
| AGT-007 | P1 | XS | READY | test | required 字段缺失在 handler 前拒绝 | same | — | handler call count=0 | — | — |
| AGT-008 | P1 | XS | READY | test | custom validator fail 在 authorization/handler 前返回 invalid_input | same | — | 无 mutation | — | — |
| AGT-009 | P1 | XS | READY | test | unknown skill authorization 返回 SKILL_NOT_FOUND | same | — | allow=false | — | — |
| AGT-010 | P1 | XS | READY | test | denied permission 不执行 handler | same | CORE-004 | forbidden + missing permission | — | — |
| AGT-011 | P1 | XS | READY | test | policy.decision trace 在 skill execution 前产生 | same | CORE-008 | causedBy 可关联 | — | — |
| AGT-012 | P1 | XS | READY | test | mutating history skill 自动走 runtime.mutate | same | RT-002 | handler 不直接越过 transaction | — | — |
| AGT-013 | P1 | XS | READY | test | mutates+history=false 自动走 exclusiveMutation | same | RT-003 | 不写 undo history | — | — |
| AGT-014 | P1 | XS | READY | test | manualMutation=true 不被 registry 再包一层 | same | — | 不出现 nested mutation | — | — |
| AGT-015 | P1 | XS | READY | test | skipHistory context 不创建 history entry | same | — | internal recovery 可控 | — | — |
| AGT-016 | P1 | XS | READY | test | handler throw 变为 `{success:false,error}` | same | — | code/message 保真 | — | — |
| AGT-017 | P1 | XS | READY | test | skill.failed trace 不携带 stack | same | CORE-010 | 安全摘要 | — | — |
| AGT-018 | P1 | XS | READY | test | action-completed 缺 targetReached 时 classify unverified | same | — | POST_CONDITION_NOT_VERIFIED | — | — |
| AGT-019 | P1 | XS | READY | test | placed 缺 supportVerified/settled 时 unverified | same | — | 不误报 verified | — | — |
| AGT-020 | P1 | XS | READY | test | dropped 必须 released+settled+stillHeld=false | same | — | 三条件 gate | — | — |
| AGT-021 | P1 | XS | READY | test | recovery-cleaned 必须 release/settle/sweep/contact 四条件 | same | — | 四条件 gate | — | — |
| AGT-022 | P1 | XS | READY | test | provider-succeeded/artifact-imported 只 unverified | same | GEN-042 | 不被 Agent 当完成 | — | — |
| AGT-023 | P1 | XS | READY | test | asset-ready=verified；asset-provisional=unverified | same | ASSET-035 | 分类稳定 | — | — |
| AGT-024 | P1 | XS | READY | test | world-ready=verified；world-provisional/rejected 分开 | same | WCP-024 | 分类稳定 | — | — |
| AGT-025 | P1 | XS | READY | test | batch reject states 包含 blocked/failed/unverified/requested/error/noop | same | — | batch 不提交半成功 | — | — |

### 15.2 ToolCallingAgent 输入规范化与 planning loop

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| AGT-026 | P1 | XS | READY | test | 冗余 JSON quoted actorId 自动 unwrap | `ToolCallingAgent.js` | — | `"agent_01"`→`agent_01` | — | — |
| AGT-027 | P1 | XS | READY | test | 非字符串/非法 JSON quoted 值不误改 | same | — | 原值保持 | — | — |
| AGT-028 | P1 | XS | READY | test | legacy agentId 映射到 actorId | same | — | agentId 删除 | — | — |
| AGT-029 | P1 | XS | READY | test | approachAndPlace legacy targetId 映射 supportId | same | — | targetId 删除 | — | — |
| AGT-030 | P1 | XS | READY | test | mutationIdentity object key order deterministic | same | — | 同语义不同 key order identity 相同 | — | — |
| AGT-031 | P1 | XS | READY | test | mutationIdentity 纳入 resolved partName | same | — | 不同 part 不碰撞 | — | — |
| AGT-032 | P1 | XS | READY | test | worldPlanIdentity 忽略 revision/provenance 只看语义 | same | — | 换 revision 重提交仍识别重复 | — | — |
| AGT-033 | P1 | XS | READY | test | Agent 无 configured gateway fail-fast | same | — | `AGENT_CAPABILITY_UNAVAILABLE` | — | — |
| AGT-034 | P1 | XS | READY | test | 每 planning round 开始都调用 listObjects | same | — | world change 后不是旧 cache | — | — |
| AGT-035 | P1 | XS | READY | test | mutation 后 context 只发 compact world index | same | — | 不重复大 world payload | — | — |
| AGT-036 | P1 | XS | READY | test | 无 mutation 时 context 可给完整当前 world | same | — | 首轮可观察实体 | — | — |
| AGT-037 | P1 | XS | READY | test | maxSteps 正确限制 planning round 数 | same | — | 超限 bounded termination | — | — |
| AGT-038 | P1 | XS | READY | test | gateway response 的 toolCalls 全部 normalize 后再执行 | same | AGT-026 | handler 收到 canonical args | — | — |
| AGT-039 | P1 | XS | READY | test | tool invocation throw 被编码为 TOOL_ERROR 并进入 outcome | same | — | loop 可继续/replan | — | — |
| AGT-040 | P1 | XS | READY | test | tool result undefined 规范化为 `{ok:true}` | same | — | JSON 序列化稳定 | — | — |

### 15.3 Mutation barrier / fresh replan / final gate

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| AGT-041 | P0 | XS | READY | test | 同一 LLM response 中第一个 mutation 后后续 mutation 不执行 | same | — | reason=REPLAN_REQUIRED_AFTER_WORLD_CHANGE | — | — |
| AGT-042 | P0 | XS | READY | test | mutation 后后续 read-only call 也按 barrier 策略跳过 | same | AGT-041 | fresh planning round required | — | — |
| AGT-043 | P0 | XS | READY | test | verified mutation 从 unresolved map 删除 | same | — | unresolved count=0 | — | — |
| AGT-044 | P0 | XS | READY | test | blocked/failed/unverified mutation 进入 unresolved map | same | — | identity+outcome 保留 | — | — |
| AGT-045 | P0 | XS | READY | test | invocationFailed 不制造错误 unresolved identity | same | — | tool transport failure 与 world mutation failure 分离 | — | — |
| AGT-046 | P0 | XS | READY | test | LLM 直接给最终文本但有 unresolved mutation → taskStatus=incomplete | same | AGT-044 | 不信模型“完成了” | — | — |
| AGT-047 | P0 | XS | READY | test | 最后 mutation verified 且无 unresolved → completed | same | AGT-043 | taskStatus=completed | — | — |
| AGT-048 | P0 | XS | READY | test | acceptance required 但缺失/未接受 → incomplete | same | VER-014 | final message 改为 acceptance incomplete | — | — |
| AGT-049 | P0 | XS | READY | test | no-mutation 任务 final 返回 taskStatus=no-mutation | same | — | read-only 问答不误称 world mutation complete | — | — |
| AGT-050 | P1 | XS | READY | test | planning limit + unresolved 返回 structured incomplete | same | — | termination=planning-limit | — | — |
| AGT-051 | P1 | XS | READY | test | planning limit + 无 unresolved 保持 explicit exceeded error | same | — | 不混淆 incomplete mutation | — | — |

### 15.4 World proposal gates

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| AGT-052 | P0 | XS | READY | test | 有 proposeWorldIR skill 时禁止直接 runWorldPipeline | same | — | WORLD_PIPELINE_PROPOSAL_REQUIRED | — | — |
| AGT-053 | P0 | XS | READY | test | proposeWorldIR 成功后保存 Runtime-issued revision ID | same | REV-001 | issued set 可 gate 后续 | — | — |
| AGT-054 | P0 | XS | READY | test | proposal 后强制新 planning round | same | AGT-053 | 同 response 的 pipeline call 被跳过 | — | — |
| AGT-055 | P0 | XS | READY | test | runWorldPipeline 只能使用 issued revision | same | AGT-053 | fabricated revision 被拒绝 | — | — |
| AGT-056 | P0 | XS | READY | test | 完全相同 semantic world plan 换 revision 重提仍被拒绝 | same | AGT-032 | WORLD_PIPELINE_PLAN_ALREADY_ATTEMPTED | — | — |
| AGT-057 | P1 | XS | READY | test | world rejection 建立 pending proposal lineage | same | WCP-022 | parentRevisionId/evidenceRefs 保存 | — | — |
| AGT-058 | P1 | XS | READY | test | rejected pipeline 若有 revisionContext 建 pending bounded repair | same | WRC-001 | baseWorldIR/revisionContext 成对保存 | — | — |
| AGT-059 | P0 | XS | READY | test | 无 pending revision repair 时 proposeWorldRevision 被 gate | same | — | WORLD_REVISION_CONTEXT_REQUIRED | — | — |
| AGT-060 | P0 | XS | READY | test | bounded revision proposal 后保存 exact signature | same | — | nextRevisionId→signature map | — | — |
| AGT-061 | P0 | XS | READY | test | recompileWorldRevision 未先 propose 被拒绝 | same | — | WORLD_REVISION_PROPOSAL_REQUIRED | — | — |
| AGT-062 | P0 | XS | READY | test | recompileWorldRevision proposal 被篡改时拒绝 | same | AGT-060 | WORLD_REVISION_PROPOSAL_TAMPERED | — | — |
| AGT-063 | P1 | XS | READY | test | verified recompile 清掉对应 base revision unresolved mutation | same | WRC-007 | old unresolved 删除 | — | — |
| AGT-064 | P1 | XS | READY | test | verified world build 后冗余 read-only confirmation 被跳过 | same | WCP-024 | WORLD_READY_REDUNDANT_READ | — | — |
| AGT-065 | P1 | XS | READY | test | verified world 后真正下一步 mutation 仍允许进入新 round | same | AGT-064 | 不把 Agent 永久锁死 | — | — |

### 15.5 Recovery ledger / bounded observation

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| AGT-066 | P1 | XS | READY | test | recoveryOriginIdentity 只匹配同 actor/target/part 的 failed interact | same | — | 不跨任务绑定 | — | — |
| AGT-067 | P1 | XS | READY | test | recovery identity 补齐 origin partName | same | — | recovery ledger 粒度正确 | — | — |
| AGT-068 | P1 | XS | READY | test | 同一 recovery 对同一 origin verified 后不可重复执行 | same | — | RECOVERY_ALREADY_APPLIED | — | — |
| AGT-069 | P1 | XS | READY | test | 原 mutation 重试后开启新 recovery evidence epoch | same | — | applied recoveries 清除 | — | — |
| AGT-070 | P1 | XS | READY | test | mutation 执行后 recoveryReadRounds 重置 | same | — | read budget 新 epoch | — | — |
| AGT-071 | P1 | XS | READY | test | 纯 read-only recovery round 每轮 +1 | same | — | budget accounting 准确 | — | — |
| AGT-072 | P1 | XS | READY | test | 达 maxRecoveryReadRounds 后 read-only calls 全跳过 | same | — | termination=recovery-observation-limit | — | — |
| AGT-073 | P1 | XS | READY | test | recovery observation limit 返回 unresolved snapshot | same | — | caller 可诊断 | — | — |
| AGT-074 | P1 | XS | READY | test | auxiliary recovery 本身不替原 mutation 清 unresolved | same | — | 必须 retry original | — | — |
| AGT-075 | P1 | XS | READY | test | auxiliary recovery failed 不加入 applied ledger | same | — | 可另选 recovery | — | — |

### 15.6 Task observation

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| OBS-001 | P1 | XS | READY | test | task observation schema 固定 v1 | `buildTaskObservation.js` | — | schema=`agentscape.task-observation.v1` | — | — |
| OBS-002 | P1 | XS | READY | test | 只收 actor + last/unresolved 涉及对象 | same | — | 不把全场景塞给模型 | — | — |
| OBS-003 | P1 | XS | READY | test | position round 到 3 位小数 | same | — | payload stable | — | — |
| OBS-004 | P1 | XS | READY | test | relations 最多 maxRelations 条 | same | — | 默认<=8 | — | — |
| OBS-005 | P1 | XS | READY | test | relation distance round 3 位 | same | — | stable context | — | — |
| OBS-006 | P1 | XS | READY | test | actor navigation status 写入 observation | same | LOC-016 | current status 而非 cache | — | — |
| OBS-007 | P1 | XS | READY | test | actor carry status 写入 observation | same | INT-055 | current status | — | — |
| OBS-008 | P1 | XS | READY | test | articulation live coordinate/target/error/tolerance 被压缩 | same | — | 不暴露 native handle | — | — |
| OBS-009 | P1 | XS | READY | test | contact evidence 最多取前 4 条 | same | — | token bounded | — | — |
| OBS-010 | P1 | XS | READY | test | STALL + contact blocker 时 recovery hint 指向 suggestRecoveryActions | same | INT-077 | args actor/target/part 正确 | — | — |
| OBS-011 | P1 | XS | READY | test | navigation failure hint 指向 suggestNavigationActions | same | — | only provisional | — | — |
| OBS-012 | P1 | XS | READY | test | settle/support failure 不让模型 claim success | same | — | hint=report-unverified-or-retry-place | — | — |

### 15.7 Recovery proposal engine

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| RCV-001 | P1 | XS | READY | test | 非 STALL failure 返回 recovery-unavailable | `buildRecoveryProposals.js` | — | reason=NO_STALL_FAILURE | — | — |
| RCV-002 | P1 | XS | READY | test | 无 contact blocker candidate 返回 unavailable | same | INT-077 | reason=NO_CONTACT_BLOCKER_CANDIDATE | — | — |
| RCV-003 | P1 | XS | READY | test | environment blocker 永远 ineligible | same | — | ENVIRONMENT_IMMOVABLE | — | — |
| RCV-004 | P1 | XS | READY | test | 不存在 blocker object ineligible | same | — | BLOCKER_OBJECT_UNAVAILABLE | — | — |
| RCV-005 | P1 | S | READY | test | stale contact 必须 current sweep overlap 才继续 | same | — | 无 persistence→CONTACT_EVIDENCE_STALE | — | — |
| RCV-006 | P1 | XS | READY | test | articulated blocker 缺 joint/targets ineligible | same | — | ARTICULATED_PART_UNAVAILABLE | — | — |
| RCV-007 | P1 | XS | READY | test | blocker articulation state 未 verified 不执行恢复 | same | — | ARTICULATED_STATE_UNVERIFIED | — | — |
| RCV-008 | P1 | XS | READY | test | blocker articulation 正在 moving 不执行第二动作 | same | — | ARTICULATED_ACTION_PENDING | — | — |
| RCV-009 | P1 | XS | READY | test | 无 alternate open/close action ineligible | same | — | NO_ALTERNATE_ARTICULATED_ACTION | — | — |
| RCV-010 | P1 | XS | READY | test | Policy denied articulated recovery 保留 missing permissions | same | AGT-010 | status=denied | — | — |
| RCV-011 | P1 | S | READY | test | 单 alternate action 必须 findInteractionPose 成功 | same | INT-029 | no pose→ineligible | — | — |
| RCV-012 | P1 | S | READY | test | world counterfactual 第三对象阻挡则 alternate action ineligible | same | PHY-162 | THIRD_OBJECT_COUNTERFACTUAL_BLOCKED | — | — |
| RCV-013 | P1 | S | READY | test | 多 alternate action 优先 physics counterfactual ranking | same | PHY-165 | 排名 tuple 稳定 | — | — |
| RCV-014 | P1 | S | READY | test | physics baseline inconsistent 时回退 visual AABB ranking | same | — | fallbackReason 明确 | — | — |
| RCV-015 | P1 | S | READY | test | counterfactual convergence unstable 时不信 physics ranking | same | PHY-168 | 回退且 reason 稳定 | — | — |
| RCV-016 | P1 | S | READY | test | 两 action ranking 完全相同返回 COUNTERFACTUAL_ACTION_TIE | same | — | 不任意选 | — | — |
| RCV-017 | P1 | S | READY | test | pickup blocker 必须 assertCarryable + pickupPlan.transfer.clear | same | INT-051 | 任一 fail→ineligible | — | — |
| RCV-018 | P1 | XS | READY | test | eligible proposals 先按 routeCost 再 stable blocker key | same | — | deterministic order | — | — |
| RCV-019 | P1 | S | READY | test | hands-full recovery-held blocker 时建议 cleanup | same | INT-072 | cleanupRecommended provisional | — | — |
| RCV-020 | P1 | XS | READY | test | recovery proposal verification 永远要求 retry original post-condition | same | — | 不以 cleanup 本身等价原任务完成 | — | — |

### 15.8 HTTP LLM Gateway

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| GW-001 | P1 | XS | READY | test | HttpLLMGateway 默认 timeout=30s | `HttpLLMGateway.js` | — | constructor contract fixed | — | — |
| GW-002 | P1 | XS | READY | test | normalize response 缺 call id 生成稳定 fallback | same | — | call_0 等 | — | — |
| GW-003 | P1 | XS | READY | test | arguments/args 两种 gateway 字段归一 | same | — | args object canonical | — | — |
| GW-004 | P1 | XS | READY | test | toolCalls 为空且有 message → final=true | same | — | response semantic stable | — | — |
| GW-005 | P1 | XS | READY | test | env loader 不覆盖已存在 process env | gateway script | — | explicit env wins | — | — |
| GW-006 | P1 | XS | READY | test | env loader 忽略 comment/empty/invalid line | same | — | parser stable | — | — |
| GW-007 | P1 | XS | READY | test | model list trim+dedupe | same | — | no duplicate fallback call | — | — |
| GW-008 | P1 | XS | READY | test | 空 model chain 拒绝 | same | — | clear error | — | — |
| GW-009 | P1 | XS | READY | test | tools 转 OpenAI function schema 不丢 parameters | same | — | strict schema preserved | — | — |
| GW-010 | P1 | XS | READY | test | assistant toolCalls 转 OpenAI arguments JSON | same | — | round-trip | — | — |
| GW-011 | P1 | XS | READY | test | OpenAI invalid JSON tool arguments 拒绝 | same | — | 不执行 malformed call | — | — |
| GW-012 | P1 | XS | READY | test | context 插入 system message 在主 system 后 | same | — | prompt order fixed | — | — |
| GW-013 | P1 | XS | READY | test | upstream temperature=0 + stream=false | same | — | deterministic config fixed | — | — |
| GW-014 | P1 | XS | READY | test | 408/425/429/5xx 才切下一个 model | same | — | retryable set fixed | — | — |
| GW-015 | P1 | XS | READY | test | 4xx 非 retryable 不切 model | same | — | 不放大错误调用 | — | — |
| GW-016 | P1 | XS | READY | test | fetch transport error 可切 fallback model | same | — | chain continues bounded | — | — |
| GW-017 | P1 | XS | READY | test | localhost/127.0.0.1/::1 origin 允许 | same | — | local Studio works | — | — |
| GW-018 | P1 | XS | READY | test | 任意公网 origin 默认拒绝 | same | — | 403 | — | — |
| GW-019 | P1 | XS | READY | test | explicit allowedOrigins 精确匹配 | same | — | 只允许配置 origin | — | — |
| GW-020 | P1 | XS | READY | test | request >2MiB 在 JSON parse 前拒绝 | same | — | bounded memory | — | — |
| GW-021 | P1 | XS | READY | test | `/health` 不返回 API key/base auth | same | — | 只 models/ok | — | — |
| GW-022 | P1 | XS | READY | test | OPTIONS CORS 正确返回 204 | same | — | local browser preflight pass | — | — |
| GW-023 | P1 | XS | READY | test | 非 `/agent` POST 返回 404 | same | — | route surface 最小 | — | — |
| GW-024 | P1 | XS | READY | test | gateway bind 默认 127.0.0.1 而非 0.0.0.0 | same | — | local-only 默认安全 | — | — |

## 16. Studio：当前产品主工作台

> 原则：新产品能力优先进入 Studio。Observatory 负责诊断/实验，不与 Studio 形成第二套产品工作流。

### 16.1 Composition / capability / runtime driver

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| STU-001 | P0 | XS | READY | smoke | Studio 默认 world 启动到 ready | `apps/studio/main.js` | RUN-002 | 无 startup error | — | — |
| STU-002 | P1 | XS | READY | test | `worldManifest` query 优先于 `mesh` query | same | — | 两者同时存在时只走 manifest | — | — |
| STU-003 | P1 | XS | READY | test | generated mesh `up=z` 映射 z-up | same | — | loader 参数正确 | — | — |
| STU-004 | P1 | XS | READY | test | generation runtime 固定 `approved-image` policy | same | GEN-034 | Studio Agent 不直出 Text→3D | — | — |
| STU-005 | P1 | XS | READY | test | generation initialize pair=false 启动不弹强制连接 | same | — | offline Studio 仍可编辑 | — | — |
| STU-006 | P1 | XS | READY | test | RuntimeDriver start 只有一个 RAF loop | `RuntimeDriver.js` | — | start 两次不双 step | — | — |
| STU-007 | P1 | XS | READY | test | RuntimeDriver stop/dispose 取消 RAF | same | — | dispose 后 step count 不再增加 | — | — |
| STU-008 | P1 | XS | READY | test | RuntimeDriver 每帧同步 human view pose | same | INT-001 | view pose 更新 | — | — |
| STU-009 | P1 | XS | READY | test | beforeunload dispose driver + world | `apps/studio/main.js` | STU-007 | cleanup 各执行一次 | — | — |
| STU-010 | P1 | XS | READY | test | startup failure UI 只显示安全 message | same | — | 不显示 stack/token | — | — |
| STU-011 | P1 | XS | READY | test | capability status timeout 返回 unavailable 而非挂起 | `capabilityEntry.js` | — | <=5s bounded | — | — |
| STU-012 | P1 | XS | READY | test | capability status payload normalization 缺字段安全 fallback | same | — | agent/compiler flags false | — | — |
| STU-013 | P1 | XS | READY | test | clearLegacyEndpointOverrides 只删已知 legacy keys | same | — | 其他 localStorage 不动 | — | — |
| STU-014 | P1 | XS | READY | test | applyCapabilityStatus 只更新 gateway/generation endpoint availability | same | — | 不重建 Runtime | — | — |

### 16.2 Build Session / capability selection

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| STU-015 | P1 | XS | READY | test | BuildSession mode 只允许 image/asset/world | `BuildSession.js` | — | invalid mode fail | — | — |
| STU-016 | P1 | XS | READY | test | Studio 默认 BuildSession=image | `apps/studio/main.js` | — | 首屏进入图片资产 flow | — | — |
| STU-017 | P1 | XS | READY | test | preferredProfile 只从 capability profiles 选稳定默认 | `StudioBuildController.js` | — | 无 profile 时 null/明确 fallback | — | — |
| STU-018 | P1 | XS | READY | test | requiredOutputRoles 去重且稳定顺序 | same | — | duplicate role 不重复请求 | — | — |
| STU-019 | P1 | XS | READY | test | selectBuildCapability category 必须精确匹配 | same | — | world 不误选 asset | — | — |
| STU-020 | P1 | XS | READY | test | inputType=image 只选宣告 image input 的 asset capability | same | GEN-037 | 不误选 text-only 3D provider | — | — |
| STU-021 | P1 | XS | READY | test | provider 显式选择优先于 auto | same | — | 只返回指定 provider | — | — |
| STU-022 | P1 | XS | READY | test | operation 显式选择进一步限定 capability | same | — | wrong operation 不 fallback | — | — |
| STU-023 | P1 | XS | READY | test | providerOptions 不暴露 unavailable capability | same | — | UI 无死选项 | — | — |
| STU-024 | P1 | XS | READY | test | buildInputs 只填 capability 声明输入 | same | — | 不把任意 seed keys 传 provider | — | — |

### 16.3 Image Object Workbench / 本地草稿

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| IMG-001 | P0 | XS | DONE | test | PNG/JPEG/WebP 类型 gate | `ImageObjectDrafts.js` | — | 当前测试已覆盖 | — | `tests/studio/image-object-drafts.test.js` |
| IMG-002 | P0 | XS | DONE | test | 单图 20MiB 上限 | same | — | 当前测试已覆盖 | — | existing test |
| IMG-003 | P1 | XS | READY | test | zero-byte file 拒绝 | same | — | 明确 error | — | — |
| IMG-004 | P1 | XS | READY | test | 16M pixel 上限在 decode 后检查 | `ImageObjectWorkbench.tsx` | — | 巨图不进入 canvas 持久化 | — | — |
| IMG-005 | P1 | XS | READY | test | 转 PNG 后再次检查 20MiB | same | — | expansion case reject | — | — |
| IMG-006 | P0 | XS | DONE | test | uploading/generating/queued 草稿恢复为 interrupted | `ImageObjectDrafts.js` | — | 当前测试已覆盖 | — | existing test |
| IMG-007 | P1 | XS | READY | test | done/failed/ready 草稿恢复状态不改 | same | — | stable restore | — | — |
| IMG-008 | P1 | XS | READY | test | IndexedDB 无 open 能力返回明确错误 | same | — | UI 可提示 browser storage | — | — |
| IMG-009 | P1 | XS | READY | test | IndexedDB upgrade 只创建 `workspace` store 一次 | same | — | reopen 不 duplicate | — | — |
| IMG-010 | P1 | XS | READY | test | write→read current workspace round-trip Blob | same | — | blob metadata 保真 | — | — |
| IMG-011 | P1 | XS | READY | test | transaction abort reject promise | same | — | 不假装保存成功 | — | — |
| IMG-012 | P0 | XS | DONE | test | foreground RGBA 限制 <=512×512 | same | — | 当前测试已覆盖 | — | existing test |
| IMG-013 | P1 | XS | READY | test | 四角透明时直接按 alpha foreground | same | — | region segmentation deterministic | — | — |
| IMG-014 | P1 | XS | READY | test | 四角非透明且背景不均匀拒绝 auto candidate | same | — | 提示手工框选 | — | — |
| IMG-015 | P1 | XS | READY | test | 背景 flood-fill 只从边界开始 | same | — | 内部同色孔洞不被当外部背景 | — | — |
| IMG-016 | P1 | XS | READY | test | connected components 使用 4-neighbor 而非 diagonal join | same | — | 斜角两个物体保持分离 | — | — |
| IMG-017 | P1 | XS | READY | test | minArea 过滤小噪点 | same | — | 小区域不输出 | — | — |
| IMG-018 | P1 | XS | READY | test | candidate 最多 24 个且按 pixel count 排序 | same | — | bounded | — | — |
| IMG-019 | P0 | XS | DONE | test | queue 单项失败后继续下一个 | same | — | 当前测试已覆盖 | — | existing test |
| IMG-020 | P1 | XS | READY | test | shouldStop 在下一项开始前生效 | same | — | 当前项完成后停止 | — | — |
| IMG-021 | P1 | XS | READY | test | workspace 最多 40 sources | workbench | — | 第41张不写 DB | — | — |
| IMG-022 | P1 | XS | READY | test | workspace 最多 120 drafts | same | — | 第121个拒绝 | — | — |
| IMG-023 | P1 | XS | READY | test | workspace 总 Blob <=256MiB | same | — | 超限不写 DB | — | — |
| IMG-024 | P1 | XS | READY | test | Blob URL unmount 时 revoke | same | — | URL 不泄漏 | — | — |
| IMG-025 | P1 | XS | READY | test | paste listener 只在 visible workbench 响应 | same | — | 其他页面粘贴不拦截 | — | — |
| IMG-026 | P1 | XS | READY | test | drag/drop 多文件逐一失败不阻断其他文件 | same | — | errors 汇总 | — | — |
| IMG-027 | P1 | XS | READY | test | 新 draft 使用 crypto UUID 生成 assetId | same | — | 并发无 Date.now collision | — | — |
| IMG-028 | P1 | XS | READY | test | 已提交 job/result 的 draft 禁止覆盖编辑 | same | — | 提示从原图新建 | — | — |
| IMG-029 | P1 | XS | READY | test | 编辑 draft 后 approved 重置 false | same | — | 必须重新人工确认 | — | — |
| IMG-030 | P1 | XS | READY | test | 自动 candidate 的 crop 坐标映回原图尺度 | same | — | 512 sample→original bbox 误差<=1px | — | — |
| IMG-031 | P1 | S | READY | test | auto mask 输出 alpha 与 region pixels 对齐 | same | — | 背景 alpha=0 | — | — |
| IMG-032 | P1 | XS | READY | test | runnable 只包含 selected+approved+not-done | same | — | 未确认不提交云资源 | — | — |
| IMG-033 | P0 | XS | READY | test | generate 开始前要求 batch external-resource checkbox | same | — | confirmed=false 按钮 disabled | — | — |
| IMG-034 | P0 | S | READY | test | 首次 generate 先 approveLocalImage 再 Image→3D | same | GEN-033 | stage order exact | — | — |
| IMG-035 | P0 | S | READY | test | draft 获得 jobId 后立即持久化 | same | GEN-047 | 刷新能 resume | — | — |
| IMG-036 | P0 | S | READY | test | resume existing job 不重新 upload image | same | GEN-047 | approveLocalImage count=0 | — | — |
| IMG-037 | P1 | XS | READY | test | provider selection per-draft 被持久化 | same | — | resume 不换 provider | — | — |
| IMG-038 | P1 | XS | READY | test | auto provider 只在首次 submit resolve | same | — | resume 依 job truth | — | — |
| IMG-039 | P1 | XS | READY | test | done draft 可 placeAsset | same | — | 按钮调用正确 assetId | — | — |
| IMG-040 | P1 | XS | READY | test | remove draft 不删除已生成 Asset/云 Job | same | — | 只删 local workspace | — | — |
| IMG-041 | P1 | S | READY | test | “确认失败后重建”只允许 terminal failed/cancelled/expired | same | GEN-018 | running job 不会重复提交 | — | — |
| IMG-042 | P1 | XS | READY | test | rebuild 生成新 assetId 并清 job/imageResult | same | IMG-041 | old job lineage 不污染 | — | — |

### 16.4 Local Image Editor

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| EDIT-001 | P1 | XS | READY | test | crop inset 负数 clamp=0 | `LocalImageEditorCore.ts` | — | stable normalize | — | — |
| EDIT-002 | P1 | XS | READY | test | crop inset 超尺寸 clamp 到有效 rect | same | — | width/height >=1 | — | — |
| EDIT-003 | P1 | XS | READY | test | cropRect 返回整数像素 | same | — | no fractional crop | — | — |
| EDIT-004 | P1 | XS | READY | test | erase brush 只降低 alpha 不改 RGB | same | — | RGB byte exact | — | — |
| EDIT-005 | P1 | XS | READY | test | restore brush 从 base alpha 恢复 | same | — | 不超过 original alpha | — | — |
| EDIT-006 | P1 | XS | READY | test | brush radius<=0 安全 noop/normalize | same | — | bounded | — | — |
| EDIT-007 | P1 | XS | READY | test | brush 超边界不访问 typed-array 越界 | same | — | no throw | — | — |
| EDIT-008 | P1 | XS | READY | test | resetAlpha 只恢复 alpha channel | same | — | RGB 保持 edited/current | — | — |
| EDIT-009 | P1 | S | READY | test | exportPng crop 后尺寸与 cropRect 一致 | `LocalImageEditor.tsx` | EDIT-003 | width/height exact | — | — |
| EDIT-010 | P1 | S | READY | test | editor disabled 时 pointer input 不改变 alpha | same | — | before/after same | — | — |
| EDIT-011 | P2 | S | DISCOVERY | UX | 评估 undo 一个 brush stroke 的最小本地历史结构 | editor core | — | 只设计 1-level/short ring，不实现大编辑器 | — | — |

### 16.5 Asset/World build controller

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| STU-025 | P1 | XS | READY | test | capabilities.asset 只看 image→asset capability | `StudioBuildController.js` | STU-020 | Text-only 不显示 ready | — | — |
| STU-026 | P1 | XS | READY | test | capabilities.world 只看 world generation | same | — | asset provider 不误报 world | — | — |
| STU-027 | P1 | XS | READY | test | wait loop 每次 progress callback 可 await | same | — | async persistence 完成后再 poll | — | — |
| STU-028 | P1 | XS | READY | test | terminal generation failure 抛带 job status 的 error | same | — | UI 可展示 | — | — |
| STU-029 | P1 | XS | READY | test | direct text asset 在 approved-image policy 显示 IMAGE_INPUT_REQUIRED | same | GEN-035 | 不提交 job | — | — |
| STU-030 | P1 | XS | READY | test | Image→3D capability 缺失且非 resume 时 route unavailable | same | — | 明确 code | — | — |
| STU-031 | P1 | XS | READY | test | resume job 即使 capability 当前不可发现仍可查询 | same | GEN-047 | 断线恢复不依新 discovery | — | — |
| STU-032 | P1 | XS | READY | test | resume completed job 直接 compile，不重复 wait | same | — | get count bounded | — | — |
| STU-033 | P1 | XS | READY | test | result 只接受 asset-ready/provisional | same | ASSET-035 | rejected 抛明确错误 | — | — |
| STU-034 | P1 | XS | READY | test | 返回 GLB artifactId 优先 mime=model/gltf-binary | same | — | artifact tray 能 preview | — | — |
| STU-035 | P1 | S | READY | test | generated world open 使用 materialize persisted manifest | same | GEN-044 | 不依 signed provider URL | — | — |
| STU-036 | P1 | S | READY | test | replaceStudioEnvironment 失败保持旧环境 | `replaceStudioEnvironment.js` | RT-005 | rollback complete | — | — |

### 16.6 Placement / Editor / Persistence

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| PLC-001 | P1 | XS | READY | test | placementBounds 缺 collider 用 geometry bounds/fallback 策略固定 | `AssetPlacementController.js` | — | finite size | — | — |
| PLC-002 | P1 | XS | READY | test | drag MIME 固定 `application/x-agentscape-asset` | same | — | DnD interoperability | — | — |
| PLC-003 | P1 | S | READY | test | pointer raycast 只接受 upward support surface | same | — | 墙面不被当桌面 | — | — |
| PLC-004 | P1 | XS | READY | test | ghost preview 不注册到 WorldRuntime | same | — | store count 不变 | — | — |
| PLC-005 | P1 | S | READY | test | ghost blocked 时 visual state + commit disabled | same | PHY-086 | 不 spawn collider overlap | — | — |
| PLC-006 | P1 | S | READY | test | commit placement 必须走 AgentTools.spawnAsset | same | — | policy/history/trace 不绕过 | — | — |
| PLC-007 | P1 | XS | READY | test | Escape/cancel 清 ghost resources | same | — | no Three resource leak | — | — |
| EDT-001 | P1 | XS | READY | test | Editor select missing id 清 selection | `EditorController.js` | — | no stale inspector | — | — |
| EDT-002 | P1 | XS | READY | test | transform begin/end 对应 WorldRuntime begin/end transform | same | PHY-074 | physics body type 恢复 | — | — |
| EDT-003 | P1 | XS | READY | test | transform cancel 恢复 before pose | same | RT-002 | scene/body一致 | — | — |
| EDT-004 | P1 | XS | READY | test | remove selected 后 selection=null | same | — | UI 不引用 removed object | — | — |
| PER-001 | P1 | XS | READY | test | LocalSceneStore JSON round-trip | `LocalSceneStore.js` | RT-009 | serialize/restore data 保真 | — | — |
| PER-002 | P1 | XS | READY | test | corrupted JSON load 返回明确错误 | same | — | 不清除原数据 | — | — |
| PER-003 | P1 | XS | READY | test | Autosave mutation burst debounce=600ms | `AutosaveController.js` | — | burst 只 save 一次 | — | — |
| PER-004 | P1 | XS | READY | test | autosave stop 取消 pending timer | same | — | stop 后不 late save | — | — |
| PER-005 | P1 | XS | READY | test | restore old scene 缺 agent 时补 bootstrap agent | `apps/studio/main.js` | — | 只补一次 | — | — |
| PER-006 | P1 | XS | READY | test | restore failure fallback bootstrap 不覆盖坏 save | same | — | 用户可诊断坏数据 | — | — |

### 16.7 Product panels / verification UI

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| UI-001 | P1 | XS | READY | test | AppShell 只允许已知 context view | `AppShell.js`/store | — | invalid view 不破坏 layout | — | — |
| UI-002 | P1 | XS | READY | test | SceneExplorer object list 与 ObjectStore 同步 | `SceneExplorer.tsx` | — | spawn/remove immediate reflect | — | — |
| UI-003 | P1 | XS | READY | test | ObjectInspector missing selection 显示空态 | `ObjectInspector.tsx` | — | no exception | — | — |
| UI-004 | P1 | XS | READY | test | ObjectInspector mutation action 走 tools/runtime contract | same | — | 不直接改 Three object | — | — |
| UI-005 | P1 | XS | READY | test | RunsPanel addRun 顺序最新/最旧策略固定 | `RunsPanel.js` | — | deterministic | — | — |
| UI-006 | P1 | XS | READY | test | TaskPanel capability unavailable 时禁 Agent submit | `TaskPanel.js` | AGT-033 | UI 不发 doomed request | — | — |
| UI-007 | P1 | XS | READY | test | TaskPanel busy 时不双 submit | same | — | single active run | — | — |
| UI-008 | P1 | XS | READY | test | GenerationJobCenter JSON inputs parse error 可见 | `GenerationJobCenter.js` | — | 不提交 malformed job | — | — |
| UI-009 | P1 | XS | READY | test | generation status label 覆盖全部 canonical states | same | GEN-018 | unknown 有 fallback | — | — |
| UI-010 | P1 | XS | READY | test | terminal job 不显示 cancel action | same | — | action matrix正确 | — | — |
| UI-011 | P1 | XS | READY | test | ResourceLibrary 同时列 Assets/Artifacts/Environments | `ResourceLibrary.js` | — | 分类无重复 | — | — |
| UI-012 | P1 | XS | READY | test | current environment 标记唯一 | same | — | one current | — | — |
| UI-013 | P1 | XS | READY | test | ArtifactTray action 对 asset-ready 才允许 place/test | `ArtifactTray.tsx` | ASSET-035 | provisional action 策略明确 | — | — |
| UI-014 | P1 | S | READY | test | AssetAgentVerifier 按 manifest actions 选择最小 agent test | `AssetAgentVerifier.js` | — | static/pickup/open 各 route | — | — |
| UI-015 | P1 | S | READY | test | verifier failure 不把 Asset admission 提升 ready | same | VER-009 | runtime evidence gate | — | — |
| UI-016 | P1 | XS | READY | test | runtime tests 六项 ID 唯一且稳定 | `AgentRuntimeTestRunner.js` | RUN-004 | UI/automation 可引用 | — | — |
| UI-017 | P1 | S | READY | test | 每个 runtime test 都恢复/不污染后续测试必要状态 | same | — | 连续 run all 稳定 | — | — |
| UI-018 | P1 | XS | READY | test | DeveloperSettings 不显示 secret token/API key | `DeveloperSettings.js` | — | DOM 无 secret | — | — |
| UI-019 | P1 | XS | READY | test | debug layers 可单独启停且 dispose | `bindDebugLayers.js`,`DebugOverlay.js` | — | no duplicate overlay | — | — |
| UI-020 | P2 | S | DISCOVERY | UX | 对 Build/Task/Resources/Inspect/Runs 做每页 Primary Job audit | Studio UI | — | 每页输出 1 句 Primary Job + 1 个 primary CTA | — | — |

## 17. Observatory：诊断基线，不再扩成第二套产品 UI

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| OBSV-001 | P1 | XS | READY | docs | 在 Observatory README 明确 Deprecated labs 不接新产品能力 | `apps/observatory/README.md` | — | policy 写清 | — | — |
| OBSV-002 | P1 | XS | READY | test | LabRegistry duplicate lab id 拒绝 | `LabRegistry.js` | — | stable error | — | — |
| OBSV-003 | P1 | XS | READY | test | ScenarioRegistry duplicate scenario id 拒绝 | `ScenarioRegistry.js` | — | stable error | — | — |
| OBSV-004 | P1 | XS | READY | test | ScenarioRunner 前一次 scenario teardown 后再启动下一项 | `ScenarioRunner.js` | — | no shared native state | — | — |
| OBSV-005 | P1 | XS | READY | test | ScenarioRunner run error 也执行 cleanup | same | — | finally verified | — | — |
| OBSV-006 | P1 | XS | READY | test | SimulationClock pause 时不 step | `SimulationClock.js` | — | count fixed | — | — |
| OBSV-007 | P1 | XS | READY | test | FrameCadence 只在目标 cadence 触发 expensive refresh | `FrameCadence.js` | — | bounded refresh | — | — |
| OBSV-008 | P1 | XS | READY | test | RendererQuality pixelBudget clamp viewport DPR | `RendererQuality.js` | — | pixel count <= budget | — | — |
| OBSV-009 | P1 | XS | READY | test | debug visual dispose 递归释放 geometry/material | `DebugVisualPrimitives.js` | — | dispose count exact | — | — |
| OBSV-010 | P1 | XS | READY | test | physics backend selector 只允许 rapier/jolt | `labs/physics/backends.js` | — | unknown backend fail | — | — |
| OBSV-011 | P1 | S | READY | parity | PhysicsStateComparator 对 body pose tolerance 可配置 | `PhysicsStateComparator.js` | PHY-130 | report 不要求 bitwise equal | — | — |
| OBSV-012 | P1 | S | READY | parity | manifest collider vs runtime physics snapshot 对照 | `ManifestColliderSnapshot.js` | PHY-047 | missing/extra/pose mismatch 分开 | — | — |
| OBSV-013 | P1 | XS | READY | test | NormalizedColliderRenderer box/cylinder/capsule/convex shape coverage | visualizer | — | unsupported shape 明确 | — | — |
| OBSV-014 | P1 | S | READY | scenario | 保留 gravity scenario 作为 backend smoke | `labs/physics/scenarios/gravity.js` | — | Rapier/Jolt 都能跑 | — | — |
| OBSV-015 | P1 | S | READY | scenario | 保留 collision scenario 作为 backend parity smoke | collision scenario | PHY-135,PHY-138 | contact semantic 可比较 | — | — |
| OBSV-016 | P1 | S | READY | scenario | 保留 hinge scenario 作为 joint parity smoke | hinge scenario | PHY-051,PHY-056 | open coordinate converges | — | — |
| OBSV-017 | P1 | S | READY | scenario | stack scenario 只作为 stress baseline，不承诺 exact parity | stack scenario | — | 输出 settle/count metrics | — | — |
| OBSV-018 | P2 | S | READY | cleanup | 标记旧 SpatialLab UI Deprecated badge | spatial lab | OBSV-001 | 用户不误以为主产品入口 | — | — |
| OBSV-019 | P2 | S | READY | cleanup | 标记旧 NavigationLab UI Deprecated badge | nav lab | OBSV-001 | 同上 | — | — |
| OBSV-020 | P2 | S | READY | cleanup | 标记旧 InteractionLab UI Deprecated badge | interaction lab | OBSV-001 | 同上 | — | — |
| OBSV-021 | P2 | S | READY | cleanup | 标记旧 AgentToolsLab UI Deprecated badge | agent lab | OBSV-001 | 同上 | — | — |
| OBSV-022 | P2 | S | READY | cleanup | 标记旧 Generation lab UI Deprecated badge | generation lab | OBSV-001 | 同上 | — | — |
| OBSV-023 | P1 | S | READY | keep | ResourceLab asset 浏览继续作为诊断资源入口 | `labs/resources/assets.js` | — | 无产品 mutation | — | — |
| OBSV-024 | P1 | XS | READY | test | Gaussian format detection PLY/SPZ signature/extension 冲突策略 | `gaussianPipeline.js` | — | bytes 优先/明确规则 | — | — |
| OBSV-025 | P1 | S | READY | test | prepareGaussianRuntimeVisual PLY→SPZ 后返回可加载 bytes | same | — | output format=spz | — | — |
| OBSV-026 | P1 | XS | READY | test | downloadBytes revoke object URL | same | — | browser resource cleanup | — | — |
| OBSV-027 | P2 | S | DISCOVERY | cleanup | 统计每个 Deprecated Lab 是否仍覆盖 production tests 不覆盖的场景 | observatory + tests | — | 每 lab keep/remove/migrate 三选一 | — | — |
| OBSV-028 | P2 | S | BLOCKED | cleanup | 只删除被 OBSV-027 判定完全重复的第一个 Lab | observatory | OBSV-027 | 删除一个 lab + tests/build pass | — | — |

## 18. Generated World / 3DGS / Environment Content

### 18.1 Generated world loader

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| GWR-001 | P1 | XS | READY | test | PLY mesh 解析后 geometry index/position 有效 | `modules/world/loadGeneratedWorld.js` | — | 可生成 trimesh collider | — | — |
| GWR-002 | P1 | XS | READY | test | GLB mesh 解析后至少一个 triangle mesh | same | — | 空 GLB fail | — | — |
| GWR-003 | P1 | XS | READY | test | unsupported mesh extension fail-closed | same | — | 明确错误 | — | — |
| GWR-004 | P1 | XS | READY | test | `geometryToTrimeshCollider` 非 indexed geometry 正确生成 indices | same | — | triangle count正确 | — | — |
| GWR-005 | P1 | XS | READY | test | indexed geometry 保留 index 数 | same | — | no duplication drift | — | — |
| GWR-006 | P1 | XS | READY | test | collider vertices 只含有限数 | same | — | NaN geometry 拒绝 | — | — |
| GWR-007 | P1 | XS | READY | test | y-up identity transform | same | — | mesh pose不变 | — | — |
| GWR-008 | P1 | XS | READY | test | z-up→y-up transform 正确 | same | STU-003 | known vertex fixture | — | — |
| GWR-009 | P1 | XS | READY | test | semantic schema v1 兼容 | same | — | annotation可读取 | — | — |
| GWR-010 | P1 | XS | READY | test | semantic schema v2 兼容 | same | — | annotation可读取 | — | — |
| GWR-011 | P1 | XS | READY | test | 未知 semantic schema fail-closed | same | — | 不猜字段 | — | — |
| GWR-012 | P1 | XS | READY | test | semantic transform 与 mesh coordinate transform 同一坐标系 | same | GWR-008 | annotation 与 geometry 对齐 | — | — |
| GWR-013 | P1 | XS | READY | test | nav artifact 缺失时 world 可加载但 navigation 状态明确 | same | — | no false nav ready | — | — |
| GWR-014 | P1 | S | READY | test | nav artifact 存在时绑定对应 Environment | same | — | environment.navigation metadata 保真 | — | — |
| GWR-015 | P1 | XS | READY | test | Gaussian/SPZ visual 缺失不影响 mesh world | same | REND-010 | physical world仍可运行 | — | — |
| GWR-016 | P1 | S | READY | test | Gaussian visual 加载失败只作为 visual diagnostic | same | REND-010 | no environment rollback | — | — |
| GWR-017 | P1 | XS | READY | test | generated Environment collider 使用 mesh trimesh | same | GWR-004 | Physics attach成功 | — | — |
| GWR-018 | P1 | XS | READY | test | generated Environment id 稳定来自 manifest/id | same | — | persistence 可引用 | — | — |
| GWR-019 | P1 | XS | READY | test | manifest relative URLs 相对 manifest URL resolve | `loadGeneratedWorldManifest` | — | nested path fixture正确 | — | — |
| GWR-020 | P1 | XS | READY | test | manifest absolute URL 不二次拼接 | same | — | URL保持 | — | — |
| GWR-021 | P1 | XS | READY | test | manifest 缺 mesh 必须失败 | same | — | visual-only 3DGS 不伪装可物理世界 | — | — |
| GWR-022 | P1 | S | READY | test | generated world load 后 Physics/Nav/Rendering 三域 ownership 分开 | same | — | mesh collider、nav、visual 各自可诊断 | — | — |
| GWR-023 | P1 | S | READY | verify | 用固定 generated-world fixture 跑 agent walk smoke | e2e | GWR-022,RUN-005 | agent 可在 mesh/nav 环境行走 | — | — |
| GWR-024 | P2 | S | DISCOVERY | research | 比较 PLY mesh 与 SPZ visual 的坐标/尺度误差 | experiment | GWR-012 | 记录 3 个 anchor 差值 | — | — |

### 18.2 内建 Content worlds

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| CNT-001 | P1 | XS | READY | test | environment IDs 唯一 | `modules/world/content/environments.js` | — | duplicate test | — | — |
| CNT-002 | P1 | XS | READY | test | resolveEnvironment 未知 id 返回 DEFAULT_ENVIRONMENT | same | — | fallback稳定 | — | — |
| CNT-003 | P1 | XS | READY | test | Monument Hall colliders 均有限且正尺寸 | `monumentHall.js` | — | content validation pass | — | — |
| CNT-004 | P1 | XS | READY | test | Ruined Courtyard colliders 均有限且正尺寸 | `ruinedCourtyard.js` | — | same | — | — |
| CNT-005 | P1 | XS | READY | test | Grand Urban Block colliders 均有限且正尺寸 | `grandUrbanBlock.js` | — | same | — | — |
| CNT-006 | P1 | XS | READY | test | createMonumentHall(loadAssets=false) 不触发 GLB fetch | content | — | fixture快速测试 | — | — |
| CNT-007 | P1 | XS | READY | test | createRuinedCourtyard(loadAssets=false) 不 fetch | content | — | same | — | — |
| CNT-008 | P1 | XS | READY | test | createGrandUrbanBlock(loadAssets=false) 不 fetch | content | — | same | — | — |
| CNT-009 | P1 | S | READY | viability | Monument Hall 跑 world viability | tooling experiment | CNT-003 | no hard finding | — | — |
| CNT-010 | P1 | S | READY | viability | Ruined Courtyard 跑 world viability | same | CNT-004 | no hard finding | — | — |
| CNT-011 | P1 | S | READY | viability | Grand Urban Block 跑 world viability | same | CNT-005 | no hard finding | — | — |
| CNT-012 | P1 | S | READY | scenario | 在一个内建 world 固化 cup→table pickup/place flagship fixture | tests/e2e | RUN-008 | one-click regression | — | — |
| CNT-013 | P1 | S | READY | scenario | 在一个内建 world 固化 cabinet open flagship fixture | tests/e2e | RUN-009 | one-click regression | — | — |
| CNT-014 | P2 | S | DISCOVERY | content | 盘点三个 world 重复静态 mesh/collider 定义 | content | — | 只输出重复率，不抽通用层 | — | — |

## 19. Asset Compiler Service（Python/FastAPI）

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| SVC-001 | P1 | XS | READY | test | `/health` 不初始化重模型/CoACD | `services/asset-compiler/app.py` | — | health快速返回 | — | — |
| SVC-002 | P1 | XS | READY | test | public URL validator 拒绝 localhost | same | — | 127.0.0.1/localhost fail | — | — |
| SVC-003 | P1 | XS | READY | test | public URL validator 拒绝 RFC1918 | same | — | 10/172.16/192.168 fail | — | — |
| SVC-004 | P1 | XS | READY | test | URL validator 拒绝 link-local/loopback IPv6 | same | — | ::1/fe80 fail | — | — |
| SVC-005 | P1 | XS | READY | test | URL scheme 只允许 http/https | same | — | file/ftp fail | — | — |
| SVC-006 | P1 | S | READY | test | 下载 redirect 后目标地址再次 SSRF 校验 | same | SVC-002 | public→private redirect fail | — | — |
| SVC-007 | P1 | XS | READY | test | Content-Length 超 MAX_ASSET_BYTES 下载前拒绝 | same | — | no body read | — | — |
| SVC-008 | P1 | S | READY | test | chunked download 超 MAX_ASSET_BYTES 中途停止 | same | — | bounded memory | — | — |
| SVC-009 | P1 | XS | READY | test | multipart upload 超限中途停止 | same | — | bounded memory | — | — |
| SVC-010 | P1 | XS | READY | test | compile endpoint 优先 verified upload path | same | — | URL legacy 路径单独可识别 | — | — |
| SVC-011 | P1 | XS | READY | test | `_scene_mesh` 多 mesh 合并后 vertex/face count 正确 | same | — | fixture exact | — | — |
| SVC-012 | P1 | XS | READY | test | `_scene_mesh` 空场景拒绝 | same | — | no fake collider | — | — |
| SVC-013 | P1 | XS | READY | test | CoACD 每 hull 输出 convexHull points 3N | same | — | schema-compatible | — | — |
| SVC-014 | P1 | XS | READY | test | CoACD failure 返回 explicit provider/compiler error | same | — | 不 fallback 伪 high-quality | — | — |
| SVC-015 | P1 | XS | READY | test | part_meshes 未知 GLB node 返回 per-part error | `part_geometry.py` | — | 其他 parts 继续 | — | — |
| SVC-016 | P1 | S | READY | test | rigid inverse 对纯 rotation+translation fixture | same | — | matrix product≈I | — | — |
| SVC-017 | P1 | XS | READY | test | non-rigid/scaled transform 明确处理策略 | same | — | reject/normalize 有测试 | — | — |
| SVC-018 | P1 | XS | READY | test | mesh_report volume/mass 只用有限非负值 | same | — | degenerate mesh 不 NaN | — | — |
| SVC-019 | P1 | XS | READY | test | density<=0 拒绝 | same | — | no negative mass | — | — |
| SVC-020 | P1 | S | READY | test | compile part geometry metadata 缺 parts 安全返回 | `app.py` | — | no crash | — | — |
| SVC-021 | P1 | XS | READY | test | URDF parser 拒绝 XML 外部实体/危险输入 | `urdf_proposal.py` | — | no XXE/path read | — | — |
| SVC-022 | P1 | XS | READY | test | URDF joint parent/child/link refs 完整 | same | — | dangling ref fail | — | — |
| SVC-023 | P1 | XS | READY | test | URDF revolute/continuous/prismatic 类型映射 | same | — | proposal type canonical | — | — |
| SVC-024 | P1 | XS | READY | test | URDF axis/limit 转 proposal 数值有限 | same | — | invalid numeric fail | — | — |
| SVC-025 | P1 | S | READY | test | `/proposal/urdf` 返回 proposal 仍标 proposal，不是 verified | app+urdf | — | trust level preserved | — | — |
| SVC-026 | P1 | S | READY | contract | JS RemoteEnrichment 与 Python service response fixture parity | service + compiler test | — | 同 fixture schema exact | — | — |
| SVC-027 | P2 | S | DISCOVERY | deployment | 记录 service cold import / first CoACD / warm CoACD 三段耗时 | benchmark | — | 三个 timing | — | — |

## 20. Python SDK：Connector contract 的第二实现必须与 JS 保持 parity

### 20.1 Artifact / contracts

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| SDK-001 | P1 | XS | READY | test | `Artifact.from_file` 计算 bytes/hash | `contracts.py` | — | sha256 exact | — | — |
| SDK-002 | P1 | XS | READY | test | Artifact.summary role 保真 | same | — | id/hash/bytes/mime/format/role | — | — |
| SDK-003 | P1 | XS | READY | test | Artifact.to_dict relative path 不允许逃出 base | same | — | path safety | — | — |
| SDK-004 | P1 | XS | READY | test | write_atomic 失败不留下 partial destination | `artifacts.py` | — | old file intact/no temp leak | — | — |
| SDK-005 | P1 | XS | READY | test | GLB prefix magic/version/length 校验 | same | ART-024 | 与 JS content gate parity | — | — |
| SDK-006 | P1 | XS | READY | parity | Python GLB validator 与 JS 对坏 fixture 同意/拒绝一致 | sdk+artifact tests | SDK-005 | fixture matrix parity | — | — |

### 20.2 Job request canonicalization

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| SDK-007 | P1 | XS | READY | test | sanitize_job_data 拒绝 NaN/Infinity | `jobs.py` | — | stable ContractError | — | — |
| SDK-008 | P1 | XS | READY | test | secret-like fields 拒绝 | same | GEN-016 | Python/JS parity | — | — |
| SDK-009 | P1 | XS | READY | test | JS object key order 数字 key 优先语义 parity | same | — | known fixture hash 与 JS identical | — | — |
| SDK-010 | P1 | XS | READY | test | UTF-16 key sort parity | same | — | emoji/non-BMP fixture hash identical JS | — | — |
| SDK-011 | P1 | XS | READY | test | JS number serialization -0/float edge parity | same | — | stable_json identical | — | — |
| SDK-012 | P1 | XS | READY | test | JobRequest canonical 不包含 derived hash/key | same | — | canonical fields only | — | — |
| SDK-013 | P1 | XS | READY | parity | request_hash 与浏览器 Generation request hash fixture 一致 | same + JS | GEN-022 | exact hex equality | — | — |
| SDK-014 | P1 | XS | READY | test | idempotency_key 由 request_hash 稳定派生 | same | — | same request same key | — | — |

### 20.3 Connector session

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| SDK-015 | P1 | XS | READY | parity | normalize_connector_endpoint 与 JS loopback规则一致 | `connector_session.py` | GEN-001 | fixture parity | — | — |
| SDK-016 | P1 | XS | READY | parity | normalize_client_origin 与 JS origin规则一致 | same | — | fixture parity | — | — |
| SDK-017 | P1 | XS | READY | test | scopes 去重/未知 scope 拒绝 | same | GEN-003 | parity | — | — |
| SDK-018 | P1 | XS | READY | test | pair response contract/client/revision/hash/expiry 校验 | same | GEN-004 | 每字段 mismatch fixture | — | — |
| SDK-019 | P1 | XS | READY | test | assert_active expired session 抛 ConnectionRequiredError | same | GEN-007 | stable error | — | — |
| SDK-020 | P1 | XS | READY | test | request 禁止 token echo | same | — | response body 含 token fail | — | — |
| SDK-021 | P1 | XS | READY | test | revoke_remote 后 local revoke 即使远端错误也行为明确 | same | — | state不含可用 token | — | — |
| SDK-022 | P1 | XS | READY | test | request path 不允许逃出 connector origin | same | GEN-010 | encoded traversal fail | — | — |

### 20.4 Capability snapshot

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| SDK-023 | P1 | XS | READY | test | recursive secret field reject | `connector_capabilities.py` | GEN-011 | parity | — | — |
| SDK-024 | P1 | XS | READY | test | capability input/output role normalize | same | — | canonical lists | — | — |
| SDK-025 | P1 | XS | READY | test | provider id 与 capability provider scope 一致 | same | — | cross-provider fail | — | — |
| SDK-026 | P1 | XS | READY | test | snapshot identity/revision/hash/expiry 与 session 一致 | same | GEN-012 | parity | — | — |
| SDK-027 | P1 | XS | READY | test | resolve_job_capability unknown provider/operation fail | same | — | clear ContractError | — | — |
| SDK-028 | P1 | XS | READY | test | create_job_transport 只用 resolved capability path | same | — | no arbitrary URL | — | — |
| SDK-029 | P1 | S | READY | parity | 同 capability fixture JS/Python normalized snapshot exact | SDK+JS tests | GEN-015 | JSON deep equality | — | — |

### 20.5 Connector jobs / JobController

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| SDK-030 | P1 | XS | READY | test | ConnectorJobCapability versioned operation 校验 | `connector_jobs.py` | GEN-017 | parity | — | — |
| SDK-031 | P1 | XS | READY | test | build_submit 只允许 capability input keys/outputRoles | same | GEN-024 | extra key fail | — | — |
| SDK-032 | P1 | XS | READY | test | parse_job_state required identity fields | same | — | missing fail | — | — |
| SDK-033 | P1 | XS | READY | test | progress percent/step 只接受安全类型 | same | — | no NaN | — | — |
| SDK-034 | P1 | XS | READY | test | job result artifact summaries 校验 | same | — | invalid artifact fail | — | — |
| SDK-035 | P1 | XS | READY | test | transport job id path 安全 | same | — | slash/traversal id fail | — | — |
| SDK-036 | P1 | XS | READY | test | submit response identity 与 request exact | same | GEN-025 | mismatch fail | — | — |
| SDK-037 | P1 | XS | READY | test | JobState terminal canonical statuses | `job_client.py` | GEN-018 | parity set | — | — |
| SDK-038 | P1 | XS | READY | test | JobController cache list 稳定顺序 | same | — | deterministic | — | — |
| SDK-039 | P1 | XS | READY | test | observe stale job state 不回退 canonical | same | GEN-021 | parity | — | — |
| SDK-040 | P1 | XS | READY | test | identity immutable fields 不可变化 | same | — | conflict error | — | — |
| SDK-041 | P1 | XS | READY | test | illegal status transition fail | same | GEN-018 | parity | — | — |
| SDK-042 | P1 | XS | READY | test | cancel terminal job 返回 stable action/no network | same | — | bounded | — | — |

### 20.6 Artifact transport / pipeline

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| SDK-043 | P1 | XS | READY | test | select_job_artifact 按 role 精确选择 | `connector_artifacts.py` | — | ambiguous/missing fail | — | — |
| SDK-044 | P1 | XS | READY | test | Content-Length 与 summary.bytes mismatch fail before stream | same | — | no file write | — | — |
| SDK-045 | P1 | S | READY | test | stream 超 summary.bytes/maxBytes 中途 abort | same | ART-020 | temp removed | — | — |
| SDK-046 | P1 | XS | READY | test | downloaded sha256 mismatch 删除 temp | same | — | no corrupt destination | — | — |
| SDK-047 | P1 | XS | READY | test | GLB content validation 在 rename destination 前执行 | same | SDK-005 | bad GLB no final file | — | — |
| SDK-048 | P1 | XS | READY | test | ConnectorJobRunner timeout bounded | `connector_pipeline.py` | — | timeout error含 job id | — | — |
| SDK-049 | P1 | XS | READY | test | JobRunner terminal failure 不继续 artifact download | same | — | no transport download | — | — |
| SDK-050 | P1 | S | READY | test | TextTo3DPipeline parent image job 链路正确 | same | GEN-036 | parent relation exact | — | — |
| SDK-051 | P1 | S | READY | test | TextTo3DPipeline image artifact role/mime 校验 | same | — | wrong artifact fail | — | — |
| SDK-052 | P1 | S | READY | e2e | Python SDK fixture Connector text→image→3D contract E2E | sdk tests | SDK-050 | no external provider required | — | — |

### 20.7 Modal request builders / CLI / settings

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| SDK-053 | P1 | XS | READY | test | Modal2D builder prompt 空字符串拒绝 | `modal2d.py` | — | no invalid job | — | — |
| SDK-054 | P1 | XS | READY | test | Modal2D builder provider/operation/version 固定 | same | — | request contract exact | — | — |
| SDK-055 | P1 | XS | READY | test | Modal3D builder source mime/role 必须 image | `modal3d.py` | — | wrong artifact fail | — | — |
| SDK-056 | P1 | XS | READY | test | Modal3D parent job relation 保真 | same | — | parent exact | — | — |
| SDK-057 | P1 | XS | READY | test | CLI probe 不打印 bearer token | `cli.py` | — | stdout/stderr no secret | — | — |
| SDK-058 | P1 | XS | READY | test | CLI create 输出最终 artifact path/hash | same | — | user可验证结果 | — | — |
| SDK-059 | P1 | XS | READY | test | Settings env 优先级明确 | `settings.py` | — | explicit env > handoff/default | — | — |
| SDK-060 | P1 | XS | READY | test | Windows credential handoff malformed payload fail-safe | same | — | no partial credential | — | — |
| SDK-061 | P1 | XS | READY | test | non-Windows path 不 import Win32 API 失败 | same | — | Linux import works | — | — |

## 21. Local Capability API / Dev adapters

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| API-001 | P1 | XS | READY | test | capabilityAvailability 未配置环境时全部 unavailable | `CapabilityAdapterRegistry.js` | — | stable payload | — | — |
| API-002 | P1 | XS | READY | test | agent capability 只在所需 env 完整时 available | same | — | partial env=false | — | — |
| API-003 | P1 | XS | READY | test | asset compile capability 只在 adapter endpoint 完整时 available | same | — | partial env=false | — | — |
| API-004 | P1 | XS | READY | test | invoke unknown capability 404/明确错误 | same | — | no arbitrary proxy | — | — |
| API-005 | P1 | XS | READY | test | invoke capability 只转发 allowlisted method/path/body | same | — | header/URL surface bounded | — | — |
| API-006 | P1 | XS | READY | test | upstream response status/content-type 保留安全子集 | same | — | no hop-by-hop headers | — | — |
| API-007 | P1 | XS | READY | test | capability status endpoint 不返回 secret env value | same | — | only booleans/reason | — | — |
| API-008 | P1 | XS | READY | test | dev middleware 只挂已知 capability route | `capabilityDevPlugin.js` | — | unknown route next() | — | — |
| API-009 | P1 | XS | READY | test | dev middleware async error 返回 bounded response | same | — | Vite dev server 不崩 | — | — |
| API-010 | P1 | S | READY | parity | Vercel API 与 Vite dev capability status fixture parity | API tests | — | same JSON schema | — | — |

## 22. Tooling / CI / Architecture gates

| ID | P | Size | State | Kind | 最小任务 | Location | Depends | DoD | Owner | Evidence |
|---|---|---:|---|---|---|---|---|---|---|---|
| CI-001 | P0 | XS | READY | verify | `npm run architecture:validate` 当前通过 | package scripts | — | exit 0 | — | — |
| CI-002 | P0 | XS | READY | verify | `npm run assets:validate` 当前通过 | package scripts | — | exit 0 | — | — |
| CI-003 | P0 | S | READY | verify | `npm run world:viability` 当前通过 | package scripts | — | exit 0 | — | — |
| CI-004 | P0 | XS | READY | verify | `npm run typecheck` 当前通过 | package scripts | — | exit 0 | — | — |
| CI-005 | P0 | S | READY | verify | `npm run test` 当前通过 | package scripts | — | exit 0 | — | — |
| CI-006 | P0 | S | READY | verify | `npm run build` 当前通过 | package scripts | — | exit 0 | — | — |
| CI-007 | P0 | S | READY | verify | `npm run check` 作为最终 local gate | package scripts | CI-001..006 | exit 0 | — | — |
| CI-008 | P1 | XS | READY | test | repository architecture validator 捕获非法顶层目录 | `validate-repository-architecture.mjs` | — | fixture fail | — | — |
| CI-009 | P1 | XS | READY | test | domain boundary validator 捕获 product→Observatory import | `validate-domain-boundaries.mjs` | — | fixture fail | — | — |
| CI-010 | P1 | XS | READY | test | convergence validator 捕获重复 legacy architecture abstraction | `validate-convergence.mjs` | — | fixture fail | — | — |
| CI-011 | P1 | XS | READY | test | asset validator 对所有 builtin manifests 给 filename+reason | `validate-assets.mjs` | — | invalid fixture 可定位 | — | — |
| CI-012 | P1 | XS | READY | test | CI 在 Windows line-ending 不产生 generated diff | `.gitattributes`/workflow | — | checkout+check clean | — | — |
| CI-013 | P1 | XS | READY | workflow | agentscape-check workflow 显式跑 architecture/assets/type/test/build | `.github/workflows/agentscape-check.yml` | — | steps 与 npm check一致 | — | — |
| CI-014 | P1 | XS | READY | workflow | production-smoke 不依本机 `.env.local` | workflow | — | secrets only from CI | — | — |
| CI-015 | P1 | XS | READY | workflow | Python SDK publish 先跑 SDK tests | python-sdk-publish workflow | — | publish job depends test | — | — |
| CI-016 | P1 | S | READY | contract | 增加 JS/Python connector contract shared fixture | `tests/contracts`, `sdk/python/tests` | SDK-029 | 同一 JSON fixture 两边消费 | — | — |
| CI-017 | P1 | S | READY | contract | shared fixture 覆盖 request hash/idempotency | same | SDK-013 | exact parity | — | — |
| CI-018 | P1 | S | READY | contract | shared fixture 覆盖 capability snapshot | same | SDK-029 | exact parity | — | — |
| CI-019 | P1 | S | READY | contract | shared fixture 覆盖 job state transitions | same | SDK-041 | parity | — | — |
| CI-020 | P1 | S | READY | contract | shared fixture 覆盖 artifact GLB gate | same | SDK-006 | parity | — | — |
| EXP-001 | P1 | S | READY | experiment | real GLB admission experiment 固定输入 hash | `experiments/asset/001-real-glb-admission.mjs` | — | 输出 reproducible | — | — |
| EXP-002 | P2 | S | READY | experiment | grid navigation experiment 明确标 non-production backend | `experiments/navigation/001-grid-navigation-backend.mjs` | — | 不被 product import | — | — |
| EXP-003 | P2 | S | READY | experiment | Jolt rigid-body experiment 记录 backend API drift | `experiments/physics/001-jolt-rigid-body.mjs` | — | version/result 在输出 | — | — |
| EXP-004 | P1 | S | READY | experiment | existing-assets-world 验证无 generation 路径 | `experiments/world/001-existing-assets-world.mjs` | — | deterministic world-ready | — | — |
| EXP-005 | P1 | S | READY | experiment | world viability 输出每 stage timing | `experiments/world/002-world-viability.mjs` | — | stage table | — | — |
| EXP-006 | P1 | XS | READY | probe | probe-test-agent 输出 gateway health+one read-only skill | `scripts/probe-test-agent.mjs` | RUN-001 | exit 0 | — | — |
| EXP-007 | P1 | S | READY | probe | probe-real-apple-world 输出 Artifact→Asset→World evidence | `scripts/probe-real-apple-world.mjs` | ASSET-034 | IDs/hash/admission/status | — | — |
| DOC-001 | P1 | XS | READY | docs | `status-and-roadmap.md` 链接到本 execution backlog | docs | — | roadmap 与执行板互相导航 | — | — |
| DOC-002 | P1 | XS | READY | docs | physics.md 更新“backend abstraction 已完成”状态 | `docs/physics.md` | PHY-001 | 不再留过时 todo | — | — |
| DOC-003 | P1 | XS | READY | docs | navigation.md 标出 Locomotion 已独立存在 | `docs/navigation.md` | LOC-001 | 删除过时“not do”误导 | — | — |
| DOC-004 | P1 | XS | READY | docs | Observatory README 明确 Studio 主产品界面 | docs | OBSV-001 | ownership清楚 | — | — |
| DOC-005 | P1 | XS | READY | docs | execution backlog 每次架构改动要求同步功能地图 | this file | — | maintenance rule写入贡献规范/本文件 | — | — |

## 23. 实习生领取任务的模板

复制下面一行，分配任务时把 `State` 改成 `IN_PROGRESS`，填 `Owner`；PR 合并后改成 `DONE` 并填 `Evidence`。

```text
| XXX-000 | P1 | XS | READY | test/code/docs/verify | 一个可观察结果 | `path/to/file` | dependency-or-— | 一条可执行/可观察 DoD | — | — |
```

### PR 最小验收模板

```text
Task ID: XXX-000
Scope: 只完成该任务，不顺便重构相邻模块。
Changed production files: <= 1（跨 contract 任务例外，但必须在任务中显式写明）
Changed/added test files: <= 1
Verification: <exact command>
Result: PASS / FAIL
Evidence: <test name / commit / PR>
Follow-ups discovered: <new task IDs, do not scope-creep>
```

## 24. 任务拆解的停止条件

“无限拆解”在工程上不能真的无限；否则会变成“改一行就是一个任务”，失去交付意义。本表采用最小可推进单元作为停止条件：

- 一个人不需要再做架构设计就能开始；
- 修改范围通常能在 1–2 个文件内定位；
- 成败能由一个测试、一个 probe 或一个明确观察判断；
- 预计 20–90 分钟；
- 完成后 repository truth 有一个明确、独立的增量。

如果领取者读完任务仍要决定“到底做哪一半”，该任务就还不够小，应继续拆。
