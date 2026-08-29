# Physics Runtime 与 Replaceable Solver Backends

本文是当前 Physics contract 的权威实现文档。历史上“PhysicsSystem = Rapier world”的描述已经失效。

## 1. 当前结构

```text
World / Interaction / Navigation / Locomotion / Validator
                         │
                         ▼
                   PhysicsSystem
                         │
                semantic deep contract
                         │
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
        Rapier          Jolt        Transform
        solver          solver      render-only
```

## 2. PhysicsSystem 是什么

`PhysicsSystem` 是 World Runtime 的 physics semantic/state owner。它负责：

- Object/Part 与 opaque body/collider handle 的绑定；
- provenance；
- root/part transform 同步；
- articulation semantic state；
- held/pending pose；
- character movement 的统一返回协议；
- navigation obstacle projection；
- counterfactual query orchestration；
- effective capability/execution profile。

它不拥有 Rapier/Jolt native world schema。

## 3. PhysicsBackend 是什么

`PhysicsBackend` 是 deep runtime contract。当前 full solver method 面包括：

```text
world lifecycle
body lifecycle / type / pose / motion
collider lifecycle / provenance snapshot
joint creation / target
character movement
scene query / cast / raycast
contact / penetration / intersection
```

返回 handle 对 PhysicsSystem 是 opaque。

Conformance 还禁止 concrete backend 添加 contract 外的公开方法，防止 native schema 重新泄漏。

## 4. Backend capability

| Capability | Rapier | Jolt | Transform |
| --- | :---: | :---: | :---: |
| rigid-body | ✅ | ✅ | — |
| articulated-body | ✅ | ✅ | — |
| character-controller | ✅ | ✅ | — |
| collision | ✅ | ✅ | — |
| joints | ✅ | ✅ | — |
| scene-query | ✅ | ✅ | — |
| transform-state | Runtime composite | Runtime composite | ✅ |
| articulation-pose | Runtime composite | Runtime composite | ✅ |
| counterfactual-query | Runtime composite | Runtime composite | — |

## 5. Execution Modes

Native backend：

```text
Rapier → realtime + validation-only
Jolt   → realtime + validation-only
Transform → render-only
```

PhysicsSystem runtime composite：

```text
render-only
```

因此 full solver 的 effective profile 可以同时承载：

```text
rigid entity      → realtime
transform entity  → render-only
```

不会因为选 Rapier/Jolt 而得到不同 Admission 结果。

## 6. Rapier 与 Jolt 的内部模型不同

Rapier：

```text
RigidBody
├─ Collider A
├─ Collider B
└─ Collider C
```

Jolt：

```text
BodyID
└─ Shape
   └─ Compound Shape
      ├─ SubShape A
      ├─ SubShape B
      └─ SubShape C
```

Jolt backend 通过 `SubShapeID + userData` 映射回 semantic collider handle；PhysicsSystem 不知道这个差异。

## 7. Joint / Articulation

统一 Manifest 语义：

```text
joint.type
axis
parentAnchor
childAnchor
limits
motor
```

Backend mapping：

```text
Rapier revolute/prismatic joint
Jolt HingeConstraint / SliderConstraint
```

Jolt 使用 WorldSpace constraint frame，把 manifest body-local anchor/axis 转成 world frame，避免把 body-local origin 错当成 Jolt COM-local frame。

父子 joint solver contact 会被禁用，但 geometry penetration diagnostics 仍然可见：

```text
contactPairs      → solver contact semantics
penetrations      → geometric overlap diagnostics
```

## 8. Character Movement

统一返回：

```text
{
  success,
  movement,
  grounded,
  collisions
}
```

Rapier 使用 kinematic character controller；Jolt 使用短生命周期 `CharacterVirtual` adapter。

Jolt 仍以原 kinematic body 为唯一状态真相：

```text
current body pose
      │
      ▼
CharacterVirtual query
      │
      ▼
pending nextPose
      │
      ├─ cancel
      └─ physics.step() commit
```

这样 carry clearance 失败时，本帧 movement 可以撤销，与 Rapier pending movement 语义一致。

已验证：

- wall blocking；
- grounded；
- snap-to-ground；
- autostep；
- slope limit；
- ignoreIds；
- Locomotion `PHYSICS_BLOCKED` E2E。

## 9. Scene Query Parity

Rapier/Jolt shared parity Gate 锁定：

```text
raycast distance
shape-cast timeOfImpact
penetration sign/depth
collider provenance
```

这里要求 semantic unit 一致，不要求 native algorithm/manifold 完全相同。

## 10. Contact Evidence Quality

Rapier 能提供 solver impulse：

```text
{
  evidenceKind:'solver-contact',
  impulseAvailable:true,
  totalImpulse:number
}
```

当前 Jolt JS binding 只稳定暴露几何接触：

```text
{
  evidenceKind:'geometric-contact',
  impulseAvailable:false,
  totalImpulse:null
}
```

`TaskObservation` 与 Recovery aggregation 必须保留这个区别。

## 11. Navigation Obstacle Projection

Navigation 不读 native collider：

```text
PhysicsBackend colliderSnapshot
        │
        ▼
PhysicsSystem.navigationObstacles()
        │
        ├─ box
        ├─ cylinder
        ├─ upright capsule → conservative cylinder
        ├─ tilted capsule → conservative AABB
        └─ convexHull → conservative projection
        │
        ▼
NavigationSystem
```

## 12. Counterfactual

PhysicsSystem 负责 hypothetical trajectory/pose semantics；Backend 只提供 geometry/query primitive。

```text
PhysicsSystem samples hypothetical articulation
        │
        ▼
PhysicsBackend shapesIntersect / scene query
        │
        ▼
World-level blocker evidence
```

不要把 counterfactual policy 下沉到 Rapier/Jolt。

## 13. Backend Selection

默认仍是 Rapier：

```js
physicsFactory = () => new PhysicsSystem({
  backend: new RapierPhysicsBackend()
})
```

Jolt 通过同一个 composition seam 注入。没有 PhysicsManager/Registry。

## 14. Validation Gates

必须同时满足：

```text
backend conformance
Rapier/Jolt shared parity
Jolt articulation parity
Jolt character/locomotion E2E
World Physics Admission
full repository tests
architecture/assets/build
```

当前已提交基线（AgentScape `1bf17a6`）：180 test files / 858 tests PASS；完整基线同时要求 World Viability、Python SDK 与 Asset Compiler Service Gate 通过。
