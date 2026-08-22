# 当前完成度与路线图

本文描述 **1.9.0** 当前状态。

总体完成度只能作为粗略参考。按“从普通 GLB 到可信 Agent World”的完整目标估计，目前约：

```text
0%        20%       40%       60%       80%      100%
│----------│----------│----------│----------│----------│
██████████████████████████████░░░░░░░░░░░░░░░░░░░░
                              ▲
                           当前 ≈ 60%
```

60% 不是“代码写完 60%”，而是：基础 Runtime 和 Asset→Executable 纵向链已经成熟，剩余主要是更困难的验证、导航、自动语义与世界级能力。

---

## 1. 模块成熟度

| 模块 | 当前估计 | 说明 |
|---|---:|---|
| Web Runtime | 85% | Three / Rapier / lifecycle / persistence 已稳定 |
| Human Editor | 75% | 可用，但不是当前差异化主线 |
| Skill / Policy / Trace | 80% | 单一能力边界已经形成 |
| Spatial API | 82% | placement + static Recast/Detour reachability 已有，dynamic obstacle 仍缺 |
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
| Navigation / Reachability | 55% | 1.9 已有 static canReach/findPath；TileCache/dynamic obstacle 尚未接入 |
| 大型 World Runtime | 30% | streaming / large nav / dynamic world 仍早期 |
| Multi-Agent | 10% | 不是当前优先级 |
| 完整生成式 World Pipeline | 30% | provider 边界在，task-driven generation 仍需发展 |

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

当前边界明确：

```text
scope = static

dynamic object          excluded
executable Part subtree excluded
TileCache                not enabled
```

所以关闭的动态门目前不会阻断 NavMesh。详细契约见 [`navigation.md`](./navigation.md)。

---

## 5. 当前 P0：Dynamic Obstacle Truth

下一步不是重写 pathfinding，而是沿 Recast/Detour 已有 TileCache 解决动态障碍：

```text
static NavMesh
    +
Runtime obstacle ownership
    +
TileCache box/cylinder obstacles
    ↓
query reflects current world state
```

在实现前必须先定义：

1. 哪些 dynamic object 自动成为 navigation obstacle。
2. articulated Part 如何映射 obstacle。
3. open/close motor 尚未 settle 时何时更新 obstacle。
4. Physics 高频移动怎样节流 TileCache 更新。
5. obstacle 状态是否属于 durable scene，还是继续由 Runtime facts 派生。

不先解决这些 ownership/时序问题，就不把 TileCache 接进默认 Runtime。

---

## 6. P1：完整 Joint Frame

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

## 7. P2：Compact Agent Observation

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

## 8. 自动语义：宁可慢一点，也不虚构能力

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

## 9. 目前不应该成为优先级的方向

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

## 10. 产品差异化应该是什么

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

## 11. 未来完成态

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

1.9.0 文档快照对应的仓库验证基线：

```text
63 Test Files PASS
170 Tests PASS
GLB asset validation PASS
Production build PASS
Python service tests PASS
真实 cabinet Compiler→Runtime Motion Sweep open→close E2E PASS
真实 JSON enrich / multipart per-Part CoACD E2E PASS
```

这些数字不是架构目标，只是帮助读者知道文档描述的能力已经有怎样的验证覆盖。未来测试数量变化时，应以当前 CI 为准。
