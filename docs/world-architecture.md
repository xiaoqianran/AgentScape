# World Runtime Architecture

本文是 AgentScape **World Runtime 当前冻结架构**。它只描述已经存在并经过测试的系统边界，不把未来设想写成当前事实。

核心原则只有两条：

1. **每类事实只有一个 Truth Owner。**
2. **依赖只能从行为层指向基础能力层，不能反向。**

---

## 1. 六大 Runtime System

从职责看，六个系统不是一条顺序执行的流水线，而是三个层级：

```text
WorldRuntime  ← composition root / mutation boundary
│
├─ Query / Simulation
│  ├─ Physics
│  ├─ Spatial
│  └─ Navigation
│
├─ Action
│  ├─ Locomotion
│  └─ Interaction
│
└─ Presentation
   └─ Rendering
```

真正的六系统依赖 DAG（箭头表示 `depends on`）：

```text
Interaction
├──────────────> Spatial
├──────────────> Physics
├──────────────> Navigation ─────────> Physics
└──────────────> Locomotion
                    ├───────────────> Physics
                    └───────────────> Navigation ─────────> Physics

Rendering ────────> shared Scene / presentation resources

Spatial            no dependency on the other five systems
Physics            no dependency on the other five systems
```

更精确地写成：

```text
Physics      -> none of the other five systems
Spatial      -> none of the other five systems
Navigation   -> Physics
Locomotion   -> Navigation + Physics
Interaction  -> Spatial + Navigation + Locomotion + Physics
Rendering    -> shared Scene / presentation resources only
```

这里的箭头表示 **depends on**。

因此：

```text
Interaction -> Spatial      ✅
Spatial -> Interaction      ❌

Locomotion -> Navigation    ✅
Navigation -> Locomotion    ❌

Navigation -> Physics       ✅ 仅用于 current-world obstacle snapshot
Physics -> Navigation       ❌

Simulation -> Rendering     ❌
Rendering controls Physics  ❌
```

`Spatial` 位于 `Interaction` **之前**，指的是依赖层级，而不是每帧必须先执行 Spatial。

---

## 2. WorldRuntime 是组合根

`WorldRuntime` 负责系统装配、生命周期和跨系统一致性，不负责吞掉每个系统的内部逻辑。

当前装配关系：

```text
WorldRuntime
├─ ObjectStore
├─ PhysicsSystem
├─ SpatialSystem
├─ NavigationSystem
├─ LocomotionSystem
├─ InteractionSystem
├─ SceneGraph
├─ CommandHistory
├─ SceneSerializer
├─ WorldValidator / RepairEngine
├─ SimulationSession
└─ optional Rendering adapter
```

核心创建顺序：

```text
Physics.init()
   ↓
Rendering.init()            optional
   ↓
SpatialSystem
   ↓
SceneGraph
   ↓
Environment install
   ↓
NavigationSystem
   ↓
LocomotionSystem
   ↓
InteractionSystem
```

系统之间不自己寻找彼此；依赖由 `WorldRuntime` 显式注入。

---

## 3. Truth Ownership

| 事实 | Truth Owner | 其他系统可以做什么 |
|---|---|---|
| rigid body / collider / joint / contact | `PhysicsSystem` | 查询，不复制物理真相 |
| world-space bounds / overlap / containment geometry | `SpatialSystem` | 作为几何 evidence 使用 |
| static NavMesh / path / reachability | `NavigationSystem` | 查询 route，不自己算第二套路 |
| character movement task / arrival / blocked | `LocomotionSystem` | Interaction 等待结果 |
| pickup / place / articulation action orchestration | `InteractionSystem` | 组合下层 truth，不重定义它们 |
| renderer / camera / postfx / GPU diagnostics | `RenderingSystem` | Presentation only |
| durable instance identity / manifest / authored state | `ObjectStore` | 各系统按 contract 读取 |
| derived semantic relation | `SceneGraph` | 从 Spatial / Physics / Runtime facts 派生 |

### Physics 与 Spatial 的边界

```text
Spatial:
AABB overlap
bounds
nearby
distance
containment geometry
support geometry

Physics:
collision/contact
rigid-body pose
shape cast / sweep
raycast against physical world
settled / motion state
joint motor
```

因此：

```text
Spatial.supportGeometry(...)
```

只能说明“几何上满足支撑条件”，不能单独宣称真实物理 `ON` 已验证。

最终 placement post-condition 由 Interaction 组合：

```text
Physics settled/contact evidence
            +
Spatial support geometry
            ↓
Interaction supportVerified
```

---

## 4. World Entity 与 Visual Decoration

Three.js `Scene` 是最终渲染容器，不等于 World 的语义对象集合。

```text
Three.js Scene
├─ World Entity
│  └─ ObjectStore + Runtime systems 管理
└─ Visual Decoration
   └─ RenderingSystem 管理，仅用于表现
```

判定规则只有一个：

```text
世界逻辑需要知道 / 查询 / 交互 / 持久化它
        -> World Entity

只负责显示、编辑辅助、调试或瞬时视觉效果
        -> Visual Decoration
```

代码边界：

- `WorldRuntime.spawn()` 创建的实例进入 `ObjectStore`；`ObjectStore` 是 World Entity identity 的 authoritative owner。
- Studio selection helper、transform gizmo、placement preview、generation anchor、debug overlay 属于 Visual Decoration，统一通过 `RenderingSystem.addDecoration()` / `removeDecoration()` 管理。
- Visual Decoration 不进入 `ObjectStore`、SceneGraph、Physics、Spatial 或序列化状态。
- 带 Runtime `instanceId` 的 World Entity 不允许作为 Visual Decoration 挂载。
- Physics 不是 Entity 的判定标准；没有 collider 的对象也可以是 World Entity。

```text
WorldRuntime    = authoritative semantic state
Three.js Scene = World 的渲染结果 + Visual Decoration
```

这不是新增 Layer，只是明确 Runtime 与 Rendering 对同一个 Three.js Scene 的所有权边界。

---

## 5. Navigation 与 Physics 的唯一直接基础依赖

Navigation 的静态输入来自：

```text
Environment geometry
+ fixed ObjectStore geometry
- dynamic / articulated Part geometry
```

当前世界动态障碍来自：

```text
PhysicsSystem.getNavigationObstacles()
        ↓
NavigationSystem
        ↓
NavigationBackend.syncObstacles()
        ↓
Recast / Detour / TileCache
```

这是允许的：Navigation 消费 **Physics 提供的窄 obstacle snapshot**。

禁止反向关系：

```text
Physics -> Navigation
```

也禁止 Navigation 理解更高层动作协议：

```text
Navigation listens "interaction" event
Navigation knows move/place action names
```

Navigation 只接受显式：

```text
invalidate(reason)
invalidateIfStatic(record, reason)
```

---

## 6. World mutation 与 Navigation invalidation

以前 Navigation 自己监听：

```text
interaction event
  ├─ move
  └─ place
```

这形成隐藏的：

```text
Navigation <- Interaction protocol
```

而且漏掉了 `placeInside`。

现在统一为：

```text
Interaction mutation
      │
      │ onObjectTransform(id, reason)
      v
WorldRuntime
      │
      │ invalidateNavigationForObject(id, reason)
      v
Navigation.invalidateIfStatic(...)
```

因此：

- Interaction 不知道 Navigation invalidation policy。
- Navigation 不知道 Interaction action vocabulary。
- WorldRuntime 决定一次 World mutation 需要通知哪些系统。
- `silent` 只控制 UI/event emission，不影响世界一致性。

当前进入这一边界的 mutation 包括：

```text
spawn / remove
editor transform
World revision position patch
Interaction.move
Interaction.place
Interaction.placeInside
embodied approachAndPlace completion
```

动态对象不会触发 static NavMesh rebuild；其 collider 通过 Physics obstacle snapshot 在 query-time 同步。

---

## 7. Locomotion

Locomotion 只负责：

> **沿 Navigation 给出的 route，用 Physics character movement 真正把 Agent 移过去。**

依赖：

```text
Locomotion
├─ Navigation.findPath()
└─ Physics
   ├─ getPosition / getRotation
   ├─ faceCharacter
   ├─ moveCharacter
   ├─ checkBodyMotion
   └─ setHeldTarget
```

它不负责：

```text
NavMesh generation
interaction pose semantics
pickup/place
render animation truth
```

Interaction 可以调用 Locomotion；Locomotion 永远不调用 Interaction。

---

## 8. Interaction

Interaction 是六大系统中最高的行为编排层。

```text
InteractionSystem
├─ InteractionApproach
├─ CarryRuntime
├─ ArticulationRuntime
├─ SettleRuntime
└─ RecoveryRuntime
```

它允许依赖：

```text
Spatial      -> geometric evidence
Navigation   -> reachable pose / route
Locomotion   -> embodied movement execution
Physics      -> collision / LOS / body / articulation truth
```

但 Interaction 不得：

```text
自己构建 NavMesh
自己实现 collision solver
把 AABB overlap 当 collision
让下层系统知道 Interaction action vocabulary
```

Interaction 与 Locomotion 的共享行为参数不通过 `InteractionSystem -> LocomotionSystem.js` 的实现文件 import 传递；Interaction 自己拥有 approach safety margin，Locomotion 自己拥有 movement waypoint default。

---

## 9. Spatial

Spatial 是 **只读几何查询层**。

```text
SpatialSystem
├─ snapshot
├─ getBounds
├─ findNearby
├─ raycast geometry
├─ overlappingIds / overlapPairs
├─ containmentGeometry
├─ supportGeometry
├─ findFreeSpace
└─ findFreeSpaceInside
```

Placement candidate query 不修改真实 `Object3D.position`；候选位置通过 `SpatialSnapshot` 推演。

当前 Spatial 仍以 Three.js `Object3D` 为 geometry adapter 输入。这意味着 AgentScape 还没有单独的 engine-agnostic `TransformState`，但已经满足更重要的边界：

```text
Spatial does not depend on RenderingSystem
Spatial does not depend on InteractionSystem
Spatial query does not mutate World
```

只有未来出现真实的多 renderer / server simulation / large-world transform pressure 时，才考虑抽独立 TransformState。

---

## 10. Rendering

Rendering 是可选 Presentation adapter。

应用层组合：

```text
createSession(container)
      │
      ├─ new WorldRuntime(...)
      │
      └─ world.attachRendering(new RenderingSystem(...))
```

因此 WorldRuntime 可以 headless：

```text
container = null
RenderingSystem = absent
Physics / Spatial / Navigation / Locomotion / Interaction = still usable
```

Rendering 拥有：

```text
renderer
camera
controls
HDR environment
postfx
GPU diagnostics
generated visual presentation
```

它不拥有：

```text
physical pose truth
navigation truth
interaction state
semantic relation truth
```

六大系统中没有任何 Simulation / Action system 应反向依赖 `RenderingSystem`。

---

## 11. Simulation frame

当前 `WorldRuntime.stepSimulation(dt)` 的主要顺序：

```text
Environment.step
      ↓
Affordances.update
      ↓
Locomotion.update
      ↓
Physics.step
      ↓
SceneGraph.invalidate when physical pose changed
      ↓
Interaction.update
```

Rendering 的 frame scheduling 在 host/application 层，不是 simulation clock 的 truth owner。

这里不要误解为 Spatial 必须有一个 `spatial.update()`：Spatial 是 query layer，需要时从当前 World state 生成 snapshot。

---

## 12. 最终 Dependency Freeze

允许：

```text
Navigation  -> Physics
Locomotion  -> Navigation
Locomotion  -> Physics
Interaction -> Spatial
Interaction -> Navigation
Interaction -> Locomotion
Interaction -> Physics
```

禁止：

```text
Physics     -> Spatial / Navigation / Locomotion / Interaction / Rendering
Spatial     -> Physics / Navigation / Locomotion / Interaction / Rendering
Navigation  -> Locomotion / Interaction / Rendering
Locomotion  -> Interaction / Rendering
Interaction -> Rendering
Rendering   -> Physics / Spatial / Navigation / Locomotion / Interaction control APIs
```

特别禁止隐藏依赖：

```text
lower system subscribes to higher-system action event
lower system switches on higher-system action names
UI / Rendering becomes simulation truth
Spatial query mutates World to answer a query
Navigation duplicates Physics collision truth
```

---

## 13. 扩展规则

新增 World Runtime 能力时按以下顺序判断 ownership：

```text
物理事实？          -> Physics
几何查询？          -> Spatial
哪里能走？          -> Navigation
怎么移动过去？      -> Locomotion
执行具身动作？      -> Interaction
怎么显示？          -> Rendering
跨系统一致性？      -> WorldRuntime composition/mutation boundary
```

只有现有 contract 无法表达真实需求时才扩 API。

不要因为文件变长就新增：

```text
WorldManager
SpatialManager
NavigationService
InteractionCoordinator
RuntimeController
```

优先保持：

```text
Deep Module
Explicit dependency
Single Truth Owner
No reverse dependency
Extract by Pressure
```

这套依赖关系是当前 World Runtime 的 architecture freeze baseline。
