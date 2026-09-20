# Physics

AgentScape 的 Physics 只负责刚体、碰撞、关节、角色移动和物理查询。业务层统一通过 `PhysicsSystem` 对接，不直接使用 Rapier/Jolt。

```text
World / Interaction / Navigation / Locomotion
                    ↓
              PhysicsSystem
                    ↓
              PhysicsBackend
              ↙           ↘
           Rapier         Jolt
```

## 1. Manifest

根物体和 Part 使用同一套 `physics` 字段：

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
    { shape: 'box', halfExtents: [0.5, 0.5, 0.5] }
  ]
}
```

Joint：

```js
joint: {
  type: 'revolute' | 'prismatic' | 'fixed',
  axis: [0, 1, 0],
  parentAnchor: [0, 0, 0],
  childAnchor: [0, 0, 0],
  limits: [0, 1.57],
  motor: { stiffness: 60, damping: 10 }
}
```

`fixed` 只保留 `type / parentAnchor / childAnchor`，不声明 `axis / limits / motor / targets`。

## 2. PhysicsSystem API

### Lifecycle / Sync

```js
physics.addObject(id, manifest, object3D)
physics.removeObject(id)
physics.beginTransform(id)
physics.syncTransform(id, object3D)
physics.endTransform(id)
physics.step(dt, objectStore)
physics.dispose()
```

正常 Runtime 每帧调用 `step(dt, store)`；它完成 solver step、collision event 更新和 writeback。

### Motion / Dynamics

```js
physics.getPosition(id)
physics.getRotation(id)
physics.setPosition(id, position)
physics.getMotion(id, { partName })
physics.setMotion(id, motion, { partName })

physics.applyImpulse(id, impulse, { partName, point, wake })
physics.applyForce(id, force, { partName, point, wake })
physics.applyTorque(id, torque, { partName, wake })

physics.setMaterial(id, { friction, restitution }, { partName })
physics.setDynamics(id, { linearDamping, angularDamping, gravityScale }, { partName })
physics.setCcd(id, enabled, { partName })
physics.sleep(id, { partName })
physics.wake(id, { partName })
```

`partName` 默认 `$root`。`applyForce/applyTorque` 只作用下一次 simulation step；持续施力需要每 step 调用。

### Collision

```js
physics.setSensor(id, enabled, { partName })
physics.setCollisionFilter(id, {
  groups,
  collidesWith
}, { partName })

physics.getCollisionEvents()
physics.getCollisionEvents({ clear: false })
```

碰撞过滤采用双向许可：

```text
A.groups ∩ B.collidesWith != ∅
AND
B.groups ∩ A.collidesWith != ∅
        ↓
      interact
```

`groups` 表示“我属于哪些类别”，`collidesWith` 表示“我接受哪些类别”。未声明 collision filter 的对象保持 wildcard 兼容。

事件类型：

```text
collision-started
collision-ended
sensor-entered
sensor-exited
```

事件只返回 `objectId / partName / colliderIndex` 等 AgentScape 语义，不暴露 native handle。

### Query

```js
physics.raycast(origin, target, { excludeId, excludeIds })
physics.checkManifestPose(manifest, targetPosition, { excludeIds })
physics.checkBodyPose(id, targetPosition, targetRotation, { excludeIds })
physics.checkBodyMotion(id, targetPosition, targetRotation, { excludeIds })
physics.getNavigationObstacles()
```

`check*` 返回结构化结果，如 `checked / clear / reason / blockedBy`，不是单一 boolean。

### Character

```js
physics.moveCharacter(id, desiredTranslation, { ignoreIds })
physics.cancelCharacterMovement(id)
physics.faceCharacter(id, direction)
physics.setCharacterYaw(id, yaw)
```

Navigation 负责路径；Locomotion 调用这些 API 执行实际移动。

## 3. Articulation

```js
physics.getArticulationState(id, partName, { target })
physics.setArticulationTarget(id, partName, target)
physics.holdArticulationCurrent(id, partName)
physics.articulationContacts(id, partName)
physics.articulationPenetrations(id, partName, { refresh })
```

只有 `revolute / prismatic` 进入 articulation coordinate/target API；`fixed` 是结构连接，不可驱动。

## 4. Stability Rules

- 业务层只依赖 `PhysicsSystem`，不要直接调用 `PhysicsBackend`、Rapier 或 Jolt。
- Manifest 描述静态物理属性；运行时动作使用 `PhysicsSystem` API。
- 不把 `applyImpulse / applyForce / applyTorque` 等命令写进 Manifest。
- `groups + collidesWith` 使用双向许可。
- Axis locks 是创建时属性。
- `fixed` joint 不参与 articulation target/coordinate。
- Physics v1 暂不扩展 soft body、cloth、vehicle 或高级 joints，除非出现真实产品需求。
