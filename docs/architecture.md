# AgentScape 当前架构全景

本文描述 **1.17.0** 的真实架构，不描述未来设想。

目标不是解释每个类，而是说明：**状态在哪里、谁可以修改它、数据怎样跨层流动、哪些边界不能绕过。**

---

## 1. AgentScape 到底是什么

一句话：

> AgentScape 是一个 browser-native、GLB-first、generator-neutral 的空间 Agent Runtime，同时包含把普通 GLB 编译成 Agent-Ready Asset 的 Compiler。

它不是单纯的 3D Viewer，也不是“LLM 帮你改 Three.js Scene”。

核心差异来自两条链同时存在：

```text
                Runtime 链
Human / Agent
      │
      ▼
 SkillRegistry
      │
      ▼
 WorldRuntime
      │
      ▼
Three.js + Rapier

                Asset 链
普通 GLB
   │
   ▼
AssetCompiler
   │
   ▼
Executable Manifest
   │
   ▼
WorldRuntime
   │
   ▼
Verifier
```

只有两条链接起来，`open`、`pickup`、`place` 等词才可能成为真实能力，而不是 JSON 标签。

---

## 2. Single Source of Truth

当前系统最重要的架构约束是：**每类事实只能有一个权威来源。**

| 事实 | 权威来源 |
|---|---|
| 场景实例 | `ObjectStore` + Three.js object |
| 物理刚体 / collider / joint | `PhysicsSystem` / Rapier World |
| Agent 可调用能力 | `SkillRegistry` |
| Asset 能做什么 | Asset Manifest |
| Scene 持久化 | `SceneSerializer` schema |
| Undo / Redo | `CommandHistory` |
| 权限 | `PolicyEngine` |
| 调用审计 | `TraceRecorder` |
| 语义空间关系 | `SceneGraph`，由 Runtime facts 派生 |
| 编译质量 | `CompileQualityPass` |

不能出现：

```text
UI 认为 door=open
Physics 认为 door=closed
Manifest 认为 door 没有 open
Agent Tool Catalog 又认为 door 可以 open
```

因此历史上删除了重复 Tool Catalog，也不允许 UI 成为新的能力真相源。

---

## 3. Human 与 Agent 共用 Runtime

```text
                       ┌─────────────┐
                       │ Human Editor│
                       └──────┬──────┘
                              │
                              │
┌─────────────┐        ┌──────▼──────┐
│ LLM / Agent │───────>│SkillRegistry│
└─────────────┘        └──────┬──────┘
                              │
                      permission / trace
                              │
                              ▼
                       ┌────────────┐
                       │WorldRuntime│
                       └─────┬──────┘
                             │
       ┌────────────────┬────┼───────────────┬───────────────┐
       ▼                ▼    ▼               ▼               ▼
  AssetManager     SpatialSystem      NavigationSystem   PhysicsSystem
                                        │
                                  Recast / Detour
       │                │               │               │
       └────────────────┴───────────────┼───────────────┘
                                        ▼
                                    Three.js
```

Agent 不应该直接：

```js
mesh.position.x = 10;
```

而应该使用：

```text
place
move
findFreeSpace
open
pickup
...
```

这样 Human 和 Agent 对同一个世界做修改时，历史、权限、Trace、Physics、SceneGraph 才不会分叉。

---

## 4. WorldRuntime 的责任

`WorldRuntime` 是组合根，不是业务万能类。

它负责把真正需要一起工作的系统接起来：

```text
WorldRuntime
├── EventBus
├── AssetManager
├── ObjectStore
├── PhysicsSystem
├── InteractionSystem
├── SpatialSystem
├── SceneGraph
├── CommandHistory
├── SceneSerializer
├── PolicyEngine
├── TraceRecorder
├── SkillRegistry
├── WorldValidator / RepairEngine
├── World Pipeline
└── lazy AssetCompiler
```

重要的是组合关系，而不是“每个功能都写进 WorldRuntime”。

例如：

- 空间搜索属于 `SpatialSystem`。
- 关节物理属于 `PhysicsSystem`。
- Action 状态变化属于 `InteractionSystem`。
- 编译 GLB 属于 `AssetCompiler`。
- Scene JSON 属于 `SceneSerializer`。

---

## 5. 一次 mutation 怎样保证一致

普通修改路径：

```text
Skill / Editor
      │
      ▼
WorldRuntime.mutate(label, operation)
      │
      ├─ snapshot before
      ├─ history.begin
      │
      ▼
sceneGraph.batch
      │
      ▼
operation
      │
      ├─ ObjectStore
      ├─ Three.js
      └─ Physics
      │
      ▼
history.commit(snapshot after)
```

如果 operation 抛错：

```text
history.cancel
→ 不生成半条历史记录
```

核心规则：

> 一次状态变更只能有一个 transaction owner。

因此 `executeBatch` 有一个外层历史事务，内部 Skill 必须 `skipHistory`，不能每个子动作自己提交一次。

---

## 6. SceneGraph 不是第二份 World

`SceneGraph` 保存的是**派生关系**：

```text
NEAR
ON
SUPPORTS
...
```

它的事实来源仍然是：

```text
ObjectStore + Spatial geometry
```

因此优化方向是：

```text
World changed
   │
   ▼
mark dirty
   │
   ▼
需要关系时 rebuild / batch coalescing
```

而不是让每个 mutation 同时手工维护一套关系数据库。

后来增加 Spatial Snapshot 也是为了避免：

```text
SceneGraph 计算一次 bounds
Validator 又计算一次 bounds
Repair 又计算一次 bounds
```

在同一个短生命周期操作里重复做相同几何工作。

---

## 7. Asset Compiler：从文件到能力

当前 Pass 顺序：

```text
GLTFInspectPass
      ↓
StructurePass
      ↓
NormalizeTransformPass
      ↓
GeometryPass
      ↓
SemanticHeuristicPass
      ↓
ArticulationCandidatePass
      ↓
ColliderFallbackPass
      ↓
RemoteEnrichmentPass
      ↓
SegmentMaterializePass
      ↓
SegmentationEvidencePass
      ↓
JointFramePass
      ↓
PartColliderPass
      ↓
PartProposalPass
      ↓
PartGeometryEnrichmentPass
      ↓
ArticulatedCollisionPass
      ↓
OptimizeGLBPass
      ↓
ResourceBudgetPass
      ↓
CompileQualityPass
      ↓
ManifestPass
```

这个顺序不是随意排列。

### 为什么 Materialize 在 Proposal 前

face segment 本身不是 Runtime Node：

```text
triangle → segment id
```

Runtime 要的是：

```text
GLB Node → rigid body → joint → action
```

所以先把完整、安全的 face partition 变成稳定 GLB child nodes，再让 Proposal 绑定它们。

### 为什么 PartCollider 在 Proposal promotion 前

可执行 Part 的硬条件包括 collider。

所以先生成 coarse local AABB fallback：

```text
Part geometry
   ↓
coarse collider
   ↓
是否满足 executable admission
```

### 为什么 Heavy Geometry 在 promotion 后

重型 CoACD 很贵，只值得处理真正的 executable Parts：

```text
Part Proposal
   ↓
promoted
   ↓
上传当前 materialized GLB
   ↓
per-part CoACD
```

这样不会把所有视觉 segment 都送去重型服务。

---

## 8. Evidence、Proposal、Executable、Verified

这是 AgentScape 最核心的数据层级。

### Evidence

例子：

```text
P3-SAM: face 0~100 属于 segment A
URDF: joint axis=[0,1,0]
trimesh: watertight=false
```

它们是证据，不等于 Runtime capability。

### Proposal

```text
part id=door
node=Door
joint=revolute
semantic=door
```

可能是对的，但还缺：

```text
collider
anchors
actions
targets
```

所以仍不能执行。

### Executable

只有 Manifest schema 和 Runtime 都能消费：

```text
joint
anchors
limits
collider
action
target
```

才进入 `manifest.parts`。

### Verified

Runtime 真的创建 Rapier body/joint，并运行 Motion Sweep Verifier：

```text
PRE_CONDITION
  target / limits / motor
       ↓
EXECUTION
  finite / progress / stall
  limit / penetration regression
       ↓
POST_CONDITION
  target reached
       ↓
RETURN
  zero-target reversible
```

只有完整轨迹通过，才有资格讨论 readiness 晋升。

---

## 9. Articulated Asset 的真实物理所有权

一个经典错误是：

```text
whole cabinet collider
+
door collider
```

这样 Door 几何同时属于 Root 和 Door 两个刚体。

AgentScape 现在采用：

```text
每个 Mesh
   │
   ▼
向上寻找最近 executable Part ancestor
   │
   ├─ 找到 → 属于该 Part
   └─ 没有 → 属于 Root
```

因此：

```text
Cabinet Root
├── Body Mesh       → Root collider
└── Door Part
    ├── Panel Mesh  → Door collider
    └── Handle Mesh → Door collider
```

这条 ownership 在 Compiler 决定，Runtime 只消费最终 Manifest。

---

## 10. Browser fallback 与 Heavy Provider

浏览器能确定性做的事：

```text
inspect
normalize
bounds
face materialization
local AABB
budget
schema validation
```

重型服务做：

```text
trimesh topology
CoACD
per-part convex decomposition
URDF parsing
```

边界：

```text
Browser baseline 必须自己能工作
Heavy provider 是 upgrade，不是单点故障
```

所以 Provider 失败：

```text
coarse fallback 保留
quality = provisional
```

而不是整个资产编译失败。

---

## 11. 资源与生命周期

AgentScape 不把浏览器内存/显存当无限资源。

资源生命周期：

```text
spawn
  ↓
Three geometry/material/texture
Rapier body/collider
BVH
Blob URL
  ↓
remove / restore / dispose
  ↓
明确释放
```

编译器还会做：

```text
input byte limit
render vertex budget
draw call budget
texture VRAM budget
texture dimension budget
animation keyframe budget
```

这些阈值是 AgentScape 当前 conservative admission policy，不是 WebGL 理论极限。

---

## 12. 当前仍然缺什么

架构已经能做到：

```text
普通 GLB
→ Part
→ Joint
→ Collider
→ Runtime open/close
```

1.8 已把 verifier 从“能不能动”升级为完整 Motion Sweep。1.9 补上 `findFreeSpace ≠ reachable` 的静态 NavMesh；1.10 再把动态 obstacle truth 接到同一查询链：Static Recast geometry 作为 base，TileCache 在每次查询前从当前 Rapier collider 差分同步 dynamic Root 与 articulated Part。

因此 Runtime 有 Physics 时 `findPath/canReach` 返回 `scope=current`；如果某个 Rapier shape 无法安全映射，报告会显式给 `dynamicObstacles.coverage=partial`，而不是隐藏不确定性。详见 [`navigation.md`](./navigation.md)。

---

## 13. Current-world Navigation Truth

1.9 把 navigation 从“未来 Spatial helper”提升成独立但仍然派生的 Runtime truth：

```text
Environment floor + fixed world geometry
              │
              ├─ dynamic objects excluded
              └─ executable Part subtree excluded
              ▼
         NavigationSystem
              │
        lazy Recast build
              ▼
          Detour query
        ┌─────┴─────┐
        ▼           ▼
    canReach     findPath
```

NavMesh 不写入 SceneSerializer，因为它可以从当前 World 重建；这和 SceneGraph 的 derived-state 原则一致。区别在于 NavMesh 构建更重，所以只有 fixed geometry 变化才 dirty，并且 rebuild 只在下一次 query 发生。

1.9 的 static base 仍然不 bake dynamic object / articulated Part。1.10 用 TileCache 把它们作为**查询时动态覆盖层**：NavigationSystem 不监听 Physics 每帧位置，而是在 `canReach/findPath` 前读取 `PhysicsSystem.navigationObstacles()`，只对变化的 collider 做 remove/add，再 pump TileCache 到 `upToDate`。

这样 dynamic obstacle 不触发全量 Recast rebuild，Static NavMesh 的 `buildVersion` 保持稳定；同时查询看到的是当前 Rapier pose，而不是 Manifest target 或 UI state。详细契约见 [`navigation.md`](./navigation.md)。

---

## 14. Curated Environment Pack

1.11 将 Pages 默认环境从测试地面升级为 `Monument Hall`，但没有把美术结构塞进 `WorldRuntime`。新增的 `src/content/monumentHall.js` 是内容层：

```text
MonumentHall pack
├─ Three.js architecture
├─ fixed Rapier collider descriptors
├─ Recast environment root
├─ lighting / material / HDRI
└─ camera preset
```

Runtime 只负责挂载这个 pack，并把同一份 collider / geometry 交给 Physics 与 Navigation。Environment 不进入 `ObjectStore`，所以不会被普通 Undo/Redo、Inspector 或 SceneSerializer 当作可编辑对象；但它的墙、柱、纪念台仍是真实的物理/导航障碍。

这种边界让后续 `Ruined Courtyard / Grand Urban Block` 可以作为内容扩展，而不是继续扩大 Runtime 类。

---

## 15. Environment Catalog：第二世界不增加第二 Runtime

1.12 加入 `Ruined Courtyard` 后，`WorldRuntime` 不再 import 具体 Monument Hall，而接收 `environmentFactory`。世界元数据放在 `src/content/environments.js`。

```text
Pages ?world=...
      ↓
Environment Catalog
      ↓
factory
      ↓
WorldRuntime
  ├─ Three root
  ├─ Rapier colliders
  └─ Navigation root
```

世界切换选择 reload，而不是热切换两个 Runtime。Autosave 使用 world-id namespace；Scene metadata 也记录 environment id，跨世界 restore 在 destructive mutation 前拒绝。

详细契约见 [`worlds.md`](./worlds.md)。

---

## 16. Lazy Environment Code + 城市尺度基线

1.13 的第三世界把 Environment Catalog 从静态 import 改成 dynamic `load()`，因此每个 world pack 是独立 production chunk；Runtime contract 不变。

```text
metadata catalog
      ↓
selected world
      ↓
dynamic import pack
      ↓
factory
      ↓
WorldRuntime
```

Grand Urban Block 96 × 72m 真实 benchmark 仍只有 19 Recast meshes、38 renderables、426 instanced details，NavMesh build 约 330–489ms。因此当前架构继续保持 single-world lifecycle，不引入 Scene streaming manager。

---

## 17. Action-aware Navigation：反事实不是世界事实

1.14 在 NavigationSystem 内增加单障碍 counterfactual diagnosis。它复用 TileCache 当前 obstacle handle，临时 remove/query/restore，不创建第二个 planning world。

```text
current findPath blocked
      ↓
obstacle provenance → executable Part
      ↓
remove one obstacle (temporary)
      ↓
Detour query
      ↓
restore obstacle
      ↓
provisional recommendation
```

自动编译资产必须有 runtime articulation verification 才能成为 recommendation；未验证资产只能作为 blocker evidence。执行 `open` 后必须再次 `findPath` 获取 current Rapier/TileCache truth。详见 [`action-aware-navigation.md`](./action-aware-navigation.md)。

---

## 18. Embodied Locomotion：Detour 规划，Rapier 执行

1.15 新增普通 builtin `agent` asset 与 `LocomotionSystem`。Agent pose 不单独存储：kinematic Rapier body 是位置事实，Three/ObjectStore 每个 physics step 从它同步。

```text
navigateTo
   ↓
NavigationSystem.findPath
   ↓
Detour waypoints
   ↓
LocomotionSystem
   ↓
PhysicsSystem.moveCharacter
   ↓
Rapier KinematicCharacterController
   ↓
World.step
   ↓
Three / ObjectStore
```

`navigateTo` 会等待 arrived/blocked 后才让 SkillRegistry 的 `runtime.mutate()` commit，整个跨帧行走只有一个 History command。为了避免长 mutation 与其它写操作争用同一个 CommandHistory pending slot，WorldRuntime 增加单一 `mutationOwner`；并发写明确返回 `WORLD_MUTATION_BUSY`。

当前不接 Detour Crowd：单 Agent 的真实瓶颈是 physical move-and-slide，而不是群体 avoidance。详见 [`locomotion.md`](./locomotion.md)。

---

## 19. Embodied Interaction：可达不是可交互

1.16 在已有 Navigation + Locomotion 上增加 `findInteractionPose / approachAndInteract`，但没有引入 TaskManager。

```text
Agent-facing approachAndInteract
        ↓
InteractionSystem
        ├─ 8 candidate poses
        ├─ NavigationSystem.findPath
        ├─ fixed 1.5m range
        ├─ PhysicsSystem.raycast
        ├─ articulation swept AABB
        ↓
LocomotionSystem.navigate
        ↓
actual Rapier arrival pose
        ↓
range / LOS / sweep recheck
        ↓
setArticulationAction
```

InteractionSystem 只组织已有 truth owners：Navigation 仍拥有 path，Locomotion 仍拥有执行状态，Physics 仍拥有碰撞/LOS/joint motor。

`interaction-requested` 只表示 motor target 已接受，不等于 joint settled。详情见 [`interaction-range.md`](./interaction-range.md)。

---

## 20. Agent Carry：Ownership 在对象 state，位置仍在 Rapier

1.17 为 builtin Agent 增加 Manifest `embodiment.holdAnchor`。被持有对象唯一 durable ownership 是 `state.heldBy`；InteractionSystem 的 `agentHeld` 只是派生索引。

```text
approachAndPickup
      ↓
interaction pose / locomotion
      ↓
Rapier shape cast → hold anchor
      ↓
state.heldBy = agent_01
      ↓
body → kinematic
      ↓
Locomotion each frame
  ├─ Agent KCC ignores own held collider
  └─ held object next-anchor clearance
      ↓
CARRIED_OBJECT_BLOCKED | move
```

Held object 在 carry 期间不进入 TileCache dynamic obstacle snapshot；其空间占用由 carry clearance 负责，drop 后恢复普通 Dynamic obstacle。详见 [`agent-carry.md`](./agent-carry.md)。
