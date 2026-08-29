# AgentScape Observatory

`observatory/` 与 `studio/` 平级：Studio 负责完整产品组合；Observatory 负责把生产 Runtime 拆层观察、单步和验证。

```text
                 AgentScape Runtime
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
       Studio      Observatory       Tests
      完整产品       人工观测         自动验证
```

## 设计约束

1. Observatory 不拥有第二套 Physics / Navigation / Interaction 实现。
2. Scenario 必须驱动 `world/runtime/` 与 `agent/` 的生产代码。
3. Debug geometry/state 必须来自 Runtime Debug Contract，不允许 UI 穿透 backend 私有 world。
4. 所有实验默认固定时间步，可 Run / Pause / Single Step / Reset。
5. Synthetic fixture 与真实 Asset scenario 分开，便于判断是 Backend 问题还是 Asset/Compiler 问题。
6. Rapier/Jolt comparison 使用同一 Scenario、同一 fixed dt 与 normalized snapshot。
7. Synthetic geometry 可以自建，但生产 Manifest / Schema / Runtime contract 必须直接复用，禁止复制一份“实验版真值”。

## 当前入口

```text
/observatory/?lab=physics&scenario=physics.gravity.basic&backend=rapier
/observatory/?lab=physics&scenario=physics.gravity.basic&backend=jolt
/observatory/?lab=physics&scenario=physics.gravity.basic&backend=compare
/observatory/?lab=spatial&scenario=spatial.raycast.bvh&backend=three-bvh
```

`backend=compare` 会同步运行 Rapier 与 Jolt，并比较 normalized physics state。

## Physics Lab 当前能力

```text
Scenarios
├── Gravity
├── Collision
├── Stack
├── Hinge
├── production Cup
└── production Cabinet

Simulation
├── Fixed 60 Hz
├── Run / Pause
├── Step 1
├── Step 10
└── Reset

Backend
├── Rapier
├── Jolt
└── Rapier ↔ Jolt comparison

Debug Layers
├── Rapier Native Geometry
├── Normalized Collider
├── Velocity vectors
├── Joint world anchor / axis
├── Contact pair / normal
└── Grid / Axes

Observation
├── Runtime Inspector
├── Scenario Assertions
├── per-step measurement
└── Backend normalized diff
```


## Spatial Lab 当前能力

```text
Scenarios
├── BVH Raycast
├── Bounds / Overlap
└── Support / FreeSpace

Production contracts
├── SpatialSystem.snapshot / collisionPairs
├── SpatialSystem.raycast
├── SpatialSystem.supportStatus
├── SpatialSystem.findFreeSpace
└── ThreeBvhRuntime
```

`ThreeBvhRuntime` 属于 World/Spatial runtime，而不是 Observatory。Observatory 只负责驱动和显示。AssetManager 不再通过隐式 prototype 初始化承担 BVH ownership；对象进入 WorldRuntime 时由 World/Spatial 明确准备 bounds tree。

## Spatial Debug Contract

```js
spatial.debugSnapshot()
```

返回 normalized bounds、collision pairs 与 metrics；Ray / support / free-space query evidence 由 Spatial Lab context 作为实验观测附加，不进入 SpatialSystem 的业务 truth。

## Physics Debug Contract

Observatory 只调用：

```js
physics.debugSnapshot({
  nativeGeometry: true,
  contacts: true
});
```

标准化结果包含：

```text
PhysicsDebugSnapshot
├── schemaVersion
├── backend
├── bodies[]
│   ├── pose
│   ├── linear/angular velocity
│   └── sleeping
├── colliders[]
│   ├── world pose
│   └── normalized shape
├── joints[]
│   ├── local axis/anchors
│   ├── worldAxis
│   ├── worldAnchor
│   └── coordinate
├── contacts[]
│   ├── source / target provenance
│   ├── normal
│   ├── impulse / evidence kind
│   └── anchorKind
├── nativeGeometry
└── metrics
```

当前 backend contact contract 没有统一的精确 world-space contact point，因此 contact normal 的可视化锚点使用两个 collider 中心的中点，并明确标记：

```text
anchorKind = collider-midpoint
```

它只是绘制 normal 的锚点，不冒充真实 contact point。

## Rapier / Jolt 差异语义

Rapier 当前 contact evidence 主要来自 solver contact；Jolt 当前 production adapter 的 contact evidence 主要来自 geometric contact。因此 comparison 会展示 contact count delta，但不要求二者 contact count 完全相同。

Normalized comparison 当前关注：

```text
position delta
linear velocity delta
angular velocity delta
joint coordinate delta
sleeping mismatch
missing body / joint
contact count delta
```

## 后续顺序

```text
Physics + Spatial Observatory
  ↓
Deterministic checkpoint / replay
  ↓
Synthetic vs real Asset truth comparison
  ↓
Navigation / Recast Lab
  ↓
Interaction Lab
  ↓
AgentTools Lab
```
