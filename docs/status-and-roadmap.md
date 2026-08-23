# 当前完成度与路线图

本文描述 **1.15.1** 当前状态。

总体完成度只能作为粗略参考。按“从普通 GLB 到可信 Agent World”的完整目标估计，目前约：

```text
0%        20%       40%       60%       80%      100%
│----------│----------│----------│----------│----------│
██████████████████████████████░░░░░░░░░░░░░░░░░░░░
                              ▲
                           当前 ≈ 75%
```

75% 不是“代码写完 75%”，而是：基础 Runtime 和 Asset→Executable 纵向链已经成熟，剩余主要是更困难的验证、导航、自动语义与世界级能力。

---

## 1. 模块成熟度

| 模块 | 当前估计 | 说明 |
|---|---:|---|
| Web Runtime | 90% | Three / Rapier / lifecycle / persistence + kinematic Agent Body 已形成稳定运行时 |
| Human Editor | 75% | 可用，但不是当前差异化主线 |
| Skill / Policy / Trace | 80% | 单一能力边界已经形成 |
| Spatial API | 88% | placement + Recast/Detour + query-time TileCache 动态障碍已形成当前世界可达性 |
| Scene Persistence / History | 85% | schema / autosave / undo-redo 基本成熟 |
| Asset Compiler 基础 | 90% | inspect / normalize / budget / quality 很完整 |
| Part / Articulation Compiler | 80% | proposal / hierarchy / joint / materialization 已通 |
| Part Geometry / Collider | 85% | local AABB + per-part CoACD 已通 |
| Runtime Articulation | 85% | 多级 Part + Rapier action 已通 |
| Runtime Verification | 75% | 1.8 已有阶段化 Motion Sweep；仍可继续补外部环境/多对象任务级验证 |
| 自动 Part Segmentation 接入 | 50% | 协议/物化已通，默认模型未绑定 |
| 自动 Semantics | 35% | 仍以 evidence/provider 为主 |
| 自动 Joint / Target 推断 | 30% | 保守，不愿用猜测换 coverage |
| Grasp / Manipulation Geometry | 15% | 尚未成为主干能力 |
| Navigation / Reachability | 90% | 1.15 已有 Detour path + Rapier physical locomotion；自动动态 replan / off-mesh / multi-agent avoidance 仍缺 |
| 大型 World Runtime | 58% | 1.13 已有 96×72m 城市基线；19 Recast meshes / 38 renderables / 330–489ms build，当前暂无 streaming 证据 |
| Multi-Agent | 10% | 不是当前优先级 |
| 完整生成式 World Pipeline | 30% | provider 边界在，task-driven generation 仍需发展 |
| Pages / Art Direction | 78% | Monument Hall + Ruined Courtyard + Grand Urban Block；world pack JS 已按当前选择 lazy load |

---

## 2. 当前最成熟的纵向链

```text
普通 GLB
  ↓
Inspect / Structure
  ↓
Conservative Normalize
  ↓
Resource Admission
  ↓
Segmentation Evidence
  ↓
Face Materialization
  ↓
Stable GLB Part Nodes
  ↓
Part Proposal
  ↓
Joint Frame
  ↓
Browser Part AABB fallback
  ↓
Executable Promotion
  ↓
Per-Part Heavy Geometry
  ↓
CoACD convexHull
  ↓
Collision Ownership
  ↓
Manifest
  ↓
AssetManager
  ↓
Rapier
  ↓
open / close
  ↓
ArticulationVerifier
```

这条链已经有真实 cabinet E2E，不只是 mock。

---

## 3. 1.8 已完成：Motion Sweep Validator

当前 verifier 已经从：

```text
target accepted?
finite?
moved?
```

升级到：

```text
PRE_CONDITION
     │
     ▼
EXECUTION
     │
     ├─ progress
     ├─ stall
     ├─ penetration regression
     ├─ finite
     └─ joint limit
     │
     ▼
POST_CONDITION
     │
     └─ target reached
     │
     ▼
RETURN / REVERSIBILITY
```

已覆盖 prismatic、revolute、初始 overlap baseline、新碰撞、同 pair penetration 加深、motor stall、越界 target、open→close return，以及真实 `cabinet.glb` Compiler→Runtime E2E。

没有新增 `MotionValidatorManager`，仍然由 `ArticulationVerifier` 作为唯一 verification truth。

---

## 4. 1.9 已完成：Static Navigation Truth

1.9 已把：

```text
findFreeSpace
```

与：

```text
canReach / findPath
```

分成两种真实能力。当前 `NavigationSystem` 使用 lazy Recast/Detour，支持端点吸附、静态连通性、路径 waypoint 与 path cost；真实 cabinet GLB 已进入 E2E。

1.9 当时的边界是：dynamic object / executable Part 不进入 static base，查询只承诺 `scope=static`。这个边界在 1.10 **没有被删除**，而是保留为 Recast base，再由 TileCache + Rapier collider 形成 current-world overlay；因此不要把 1.9 的 static base 与 1.10 的最终查询 scope 混为一谈。详细契约见 [`navigation.md`](./navigation.md)。

---

## 5. 1.10 已完成：Dynamic Obstacle Truth

1.10 沿 Recast/Detour 官方 TileCache 补齐动态障碍，但没有把 Physics 高频帧直接灌进导航：

```text
Static Recast NavMesh
        +
query-time Rapier collider snapshot
        ↓
TileCache obstacle diff
        ↓
current-world Detour query
```

当前覆盖：

```text
dynamic Root box/cylinder
articulated Part box/cylinder
tiltted box/cylinder → physics-derived conservative AABB
convexHull           → physics-derived conservative AABB
unsupported shape    → skipped + coverage=partial
```

查询报告：

```text
scope = current
dynamicObstacles.coverage = complete | partial
tracked / changed / operations / updates / syncVersion
```

已验证：dynamic barrier 移动前后可达性改变而 static `buildVersion` 不变；70 个 obstacle 不触发 TileCache 64-request queue overflow；真实 Rapier articulated Door collider pose 会随 open 轨迹更新。

---

## 6. 1.14 已完成：Single-action Action-aware Reachability

`suggestNavigationActions(start,end)` 现在可以利用 dynamic obstacle provenance 找到可开 Part，并通过临时 TileCache suppression 判断“如果这个单一 obstacle 不再阻挡，路径是否出现”。结果严格标 provisional；compiled articulation 必须 runtime verified 才能成为 recommendation。真实 Rapier Door 已验证 `recommend open → open → physics step → current findPath reachable`。

当前仍不做多动作搜索：两扇门串联、需要先移动箱子再开门、RRT/TAMP 等组合问题不在 1.14 范围。

---

## 7. 1.15 已完成：Embodied Locomotion

现在已有：

```text
builtin Agent Body
      ↓
Detour current path
      ↓
LocomotionSystem waypoint state
      ↓
Rapier CharacterController
      ↓
physical stairs / walls
      ↓
arrived | blocked
```

真实 Ruined Courtyard E2E 已从 `[0,0,12]` 走上 `[12,1.2,4.8]` 高台；physical-only wall E2E 会返回 `PHYSICS_BLOCKED`，不会 teleport。跨帧 `navigateTo` 仍只有一个 History transaction，并发 world-write 使用 `WORLD_MUTATION_BUSY` 拒绝。

---

## 8. 当前 P0：Interaction-range Task Execution

Agent 已经会走，但 `open / pickup / place` 当前还没有统一的“必须先到交互距离”约束。下一步更有价值的是把：

```text
find target
→ navigate to interaction pose
→ verify range / line-of-sight
→ execute open/pickup/place
```

做成可信闭环，而不是马上进入 Multi-Agent Crowd。

---

## 9. 1.11–1.12 已完成：Curated Multi-World Layer

Pages 默认世界从 10 × 8m 测试地面升级为约 32 × 24m 的 `Monument Hall`。这不是纯视觉主题：

```text
Three.js architecture
      │
      ├─ same pack → Rapier fixed colliders
      └─ same root → Recast static geometry
```

真实测试要求 Detour 从大厅前部走到后殿时绕开中央 Monument；Rapier 专项测试要求 Environment collider 真正阻挡 dynamic probe。素材只引入约 2.1MB CC0 HDRI/PBR，并增加 Cinematic Mode；没有引入第二套 Scene state。

1.12 已完成第二个 Environment Pack：`Ruined Courtyard`。它证明第二种视觉/空间语言无需复制 Runtime，并新增 split-level Recast、旋转 fixed collider、world-id autosave 与 Scene environment identity。

1.13 已完成 `Grand Urban Block` 城市级基线：96 × 72m、12 栋模块建筑、426 instanced details，Recast build 约 330–489ms。当前数据不支持提前做 streaming。

下一步内容/规模优先级：

1. 继续做更长时、更多动态物体的 Agent 行为演示，而不是再单纯扩大地面。
2. 记录真实移动端 GPU / texture upload / draw-call 数据；只有出现瓶颈才选择 KTX2 / LOD。
3. 如果未来静态 world 超过当前 96 × 72m 基线并出现 Recast 秒级构建，再研究 region streaming / partial rebuild。

---

## 10. P1：完整 Joint Frame

当前 Joint：

```text
axis
limits
parentAnchor
childAnchor
```

这是有意保守的可执行子集。

SAPIEN 等成熟系统说明更完整的表示是：

```text
parentFrame
  position
  rotation

childFrame
  position
  rotation
```

但只有在 Rapier JS Runtime 能稳定消费时才应该升级 Schema。

原则：

```text
Runtime support first
Schema claim second
```

---

## 11. P2：Compact Agent Observation

随着世界变大，Agent 不可能每轮看到整个 Scene Tree。

未来方向：

```text
compact defaults
omit unchanged/default fields
bounded depth
stable ids
query-to-expand
```

参考 threejs-devtools-mcp / Chisel 的 compact observation 思路。

但要先测真实：

```text
token cost
latency
world size
```

成为瓶颈后再改接口。

---

## 12. 自动语义：宁可慢一点，也不虚构能力

长期目标：

```text
unknown GLB
  ↓
auto segmentation
  ↓
auto semantics
  ↓
joint proposal
  ↓
target proposal
  ↓
physics verification
  ↓
repair
```

当前还没有把这条链自动化到底。

这是有意的。

AgentScape 优先保证：

```text
low coverage + true capability
```

而不是：

```text
high coverage + fake capability
```

---

## 13. 目前不应该成为优先级的方向

竞争者审计后明确：

```text
更多 Editor Panel
Visual Scripting / Blueprint
复杂 ECS 迁移
Isaac-style Manager 体系
第二套 MCP Runtime API
为了文件长度拆 main.js
```

这些并非永远不做，而是当前没有足够证据证明它们比 Motion Truth / Navigation Truth 更重要。

---

## 14. 产品差异化应该是什么

不应该是：

```text
AI + Three.js Editor
```

因为 Feather、Aedifex、Trigen、Gizmo 等已经覆盖很多。

更值得守的是：

```text
Unknown GLB
   ↓
Evidence
   ↓
Executable Asset
   ↓
Physical Runtime
   ↓
Verification
   ↓
Machine-readable failure
   ↓
Spatial / Navigation Truth
   ↓
Agent World
```

---

## 15. 未来完成态

可以把 100% 理解为：

```text
Generator-neutral assets/worlds
          │
          ▼
Agent-Ready Compiler
          │
          ▼
Verified executable objects
          │
          ▼
Navigation / reachability
          │
          ▼
Manipulation / grasp
          │
          ▼
Task planning
          │
          ▼
Persistent large worlds
          │
          ▼
Multi-agent / long-running world state
```

AgentScape 当前已经站在：

```text
Verified executable objects
```

之前的最后一段和之后的第一段之间。

所以接下来最重要的不是“再多一个 feature”，而是把：

```text
可动
```

升级成：

```text
可信可执行
```

再把：

```text
有空位
```

升级成：

```text
真的可到达
```

---

## 当前验证基线

1.15.1 文档快照对应的仓库验证基线：

```text
81 Test Files PASS
215 Tests PASS
GLB asset validation PASS
Production build PASS
Monument Hall Environment Recast/Rapier PASS
Ruined Courtyard split-level Recast PASS
Grand Urban Block 96×72m Recast benchmark PASS
Action-aware Navigation E2E PASS
Embodied Locomotion Ruined Courtyard E2E PASS
Physical-only blocker locomotion E2E PASS
Kinematic CharacterController capsule/wall/yaw PASS
Long mutation ownership/history lock PASS
OpenAI-compatible local Agent adapter tests PASS
Provider-neutral tool-call history PASS
Nemotron live ToolCallingAgent→navigateTo probe PASS
Counterfactual restore recovery PASS
Live verification metadata sync PASS
World-pack dynamic import chunks PASS
Environment identity restore guard PASS
Chromium Pages screenshot smoke PASS
Python service tests PASS
真实 cabinet Compiler→Runtime Motion Sweep open→close E2E PASS
真实 JSON enrich / multipart per-Part CoACD E2E PASS
```

这些数字不是架构目标，只是帮助读者知道文档描述的能力已经有怎样的验证覆盖。未来测试数量变化时，应以当前 CI 为准。
