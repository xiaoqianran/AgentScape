# AgentScape 替代者与相邻架构审计

> 目的：定期检查哪些开源项目可能替代 AgentScape 的某一层，并只吸收已经被成熟实现证明的结构。不是功能清单，也不是按 Star 排名。
>
> 本轮源码复核时间：2026-08-23。结论来自本地浅克隆 + CodeGraph 调用图/源码复核；仓库状态会继续变化。
>
> **1.9 落地说明：** Motion Sweep 已在 1.8 实现；本文随后列出的 Navigation Truth 已在 1.9 以 Recast/Detour static NavMesh 落地。动态障碍/TileCache 仍是下一阶段。

## 结论先行

没有一个项目同时覆盖 AgentScape 当前的四个核心约束：

```text
Browser-native Runtime
        +
GLB-first / generator-neutral input
        +
Agent 与 Human 共用同一权威 World API
        +
普通 GLB → 可验证 executable Part / Physics / Action 的编译链
```

但若把系统拆层，已经存在非常强的替代者：

| 层 | 最强替代/基准 | 对 AgentScape 的压力 |
|---|---|---|
| 浏览器 3D 编辑 / Play Runtime | Gizmo、Feather Engine、Grudge Studio Forge | 高 |
| AI 辅助 Web 3D 创作 | Trigen、Aedifex、Feather Engine | 高 |
| 物理 / Articulation 仿真 | Genesis、SAPIEN | 很高 |
| Household object state / action | OmniGibson / BEHAVIOR-1K、AI2-THOR | 很高 |
| Navigation / rearrangement task | Habitat-Sim / Habitat-Lab | 高 |
| Agentic simulator-ready scene generation | SAGE、EmbodiedGen、SceneSmith | 很高 |
| MCP 控制现有 Three.js | threejs-devtools-mcp | 中；更像互补层 |
| Headless 程序化 3D 建模 | Chisel | 中；能力窄但架构极简 |

因此 AgentScape 不应试图在“通用编辑器功能数量”“GPU 仿真吞吐”“机器人 benchmark 数量”上复制这些项目。真正值得守住的差异是：

```text
任意 GLB
  ↓
证据 / Proposal
  ↓
可执行 Part / Collider / Joint / Target
  ↓
Runtime 真能执行
  ↓
Verifier 真能否证
  ↓
同一能力同时暴露给 Human 与 Agent
```

## 1. Gizmo：最接近的 Browser Agent World 竞争者

**许可证：Apache-2.0（engine）**。

CodeGraph 显示其 editor 大量使用统一 `EditorCommand`：`execute / undo / redo`，并通过 `BulkCommand` 组合批操作；ECS stores 可序列化，automation / editor / engine 共享较多底层命令与资源。

值得借鉴：

- Human、automation、未来 MCP 尽量共享同一 mutation path。
- Bulk operation 是一个命令，而不是 N 个各自拥有历史事务的命令。
- Stable entity identity 与可序列化 Store 是长期世界状态的重要基础。

AgentScape 已经有 `SkillRegistry + WorldRuntime.mutate + CommandHistory`，**不要为了“像 Gizmo”再引入 ECS/Store 框架**。只有当现有 ObjectStore 出现真实查询/组件化瓶颈时再评估。

真正差异：Gizmo 更像可编程游戏/world engine；AgentScape 当前更强的是 GLB → Agent-Ready Asset 的 provenance / quality / executable articulation 编译链。

## 2. Feather Engine：目前最直接的浏览器产品型竞争者之一

**许可证：MIT**。

当前源码不是简单 demo：Three/R3F + Rapier Play Runtime、AI tools、可视化脚本、project/package、undo/redo、prefab、runtime graph 都已经形成较完整产品面。`GraphRuntime` 会预编译 node / exec/value wiring 并缓存，避免每帧重复扫描 graph；AI 的 undo/redo 直接复用 editor history。

值得借鉴：

- 对频繁执行的声明式图，**编译一次、运行多次**，不要每 tick 重新搜索边。
- AI、Toolbar、快捷键共享同一个 undo/redo implementation。
- Project format 与 runtime graph 分开：持久化结构可以丰富，但 Runtime 只持有执行所需的 compact representation。

不应照抄：

- AgentScape 当前没有已证明需要的 Blueprint/Visual Script 产品需求，不能为“功能对齐”增加一整套 Graph Runtime。
- Feather 的强项是 game-authoring breadth；AgentScape 的核心不是成为浏览器 Unity。

## 3. Grudge Studio Forge：浏览器 Runtime / Nav 的重要威胁

**本轮仓库根部未发现明确 LICENSE；CodeGraph 索引曾被中断，故只研究思想，不复制源码。**

源码可确认它已有 Three/R3F + Rapier、CommandStack、Play Runtime、XState Agent、baked navmesh、CCT、trigger、script runtime、asset-backed navmesh persistence。

最值得关注的是导航：scene 保存 `navmeshAssetId / navmeshBlobKey`，Play Runtime 使用已 bake 的 navmesh，Agent runtime 有 path planner 与 stuck handling。

对 AgentScape 的现实压力：我们的 `SpatialSystem.findFreeSpace()` 是局部 placement search，不是 navigation。**“可到达”目前仍是明显能力缺口。**

不应复制其实现：许可证不清晰，而且其 Scene/Play/React runtime 与我们的 Runtime ownership 不同。应该研究成熟 Recast/Detour Web 实现后，在 AgentScape 自己的 Spatial/Skill 契约中增加 navigation truth。

## 4. Trigen：AI 3D 创作的直接产品替代者

**许可证：MIT**。

CodeGraph 的 `ToolRegistry / ToolBase / ToolResult / SceneDelta` 很清晰。Tool 带 name、description、schema、category、`requires_approval`；结果显式包含 success/message/deltas/data。

值得借鉴：

- Tool 的风险/审批提示可以是能力元数据，而不应散落在 UI。
- Tool result 应结构化，而不是 handler 任意返回字符串。
- Delta 适合 UI preview / explanation。

但其 undo/redo 工具会发 `editor_undo/editor_redo` delta 给前端历史，权威 mutation/history 并不像 AgentScape 当前一样集中。因此**不要把 AgentScape 退回“Agent 发 UI 指令”模式**。

## 5. Aedifex：精简数据依赖与 Preview/Commit 模式的好教材

**许可证：MIT**。

这是很值得学习代码风格的仓库。其 `GeometryContext` 把 `resolve / children / siblings / parent / materials / levelData` 显式传给纯 geometry builder，并明确避免 builder 直接 import scene store。复杂跨兄弟数据先批量预计算，再注入 builder，避免 O(N²) 隐式查询。

其交互工具普遍区分：

```text
begin
  ↓
preview
  ↓
snap / validate
  ↓
apply live draft
  ↓
commit 或 cancel/restore
```

值得借鉴：

- Compiler Pass / geometry helper 继续保持显式 context，不读取全局 Runtime singleton。
- 未来 Agent “建议性编辑”如果需要 preview，应采用 draft→validate→commit，而不是先写 World 再补救。
- 需要跨对象计算时优先一次预计算，而不是每个对象各自全场扫描。

AgentScape 现有 Compiler context 已符合这个方向，**不需要新增 GeometryManager/ContextManager**。

## 6. Chisel：最值得学习“少代码”的项目

**许可证：MIT**。

Chisel 很小：核心是 deterministic scene reducer / CSG expression，MCP 与 Web 共用同一 engine，headless、GPU-free，最终 export GLB/OBJ。

值得借鉴的不是 CSG，而是约束：

```text
输入 operation
  ↓
纯/确定性 apply
  ↓
唯一 Scene state
  ↓
Web / MCP 只是 adapter
```

这正支持 AgentScape 当前原则：不要为了 MCP 再造一份 Tool API；不要让 UI 成为权威状态源。

## 7. threejs-devtools-mcp：应视为互补工具，不是 World Runtime

**许可证：MIT**。

它通过 WebSocket bridge 连接已有 Three.js app，提供大量 scene inspect/edit/performance/export 工具。serializer 会省略默认值、限制 child 展开以降低 token 消耗，这是很实用的 Agent context 设计。

值得借鉴：

- Agent observation 默认应 compact，省略默认/无关字段。
- 对 Scene Tree 查询应支持稳定 path/name/UUID resolution，而不是把整棵树灌给模型。
- 性能 introspection 可以是 Agent-readable observation。

不能替代 AgentScape：它操作的是已有 Three.js Scene，没有 Asset Compiler、Manifest readiness、物理语义真值、统一事务与 verified action contract。

## 8. Genesis：物理/机器人平台层面的强替代者

**许可证：Apache-2.0**。

CodeGraph 显示 `RigidEntity / RigidLink / RigidJoint` 是一等结构，关节状态、驱动、传感器、批量仿真与多 solver 远比浏览器 Rapier 深。

值得借鉴：

- Link/Joint 是物理模型本体，不应只作为“门”的 UI 特例。
- State read/write 要可批量、可复现。
- Sensors 应最终成为 World capability，而不是 editor-only camera helper。

不应追赶：GPU batch simulator、多 material solver、robot training throughput。AgentScape 的目标是 browser-native world/runtime，不是重造 Genesis。

## 9. SAPIEN / ManiSkill：Joint 与 Evaluation 的基准

**许可证：Apache-2.0**。

SAPIEN 的 `JointRecord` 显式保存 `pose_in_parent`、`pose_in_child`、joint type、limits、friction/damping；PhysX joint 同样把两侧 local pose 当一等数据。相比之下，AgentScape 当前 `axis + parentAnchor + childAnchor` 是一个有意保守的子集。

结论：未来若 Rapier API 能可靠表达两侧 frame orientation，应该扩展为完整 `parentFrame / childFrame`，而不是继续给 axis 增加特殊规则；**但在 Runtime 不能执行前不要扩 Schema**。

ManiSkill 的 `evaluate()` 把 task success/failure 和 observation/reward 分开，是很好的 verifier 边界：验证逻辑不应塞进 action handler。

## 10. OmniGibson / BEHAVIOR-1K：当前最值得借鉴的“语义动作”系统

OmniGibson 的 object states 是注册化的一等能力，既有 absolute state，也有 relative state；transition rules 可以改变对象集合/状态。BEHAVIOR 任务以初始条件和目标条件表达长期任务。

最有价值的是 `ActionPrimitiveError.Reason` 的阶段化失败：

```text
PRE_CONDITION
SAMPLING
PLANNING
EXECUTION
POST_CONDITION
```

这比单一 `ok: false` 更适合 Agent 修复行为。

同时必须区分：OmniGibson 的 symbolic semantic primitives 明确可以通过“直接设置 post-condition”工作，并不等于低层物理执行。因此 AgentScape 不应该因为高层状态 API 成熟，就降低“Runtime 真执行”的门槛。

本轮审计当时的真实缺口是：`SkillRegistry` 只有 `invalid_input / forbidden / handler_error` 等通用错误，`ArticulationVerifier` 也主要报告 accepted/finite/moved。1.8 已按这里的结论直接扩现有 verifier report，以阶段化失败语义补齐 Motion Sweep，没有新建 ErrorManager。

## 11. AI2-THOR：高层动作返回契约的成熟基准

AI2-THOR 的 `Controller.step()` 每个 action 都得到 engine event，metadata 中有 `lastActionSuccess / errorCode / errorMessage`；Unity 端的 Open/Pickup/Put 等是实际 engine action。

值得借鉴：

- 每个高层动作都应该有机器可读 success/failure，而不仅是事件日志。
- `InvalidAction / MissingArguments / AmbiguousAction / InvalidArgument` 分开，Agent 才能知道是否应改参数还是改计划。

AgentScape 已有 SkillRegistry 统一返回 `{success,result|error}`，因此只需要**逐渐丰富 error details**，不需要复制 AI2-THOR 的 Controller/Unity RPC 架构。

## 12. Habitat-Sim / Habitat-Lab：导航与“有效初态”基准

**许可证：MIT**。注意：Habitat-Lab README 已声明 v0.3.4 之后不再由 Meta 内部团队进行官方主动维护，因此更适合作为成熟架构参考，而不是新增核心依赖。

Habitat-Sim 的 PathFinder/navmesh、semantic scene、Rigid/Articulated Object Manager 是 navigation truth 的成熟实现。Habitat-Lab 的 rearrangement task reset 会设置真实 articulated joint、settle physics，并检查 collision 后才接受初态。

值得借鉴：

- Spawn / reset 后的“场景可用性”必须由真实 collision/nav truth 验证。
- Navigation 是独立于“附近 / AABB free space”的能力。
- Task layer 不应和 simulator core 混在一起。

## 13. EmbodiedGen：Motion/Grasp Verifier 的直接参考

**许可证：Apache-2.0**。

其 grasp evaluation 有清楚的动态过程：固定 simulation frequency，close、hold/lift/sweep，并检查 translation/rotation slip threshold。它证明“终点看起来对”不足以说明操作可靠。

这条结论已在 1.8 落地：ArticulationVerifier 记录 trajectory 的 penetration regression、stall、target post-condition 与回程，而不是只检查最后 `moved=true`。

不应移植其 Blender/SAPIEN/CUDA 重栈；它继续作为上游 heavy provider / reference pipeline。

## 14. SceneSmith：重服务 Asset Pipeline 的成熟参考

**许可证：MIT**。

SceneSmith 的 AssetManager 把 generated / HSSD / Objaverse / articulated retrieval / materials / collision server 分开，CoACD/VHACD 是独立服务能力，registry 自动持久化。

AgentScape 已经吸收了最值得要的东西：provider boundary、CoACD service、optional fallback、asset identity。**不要因为 SceneSmith 服务多，就增加一排 Client/Manager 类。** 只有第二种真实 heavy backend 出现时再抽象 routing。

## 15. SAGE：生成 simulator-ready 世界的强替代者

**许可证：Apache-2.0（仓库中另含各自许可证的第三方组件）**。

SAGE 直接从 embodied task 生成 simulator-ready environments，并发布大规模 scene/action 数据；运行依赖 Isaac Sim、LLM/VLM/TRELLIS 等服务。它对 AgentScape 的压力主要在“生成规模与任务驱动 scene pipeline”，不是 browser runtime。

值得借鉴：

- Scene generation 应由 task/world requirement 驱动，而不是纯视觉 prompt。
- Episode/action/state 应可记录并用于后续评估。

不应复制 IsaacLab Manager 体系；那是大规模 robot simulation 的合理复杂度，不是浏览器 runtime 的合理默认复杂度。

## 16. Feather / Aedifex 与 AgentScape 的直接产品边界

Feather 已经覆盖大量浏览器游戏引擎功能，Aedifex 在建筑/空间 authoring 和 AI preview 上很强；公开资料也都把 AI assistant 作为产品能力。这意味着 **“Web 3D + AI 编辑”本身已不构成充分差异化**。

AgentScape 应避免继续横向堆 editor feature，优先把下面这条做得别人难替代：

```text
未知 GLB
  ↓
结构 / 分割 / Part / Joint / Collider provenance
  ↓
可执行能力准入
  ↓
物理执行
  ↓
阶段化 motion / interaction verification
  ↓
Agent-readable world state + failure reason
```

## 对下一阶段的影响

CodeGraph 回看 AgentScape 后，当前真正有证据的优先级是：

### 当时 P0：Motion Sweep Validator（1.8 已落地）

来自 OmniGibson、Habitat、EmbodiedGen、AI2-THOR 的共同证据最强。

不增加新的 Manager。扩现有 `ArticulationVerifier`：

```text
PRE_CONDITION
  ↓
EXECUTION trajectory
  ├─ finite
  ├─ target progress
  ├─ collision/contact anomaly
  └─ stall
  ↓
POST_CONDITION
  ├─ reached target
  └─ reversible / close return
```

失败报告应机器可读，供 Skill/Agent repair；成功才允许 articulation readiness 晋升。

### P1：Navigation Truth

本轮审计时 AgentScape 只有 `findNearby / raycast / AABB collision / findFreeSpace`。1.9 已按这里的结论研究并接入 `recast-navigation-js`：独立 `NavigationSystem` 持有 lazy Recast/Detour 派生状态，Agent Skill 只是薄 adapter；没有自己写 navmesh。动态障碍仍未进入 static scope。

### P2：完整 Joint Frame（条件式）

SAPIEN 证明两侧 local frame 是更完整的关节契约。但只有确认当前/升级后的 Rapier JS 能执行后才扩 Manifest；否则继续维持安全子集。

### P3：Compact Agent Observation

借鉴 threejs-devtools-mcp / Chisel：默认输出 compact tree/state，省略默认值、限制深度，用查询继续展开。先测 token/latency 是否成为真实瓶颈，再动接口。

## 明确不做

本轮没有发现理由去做这些事：

- 不引入 ECS，只因为 Gizmo/Genesis 有更复杂实体模型。
- 不引入 Blueprint/Visual Scripting，只因为 Feather 很完整。
- 不复制 IsaacLab Manager 体系。
- 不为 MCP 新建第二套 Runtime API。
- 不把 symbolic post-condition setter 当物理 action。
- 不把 whole-asset CoACD 或场景 AABB 冒充 Part-level truth。
- 不因“竞品有更多功能”拆 `main.js` 或增加 Service/Factory 层。
- 不复制无明确许可证的 Grudge Studio Forge / Articulate-Anything / Auto-Threejs 源码。

## 代码精简规则（本轮再次确认）

之后每个外部模式只有在同时满足以下条件时才进入代码：

1. AgentScape 当前调用图中存在真实缺口。
2. 至少一个成熟实现证明这个抽象长期有价值。
3. 能落到现有单一真相源，而不是增加平行状态。
4. Runtime 能执行，或明确只作为 evidence/proposal。
5. 有确定性验证和回归测试。
6. 新抽象减少重复/复杂度；若只是“未来可能有用”，不加。

这比“追赶竞品功能数量”更重要。
