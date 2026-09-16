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

它不拥有 Rapier/Jolt native world schema。运行时动力学通过 `setMotion / applyImpulse / applyForce / applyTorque / setMaterial / setDynamics / setCcd / setSensor / sleep / wake` 使用 objectId/partName 语义，不向调用方暴露 native body。碰撞/传感器边沿事件通过 `getCollisionEvents()` 返回语义对象引用，不暴露 native collider handle。

### Runtime phases and naming

```text
World / Asset / Commands
        ↓
       Sync
        ↓
       Step
        ↓
    Writeback
        ↓
  World / Three.js
```

公开命名约定固定为：

- `addObject / removeObject`：生命周期；
- `syncTransform`：World → Physics 同步；
- `step`：solver simulation；
- `writeback`：Physics → World 同步；
- `get* / set*`：读取 / 设置语义状态；
- `apply*`：施加物理作用；
- `check*`：返回结构化检查结果。

`check*` 不使用 `is*`，因为返回值包含 `checked / clear / reason / capability / blockedBy` 等证据，而不是单一 boolean。

## 3. 对接 API（PhysicsSystem）

业务模块只对接 `PhysicsSystem`，不要直接调用 `PhysicsBackend`、Rapier 或 Jolt。

### 3.1 Asset / Manifest 输入

根物体和 Part 都使用同一套 `physics` 字段：

```js
physics: {
  body: 'fixed' | 'dynamic' | 'kinematic',

  mass: 1,
  friction: 0.5,
  restitution: 0.2,
  linearDamping: 0.1,
  angularDamping: 0.1,
  gravityScale: 1,

  canSleep: true,
  lockTranslation: [false, false, false],
  lockRotation: [false, false, false],

  ccd: false,
  sensor: false,
  collisionEvents: false,
  collision: {
    groups: ['prop'],
    collidesWith: ['environment', 'agent', 'prop']
  },

  colliders: [
    { shape: 'box', halfExtents: [0.5, 0.5, 0.5], translation: [0, 0, 0] }
  ]
}
```

Part joint：

```js
joint: {
  type: 'revolute' | 'prismatic' | 'fixed',
  axis: [0, 1, 0],          // fixed 不声明
  parentAnchor: [0, 0, 0],
  childAnchor: [0, 0, 0],
  limits: [0, 1.57],        // fixed 不声明
  motor: { stiffness: 60, damping: 10 } // fixed 不声明
}
```

`fixed` 是结构连接，不进入 articulation target/coordinate API。

### 3.2 生命周期与同步

```js
physics.addObject(id, manifest, object3D)
physics.removeObject(id)

physics.beginTransform(id)
physics.syncTransform(id, object3D)
physics.endTransform(id)

physics.step(dt, objectStore)
physics.writeback(objectStore)
physics.dispose()
```

正常 Runtime 每帧只需要调用 `step(dt, store)`；它内部执行 solver step、collision event reconcile 和 writeback。

### 3.3 Transform / Motion

```js
physics.getPosition(id)
physics.getRotation(id)
physics.setPosition(id, position)

physics.getMotion(id, { partName })
physics.setMotion(id, {
  linearVelocity,
  angularVelocity
}, { partName })

physics.applyImpulse(id, impulse, { partName, point, wake })
physics.applyForce(id, force, { partName, point, wake })
physics.applyTorque(id, torque, { partName, wake })
```

约定：

- `partName` 默认 `$root`；
- `point` 是 world-space 施力点；
- `applyImpulse` 是瞬时冲量；
- `applyForce/applyTorque` 只作用下一次 simulation step，持续力需要每 step 重复调用。

### 3.4 Dynamics / Collision

```js
physics.setMaterial(id, { friction, restitution }, { partName })
physics.setDynamics(id, {
  linearDamping,
  angularDamping,
  gravityScale
}, { partName })

physics.setCcd(id, enabled, { partName })
physics.setSensor(id, enabled, { partName })
physics.setCollisionFilter(id, {
  groups,
  collidesWith
}, { partName })

physics.sleep(id, { partName })
physics.wake(id, { partName })
```

Collision filter 使用双向许可：

```text
A.groups ∩ B.collidesWith != ∅
AND
B.groups ∩ A.collidesWith != ∅
        ↓
      interact
```

未声明 collision filter 的对象保持 wildcard，全类别兼容。

### 3.5 Collision / Sensor Events

```js
const events = physics.getCollisionEvents(); // 默认读取后清空

// clear:false 可 peek，不清队列
physics.getCollisionEvents({ clear: false })
```

事件类型：

```text
collision-started
collision-ended
sensor-entered
sensor-exited
```

事件只返回 AgentScape 语义引用：

```js
{
  type: 'sensor-entered',
  a: { kind: 'object', objectId: 'agent_1', partName: '$root', colliderIndex: 0 },
  b: { kind: 'object', objectId: 'trigger_1', partName: '$root', colliderIndex: 0 }
}
```

不会暴露 native collider/body handle。

### 3.6 Articulation

```js
physics.getArticulationState(id, partName, { target })
physics.setArticulationTarget(id, partName, target)
physics.holdArticulationCurrent(id, partName)

physics.articulationContacts(id, partName)
physics.articulationPenetrations(id, partName, { refresh })
```

只对 `revolute/prismatic` 提供 coordinate/target 语义；`fixed` 返回不可驱动。

### 3.7 Character

```js
physics.moveCharacter(id, desiredTranslation, { ignoreIds })
physics.cancelCharacterMovement(id)
physics.faceCharacter(id, direction)
physics.setCharacterYaw(id, yaw)
```

Navigation 只产生路径；沿路径的移动由 Locomotion 调用这些 character API 执行。

### 3.8 Query / Validation

```js
physics.raycast(origin, target, { excludeId, excludeIds })

physics.checkManifestPose(manifest, targetPosition, { excludeIds })
physics.checkBodyPose(id, targetPosition, targetRotation, { excludeIds })
physics.checkBodyMotion(id, targetPosition, targetRotation, { excludeIds })

physics.getNavigationObstacles()
```

`check*` 返回结构化 evidence，不是单纯 boolean。调用方应读取 `checked / clear / reason / blockedBy` 等字段。

### 3.9 能力与调试

```js
physics.hasCapability(name)
physics.runtimeCapabilities()
physics.profile()
physics.debugSnapshot()
```

### 3.10 对接规则

```text
业务层 / World / Interaction / Navigation / Locomotion
                         ↓
                    PhysicsSystem
                         ↓
                    PhysicsBackend
                    ↙            ↘
                 Rapier          Jolt
```

固定规则：

- 业务层只持有 `objectId / partName`，不持有 native handle；
- Manifest 表达静态物理属性，Runtime API 表达运行时动作；
- 不要从业务层直接调用 Rapier/Jolt；
- 不要把 `applyImpulse/applyForce/...` 写进 Asset Manifest；
- Backend 差异必须在 `PhysicsBackend` 内消化。

## 4. PhysicsBackend 是什么

`PhysicsBackend` 是 deep runtime contract。当前 full solver method 面包括：

```text
world lifecycle
body lifecycle / type / pose / motion / impulse / force / torque / dynamics / sleep-wake / CCD
body material (friction / restitution) / sensor
collider lifecycle / provenance snapshot
joint creation / target
character movement
scene query / cast / raycast
contact / penetration / intersection
```

返回 handle 对 PhysicsSystem 是 opaque。

### Runtime dynamics / collision controls

```text
applyImpulse   瞬时改变动量
applyForce     作用于下一次 simulation step 的力；持续施力需要每帧调用
applyTorque    作用于下一次 simulation step 的扭矩；持续扭矩需要每帧调用
setCcd         高速动态刚体连续碰撞检测
setSensor      碰撞体只检测重叠，不产生实体阻挡
getCollisionEvents
  ├─ collision-started / collision-ended
  └─ sensor-entered / sensor-exited
```

Manifest 可声明 `physics.ccd`、`physics.sensor`、`physics.collisionEvents`。事件只为声明了 `collisionEvents` 或 `sensor` 的 collider 跟踪，避免无条件扫描整个世界。

### Named collision filtering

Asset/Part 使用 backend-neutral 名称，不暴露 Rapier bitmask 或 Jolt layer id：

```js
physics: {
  collision: {
    groups: ['prop'],
    collidesWith: ['environment', 'agent', 'prop']
  },
  sensor: false,
  collisionEvents: true
}
```

固定语义：

- `groups`：该 body 属于哪些碰撞类别；
- `collidesWith`：该 body 接受哪些类别参与物理交互；
- A/B 只有在 `A.groups ∩ B.collidesWith != ∅` 且 `B.groups ∩ A.collidesWith != ∅` 时才交互；
- `sensor` 只改变“是否实体阻挡”，不改变 group/filter 身份；
- `collisionEvents` 只改变是否跟踪语义事件。

`PhysicsSystem` 将名称编译成统一 16-bit membership/filter；Rapier 映射为 `InteractionGroups`，Jolt 映射为 `GroupFilterTable`。为保持两个 backend 的相同 contract，单个 Physics world 最多注册 16 个不同的 collision group 名称。未声明 `physics.collision` 的旧资产保持 legacy wildcard 行为，用于无破坏迁移。运行时可用 `setCollisionFilter(id, collision, { partName })` 修改。

Conformance 还禁止 concrete backend 添加 contract 外的公开方法，防止 native schema 重新泄漏。

## Physics v1 Freeze

Physics v1 的稳定公共语义冻结为：

```text
Body: fixed / dynamic / kinematic
Dynamics: mass / friction / restitution / damping / gravityScale
Motion: velocity / impulse / force / torque
Sleep: canSleep + sleep() / wake() + sleeping state
Axis locks: lockTranslation[3] / lockRotation[3] (creation-time)
Collision: groups / collidesWith / sensor / collisionEvents / CCD
Collider: box / cylinder / capsule / convexHull (+ runtime environment trimesh)
Joint: fixed / revolute / prismatic
Character: controller movement
Query: raycast / cast / overlap / penetration / contacts
Runtime phases: Sync → Step → Writeback
```

稳定性规则：

- 业务层只依赖 `PhysicsSystem`；native Rapier/Jolt handle 不进入业务语义。
- `groups + collidesWith` 使用双向许可；未声明 collision filter 的旧资产保持全碰撞兼容。
- `applyForce / applyTorque` 只作用下一次 simulation step；持续作用需要每 step 重复调用。
- Axis locks 是创建时属性：当前 Jolt binding 不提供运行时 AllowedDOFs setter，因此 v1 不暴露不对等的运行时修改 API。
- `fixed` joint 是 structural joint：不声明 axis / limits / motor / targets，不进入 articulation coordinate API；`setJointTarget` 仅适用于 revolute/prismatic。
- v1 之后不继续扩张 soft body / cloth / vehicle / advanced joints，除非出现真实产品压力。

## 5. Backend capability

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

## 6. Execution Modes

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

## 7. Rapier 与 Jolt 的内部模型不同

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

## 8. Joint / Articulation

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
PhysicsSystem.getNavigationObstacles()
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
