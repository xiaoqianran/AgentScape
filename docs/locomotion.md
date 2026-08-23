# Embodied Locomotion

AgentScape 1.15 第一次让 Agent 不只是查询路径，而是拥有一个真正的 **Rapier kinematic Agent Body**，沿 Detour path 在世界里移动。

核心边界：

```text
Detour
= global path truth

Rapier CharacterController
= local physical movement truth

LocomotionSystem
= waypoint execution state
```

这三者不互相替代。

---

## 1. 为什么不是 `moveObject(agent, target)`

`moveObject` 是明确的世界坐标 mutation：

```text
object.position = target
physics.setPosition(target)
```

它适合 Human Editor 或需要确定性重定位的普通物体，不是 embodied locomotion。

Agent Body 的 Manifest **没有** `move` action：

```text
actions = ["navigate"]
```

因此：

```text
moveObject(agent_01, ...)
→ ACTION_UNSUPPORTED
```

Agent 必须通过：

```text
navigateTo(agent_01, end)
```

移动。

这从 Runtime contract 层阻止 teleport，而不是只靠 Prompt 约束 LLM。

---

## 2. Agent Body 是普通 Asset

内置 Agent：

```text
assetId = agent
instanceId = agent_01
```

Manifest：

```text
type = agent
source.kind = builtin
actions = [navigate]
physics.body = kinematic
physics.navigationObstacle = false
collider = capsule
```

Collider：

```text
radius = 0.32m
central halfHeight = 0.53m
local center = [0, 0.85, 0]
```

因此总高度约：

```text
0.53 × 2 + 0.32 × 2
≈ 1.70m
```

对象 root 的世界坐标表示**脚底位置**。

Agent 不存在独立的：

```text
agentPose
characterPose
avatarTransform
```

位置唯一事实仍是 Rapier rigid body；Three/ObjectStore 每个 physics step 从它同步。

---

## 3. 为什么选择 Capsule

Rapier 官方 CharacterController 推荐 cuboid、ball 或 capsule，因为这些形状计算更简单、数值近似更少。

AgentScape 选 capsule：

```text
    ___
  /     \
 |       |
 |       |
 |       |
  \_____/
```

原因：

- 比 box 更适合滑墙和转角。
- 没有尖锐底角容易卡住台阶边缘。
- 绕 Y 轴旋转对碰撞几何没有影响。

因此 1.15 把 `capsule` 正式加入 Asset Manifest collider contract，而不是在 Locomotion 内部藏一个私有 shape。

---

## 4. Rapier CharacterController 是局部物理真值

PhysicsSystem 初始化一个 Rapier `KinematicCharacterController`：

```text
offset = 0.02m
autostep maxHeight = 0.30m
autostep minWidth = 0.20m
includeDynamicBodies = false
snapToGround = 0.30m
maxSlopeClimb = 45°
minSlopeSlide = 30°
pushDynamicBodies = false
```

每帧：

```text
desired translation
      ↓
computeColliderMovement(capsule)
      ↓
corrected movement
      ↓
setNextKinematicTranslation
      ↓
Rapier World.step()
      ↓
ObjectStore / Three sync
```

不是：

```text
object.position += velocity
```

因此墙、台阶、固定 collider 都参与真实执行。

---

## 5. 重力与下坡

Kinematic body 不受普通重力直接驱动。

Rapier CharacterController 官方要求调用者自己给 desired movement 加向下分量。

LocomotionSystem 因此维护**每个 active task 的 transient verticalVelocity**：

```text
verticalVelocity -= 9.81 * dt
```

如果 CharacterController 报告 grounded：

```text
verticalVelocity = -0.5
```

保留轻微向下分量，让：

```text
snap-to-ground
```

在下台阶/缓坡时有条件生效。

这个 velocity 不进入 Scene JSON，因为它只是当前执行过程中的 transient solver state。

---

## 6. 路径是谁算的

LocomotionSystem 不做 A*、不查 NavMesh polygon。

开始时：

```text
Rapier current foot position
        ↓
NavigationSystem.findPath()
        ↓
Detour path
        ↓
waypoints
```

LocomotionSystem 只消费：

```text
route.path
```

它不知道 Recast tile、poly ref、TileCache handle。

所以 ownership 仍然是：

```text
NavigationSystem
→ path truth

LocomotionSystem
→ execute path
```

---

## 7. 每帧怎么走

假设当前 waypoint：

```text
[xw, yw, zw]
```

当前 Rapier body：

```text
[x, y, z]
```

先只计算 XZ 平面的方向：

```text
dx = xw - x
dz = zw - z
```

单帧最大水平位移：

```text
min(distance, speed * dt)
```

再叠加 transient gravity displacement。

这样台阶高度不是由 Detour waypoint 的 Y 直接 teleport 上去；真正的升高由 Rapier autostep / collision solver 完成。

---

## 8. 朝向

Rapier CharacterController 官方只负责 translation，不解决 rotation。

Agent capsule 绕 Y 轴对称，因此 LocomotionSystem 可以安全地把 kinematic body 的 yaw 朝向当前 waypoint：

```text
setNextKinematicRotation(yaw)
```

这个旋转不会改变 capsule 的碰撞占用，只让 Three.js visual visor 朝行进方向。

---

## 9. `navigateTo` Skill

Skill：

```text
navigateTo(id, end, speed?)
```

权限：

```text
world.write
spatial.read
physics.read
```

执行条件：

```text
record.manifest.type == agent
record.manifest.actions contains navigate
physics.body == kinematic
```

它先调用当前 world 的 `findPath`。

不可达：

```text
status = unreachable
```

不会修改 durable navigation state。

可达：

```text
status = moving
```

然后 Skill **不会立即返回**，而是等待：

```text
arrived
blocked
cancelled
```

中的一个终态。

---

## 10. 为什么 Skill 要等待完成

如果 `navigateTo` 立刻返回：

```text
started
```

SkillRegistry 的 mutation history 会立刻 commit，但 Agent 实际位置还在后续几十/几百帧变化。

这会产生：

```text
History truth
≠
World transform truth
```

1.15 选择：

```text
SkillRegistry.invoke(navigateTo)
       ↓
runtime.mutate()
       ↓
await LocomotionSystem.navigate()
       ↓
frame update ... frame update
       ↓
arrived / blocked
       ↓
History commit final snapshot
```

因此一次完整行走只有**一个** History command。

---

## 11. 长 Mutation 的并发锁

Locomotion 第一次让 `runtime.mutate()` 明确持续数秒。

这暴露了旧代码的真实并发风险：

```text
Mutation A begin
      ↓
await long operation
      ↓
Mutation B begin
```

CommandHistory 只有一个 pending command。

如果 B 在 A 中途执行，旧实现可能错误提交 A 的 History。

1.15 增加极小的：

```text
WorldRuntime.mutationOwner
```

规则：

```text
mutation active
+
second world mutation
→ WORLD_MUTATION_BUSY
```

没有新增 Mutex/Queue 类。

Human Editor 拖拽如果撞上 active Skill mutation：

```text
TransformControls.reset()
```

恢复本次 drag 的开始姿态，不让 Three visual 和 Rapier/History 分叉。

---

## 12. `blocked` 是真实执行结果

Detour path 只描述规划时的可行走空间。

执行过程中可能发生：

```text
新的 Physics obstacle
动态物体进入通道
NavMesh 尚未表达的 physical blocker
```

CharacterController 会给出 corrected movement。

如果 Agent 连续约 1.25 秒没有足够水平进展：

```text
status = blocked
reason = PHYSICS_BLOCKED
```

并保留实际已经走到的位置。

不会：

```text
穿墙
teleport 到下一 waypoint
自动假装 obstacle 消失
```

第一版也不会偷偷重新规划。

调用方可以根据新 current-world truth：

```text
findPath
suggestNavigationActions
navigateTo
```

重新决定下一步。

---

## 13. 真实高低差 E2E

Ruined Courtyard：

```text
Agent start
[0, 0, 12]

        ↓ Detour path

6 × 0.2m physical steps
        ↓

East Terrace
[12, 1.2, 4.8]
```

测试使用：

```text
真实 Recast path
真实 Rapier fixed environment colliders
真实 kinematic capsule
真实 CharacterController
真实 PhysicsSystem.step
```

结果：

```text
status = arrived
final x > 11.7
final y > 1.0
final z > 4.4
static NavMesh buildVersion = 1
```

说明 Agent 不是直接采用 waypoint Y，而是真的通过 autostep 走上高台。

---

## 14. 真实阻挡 E2E

另一个测试故意构造：

```text
Recast environment
只看见 floor

Rapier environment
看见 floor + wall
```

所以：

```text
findPath = reachable
```

但执行时：

```text
Agent → wall
```

CharacterController 把它停在墙前，最终：

```text
status = blocked
reason = PHYSICS_BLOCKED
```

这个测试专门证明：

> Detour waypoint 不是 teleport authority。

---

## 15. Agent 为什么 `navigationObstacle = false`

当前 1.15 是**单 embodied agent**基线。

如果把 agent 自己作为 query-time TileCache obstacle：

```text
Agent collider
      ↓
carve 起点附近 NavMesh
      ↓
findPath(start, target)
可能先被自己阻断
```

所以 builtin Agent Manifest 明确：

```text
physics.navigationObstacle = false
```

但它仍然有真实 Rapier capsule，所以 CharacterController 会与 Environment / objects 发生物理碰撞。

这不是 Multi-Agent 完成方案。

多个 Agent 时需要重新定义：

```text
self obstacle filtering
other-agent local avoidance
planner-level dynamic occupancy
```

1.15 不假装已经解决。

---

## 16. 为什么现在不用 Detour Crowd

`recast-navigation-js` 已经提供成熟 Crowd API，包括：

```text
Crowd
CrowdAgent
requestMoveTarget
velocity
separationWeight
fixed/variable update
```

它很适合：

```text
多个 Agent
local avoidance
群体 steering
```

但当前 AgentScape 的核心问题是：

```text
路径规划结果
如何变成不会穿 Rapier 世界的真实移动
```

如果现在直接把 Crowd 的 `agent.position()` 当 World pose：

```text
Detour Crowd position
        ↓
Three / ObjectStore
```

会绕过 Rapier CharacterController，形成第二个运动积分器。

因此 1.15 不接 Crowd。

未来 Multi-Agent 可以研究：

```text
Crowd desired velocity / steering
        ↓
Rapier CharacterController
        ↓
actual movement truth
```

前提是先证明需要，而不是让 Crowd 和 Rapier 同时拥有 position authority。

---

## 17. Pages 与默认世界

三个 curated world 的 bootstrap 现在都包含：

```text
agent_01
```

默认位置分别来自 Environment Catalog。

1.14 以前本地 autosave 没有 Agent。Pages 启动恢复旧 autosave 后，如果：

```text
没有 type=agent 对象
```

才按当前 world 的 `bootstrap.agent` 补 `agent_01`。

这个迁移只作用于 Pages 本地 autosave。

用户手工导入的 Scene JSON 不会被偷偷插入 Agent。

Pages Console 同时记录：

```text
locomotion.started
locomotion.arrived
locomotion.blocked
```

---

## 18. 当前不做

1.15 明确不做：

```text
Detour Crowd
多 Agent avoidance
自动动态 replan
off-mesh connection traversal
jump / climb animation
root motion
animation state machine
push dynamic bodies
navmesh streaming
full task-and-motion planner
```

当前完成的是最小但真实的纵向闭环：

```text
Agent Body
→ current Detour path
→ Rapier move-and-slide
→ stairs / walls
→ arrived or blocked
→ final world transform
```

这是后续 Multi-Agent、交互距离、Manipulation locomotion 的可信基础。
