# Agent-held Place：Release Trajectory、Dynamic Settle 与 Support Post-condition

AgentScape 1.18 把 1.17 的：

```text
pickup → carry → drop
```

第一次补成一个可信的具身放置闭环：

```text
held object
→ support surface free space
→ carry-aware interaction pose
→ real locomotion
→ release transfer trajectory
→ detach
→ Dynamic settle
→ deterministic support verification
```

高层 Skill：

```text
approachAndPlace(actorId, supportId, surfaceId?)
```

成功条件非常严格：

```text
status = placed
supportVerified = true
settled = true
```

只要缺少其中任一项，都不能说“物体已经放好了”。

---

## 1. 为什么旧 `place()` 不能直接包装成具身能力

旧低层 `InteractionSystem.place()`：

```text
findFreeSpace
→ pickup
→ setPosition(candidate)
→ drop
```

它是可靠的 scene-level deterministic editing primitive，适合：

- Human Editor。
- World Pipeline。
- 场景生成 / 修复。
- 批量确定性布局。

但它不是 embodied manipulation，因为它没有：

```text
Agent 当前是否持有对象
Agent 是否能走到目标附近
携带物是否会撞目标/墙
release trajectory
Dynamic settle
post-condition verification
```

所以 1.18 不删除低层 `place()`，只把 Agent-facing place 改为新的 `approachAndPlace`。

---

## 2. Agent-facing 参数为什么叫 `supportId`

第一版工具 Schema 使用：

```text
approachAndPlace(actorId, targetId, surfaceId?)
```

真实 Muse probe 把：

```text
targetId  = cup_01
surfaceId = table_01
```

这在自然语言上很合理：模型把“target”理解成被操作对象，把“surface”理解成桌子。

但 Runtime 真实语义是：

```text
held object
由 heldByAgent(actorId) 自动推导
```

模型根本不应该重复传 Cup id。

因此 Agent-facing Schema 改成：

```text
approachAndPlace(
  actorId,
  supportId,
  surfaceId?
)
```

其中：

```text
supportId = table_01
surfaceId = top
```

`surfaceId` 只是 support object Manifest 里的 surface 名，不是对象 ID。

这个命名变化不影响内部 `InteractionSystem.approachAndPlace(actorId,targetId)`；它只是让 Tool contract 更难误用。

---

## 3. 物体是谁，不让模型再传一次

Agent 当前 held object 的唯一 durable truth：

```text
cup_01.state.heldBy = {
  kind: "agent",
  id: "agent_01",
  anchor: "hold"
}
```

因此：

```text
heldId = InteractionSystem.heldByAgent(actorId)
```

如果没有：

```text
PLACE_UNAVAILABLE
reason = NOT_HOLDING_OBJECT
```

没有：

```text
approachAndPlace(actorId, cupId, tableId)
```

这种三份 ID 组合，减少模型参数错误，也避免 Tool args 与 Runtime ownership 不一致。

---

## 4. Surface free space 仍复用 SpatialSystem

Release 候选没有新写 placement algorithm。

继续使用：

```text
SpatialSystem.findFreeSpace(heldId, supportId)
```

它基于：

- support Manifest surface。
- held object 当前 bounds。
- surface usable X/Z。
- 当前 Scene object AABB snapshot。
- deterministic grid candidates。

先选出：

```text
collision-free candidate root position
```

这一步仍然只回答：

> “局部几何上哪里可能放得下？”

它不回答 Agent 能否走到那里，也不回答 release 后会不会真的稳定。

---

## 5. `findFreeSpace` 之后为什么还要重新算一次

Place 开始前先找候选，是为了知道目标 surface 是否有基本空间。

但 Agent 真正走过去期间：

- Dynamic objects 可能移动。
- Agent 自己的位置改变。
- Scene bounds 可能变化。

所以 `navigate` 返回后再次：

```text
findFreeSpace(heldId,supportId)
```

如果第二次没有空间：

```text
status = place-blocked
reason = NO_FREE_SURFACE_SPACE_AFTER_APPROACH
stillHeld = true
```

不会使用数秒前的 stale placement candidate。

---

## 6. 第一处真实 bug：Table bounds.min.y 不是 Agent foot Y

1.16 的 `findInteractionPose` 最初生成候选：

```text
candidateY = target.bounds.min.y
```

Cabinet visual 从地面开始：

```text
bounds.min.y ≈ 0
```

所以一直工作。

但 Table visual 的最低 Mesh 是桌面：

```text
bounds.min.y ≈ 0.92m
```

于是生成：

```text
Agent candidate foot Y ≈ 0.92m
```

Detour NavMesh 在地面约：

```text
y ≈ 0.1m
```

Endpoint snap 超过 max snap distance，所有 Table interaction pose 都失败。

这不是 Place fixture 问题，而是 `findInteractionPose` 的 frame/reference bug。

---

## 7. Interaction pose 的 Y 应来自 target root placement reference

AgentScape 资产 root 是 placement reference。

例如：

```text
Table on ground
root.y = 0

Table on Ruined Courtyard east terrace
root.y = 1.2
```

所以现在：

```text
candidateY = target.object world root Y
```

不是：

```text
visual bounds.min.y
```

这样：

- 只有桌面的 visual 不会把 Agent 抬到桌面上。
- 高台上的家具仍会给出对应高台 Y。
- Detour 继续做最终 snapped endpoint truth。

这个修复同时继续通过 1.16 Cabinet interaction 与 1.15 Ruined Courtyard locomotion 回归。

---

## 8. 第二处真实失败：Agent 能靠近，Cup 不一定能靠近

普通 interaction pose 的 stand-off：

```text
Agent capsule radius
+
clearance
```

约：

```text
0.32 + 0.12 = 0.44m
```

对 open/close 很合理。

但 Place 时 Cup 在身体前：

```text
hold anchor z ≈ -0.62m
cup radius ≈ 0.15m
```

真实 E2E 中 Agent 还没到 Table interaction pose，Cup 已经先撞桌沿：

```text
locomotion.status = blocked
reason = CARRIED_OBJECT_BLOCKED
blockedBy = table_01
```

说明：

```text
Agent body clearance
≠
Agent + carried-object clearance
```

---

## 9. Carry-aware stand-off

1.18 增加：

```text
carryStandOff(actorId, heldId)
```

当前简单 carry contract 下：

```text
horizontal hold anchor offset
+
held collider radius
```

即：

```text
sqrt(anchor.x² + anchor.z²)
+ max(collider.radius)
```

Place 的 interaction candidate 使用：

```text
offset = max(agentRadius, carryStandOff) + clearance
```

普通：

```text
approachAndInteract
approachAndPickup
```

仍然只用 Agent capsule stand-off。

所以 carry envelope 没有污染所有 interaction semantics。

---

## 10. Carry-aware stand-off 不是 carry collision 的替代品

它只是候选生成的 conservative geometry。

Agent 真实行走时仍然每帧执行 1.17 的：

```text
held-object next-anchor shape clearance
```

所以：

```text
carry-aware candidate
+
per-frame Rapier carry clearance
```

两层都保留。

前者减少明显不可能的 pose；后者仍是动态执行真值。

---

## 11. Place LOS 为什么忽略自己手里的物体

Held Cup 位于 Agent eye 和 Table 之间时，普通 physical ray 可能先命中 Cup。

如果把它当 occluder：

```text
Agent carrying Cup
→ Cup blocks Table LOS
→ 永远不能 place
```

1.18 扩展：

```text
PhysicsSystem.raycast(..., { excludeIds })
```

Place 的 LOS 只忽略：

```text
actorId
heldId
```

墙、其它物体、Environment 仍然参与。

专项 Physics test：

```text
near object
far object

normal ray
→ hit near

excludeIds=[near]
→ hit far
```

证明不是把所有碰撞查询关闭。

---

## 12. Release reach 量的是 Held Object，不是 Agent 脚底

第一版 Place 又暴露一个距离语义问题。

Carry-aware stand-off 让 Agent 离 Table 更远后：

```text
Agent foot → release center
≈ 1.66m
```

如果拿固定 1.5m interaction distance 去量脚底，会错误拒绝。

但真正 release 动作开始于：

```text
Cup 当前 hold pose
```

由于 Cup 已前伸：

```text
Cup → release point
≈ 1m
```

所以现在：

```text
releaseDistance
=
distance(held current root, release root)
```

固定最大仍然是：

```text
DEFAULT_INTERACTION_DISTANCE = 1.5m
```

没有放宽 policy，只修正“从哪里量”。

---

## 13. 为什么 release 不是一条直线

从 Hold Anchor 直接直线到桌面中心，很容易穿过桌沿：

```text
hand
  \________ release
      table edge
```

1.18 不做 IK，也不伪造机械臂轨迹，但至少执行一个确定性的三段 transfer：

```text
1. LIFT
current held pose
→ safe height

2. TRAVERSE
safe height
→ above release XZ

3. LOWER
above release
→ release pose
```

Safe height：

```text
max(
  current held root Y,
  releaseY + objectHeight + 0.08m
)
```

---

## 14. 三段 transfer 每一段都是真实 shape cast

每个 segment：

```text
PhysicsSystem.bodyMotionClear(
  heldId,
  nextPoint,
  currentRotation,
  excludeIds=[actorId]
)
```

然后只有：

```text
clear = true
```

才把仍为 Kinematic 的 held body 移到该 waypoint。

如果任何一步失败：

```text
setHeldPose(original hold pose)
```

恢复到 transfer 开始位置，ownership 不变。

返回：

```text
status = place-blocked
reason = PLACE_TRANSFER_BLOCKED
stillHeld = true
```

没有 detach。

---

## 15. 为什么 target support 本身不从 shape cast 排除

Transfer 只排除 holder Agent。

Table collider 仍参与：

```text
bodyMotionClear
```

所以：

- 横向轨迹切进桌沿 → blocked。
- 下放过深 → blocked。
- 最终 release point 留有 clearance → 可以到达。

这与“把 support object 全部排除，最后把 Cup 塞进桌面”不同。

---

## 16. 真实 Release Blocker E2E

专项场景在 Table 上方放一个 physical blocker。

它不会挡 Agent approach，但会挡：

```text
LIFT / TRAVERSE / LOWER
```

其中一段。

要求：

```text
status = place-blocked
reason = PLACE_TRANSFER_BLOCKED
stillHeld = true
```

并断言：

```text
cup.state.heldBy
仍然 = agent_01

Cup body
仍然 Kinematic
```

证明 failed place 不会半途丢物体。

---

## 17. Detach 后恢复 Dynamic，不立即声称 placed

三段 transfer 全部 clear 后：

```text
releaseHeld(heldId, "PLACE_RELEASE")
```

执行：

```text
clear heldBy
restore original body type
zero carry linvel / angvel
wakeUp
```

Cup 重新变成 Dynamic。

但此时高层 Skill **仍然没有返回**。

因为：

```text
release completed
≠
placement succeeded
```

---

## 18. 为什么 release 时把 carry velocity 清零

Rapier 文档说明 Dynamic body 的 `linvel / angvel` 决定之后的运动；Kinematic body 的速度由 next pose 自动推导。

如果一个被 Agent 快速携带的 Kinematic Cup 直接切回 Dynamic，保留上一帧隐含速度，可能像被“甩出去”。

1.18 在恢复原 body type 时：

```text
linvel = 0
angvel = 0
wakeUp()
```

然后让真实 gravity/contact 决定 settle。

参考：

- https://rapier.rs/docs/user_guides/javascript/rigid_bodies/
- https://rapier.rs/docs/user_guides/javascript/rigid_body_velocity/

---

## 19. Settle 为什么不能只等固定帧数

固定：

```text
wait 60 frames
→ placed
```

没有物理意义。

Rapier Dynamic body 自带：

```text
isSleeping()
linvel()
angvel()
```

1.18 的 settle task 每个 Physics step 之后读取：

```text
sleeping
linearSpeed
angularSpeed
```

默认稳定阈值：

```text
linearSpeed  <= 0.04 m/s
angularSpeed <= 0.12 rad/s
stableDuration = 0.35s
```

如果 Rapier 已 sleeping，也属于 slow/stable。

---

## 20. 为什么还是保留 stable window

某一帧速度很小不代表真正稳定。

所以：

```text
slow this frame
→ stable += dt

moving again
→ stable = 0
```

只有：

```text
stable >= 0.35s
```

才进入 support post-condition。

---

## 21. `bodyMotionState()`

PhysicsSystem 新增只读：

```text
bodyMotionState(id)
```

返回：

```text
sleeping
linearVelocity
angularVelocity
linearSpeed
angularSpeed
```

这不是新的 Physics truth；只是把 Rapier body 当前状态转成 plain data，给 settle verifier 使用。

有直接 Physics test 覆盖。

---

## 22. Timeout 不等于失败，也不等于成功

如果 4 秒内 body 一直没有满足稳定窗口：

```text
status = place-unverified
reason = SETTLE_TIMEOUT
settled = false
supportVerified = false
```

即使此刻几何恰好位于 Table 上：

```text
support.on = true
```

也不能说成功。

直接 unit test 专门要求：

```text
high velocity
+
support geometry true
+
timeout
→ place-unverified
```

避免“看起来在桌上”替代物理稳定验证。

---

## 23. Support post-condition 使用一个事实源

SceneGraph 原来自己实现：

```text
within surface X
within surface Z
gap <= 0.12m
```

如果 Place 再复制一次，会形成两个 support truth。

1.18 把它抽到：

```text
SpatialSystem.supportStatus(
  subjectId,
  targetId,
  surfaceId
)
```

SceneGraph 的：

```text
ON
SUPPORTS
```

也改成调用同一个 `supportStatus`。

Place settle 同样调用它。

所以：

```text
supportVerified = true
```

准确含义是：

> Dynamic body 已稳定，并满足与 SceneGraph `ON/SUPPORTS` 完全同源的确定性 support geometry contract。

不是另一套“近似在桌面上”的判断。

---

## 24. `supportStatus` 返回什么

例如：

```json
{
  "on": true,
  "subjectId": "cup_01",
  "targetId": "table_01",
  "surfaceId": "top",
  "withinX": true,
  "withinZ": true,
  "gap": 0.002,
  "tolerance": 0.12
}
```

如果掉出桌面：

```text
withinX / withinZ = false
```

如果高度不对：

```text
gap > tolerance
```

---

## 25. 真实 Post-condition Failure E2E

专项 fixture 故意制造：

```text
Manifest 声明 top surface y=1.1
但真实 Physics 没有在 release 点下方提供对应支撑
```

同时保留一个 target-owned thin collider 让：

```text
physical LOS
```

仍然成立。

所以流程能真正走到：

```text
release
→ Dynamic
→ fall
→ settle elsewhere
```

最终：

```text
status = place-failed
reason = SUPPORT_NOT_REACHED
supportVerified = false
settled = true
```

这专门证明：

```text
release 成功
≠
place 成功
```

---

## 26. `placed` 的唯一成功语义

只有：

```text
stable window passed
+
supportStatus.on == true
```

返回：

```text
status = placed
supportVerified = true
settled = true
```

ToolCallingAgent Prompt 明确：

> `placed + supportVerified=true` 已经是确定性的 post-condition，不要再做冗余 relation query，除非正在诊断失败。

---

## 27. 为什么不强制再调用 SceneGraph.list()

`supportStatus` 已经是 SceneGraph `ON/SUPPORTS` 的同源 predicate。

如果 Place 结束后再：

```text
sceneGraph.update()
→ list relations
→ 再确认一次
```

只是重复同一个几何规则，并增加一次全图 rebuild/query。

所以高层结果直接带：

```text
supportVerified
support
```

Agent 不需要再查 relations 才能相信同一事实。

---

## 28. 长 Place task 仍是一个 History transaction

`approachAndPlace` 是：

```text
mutates:true
```

SkillRegistry：

```text
runtime.mutate("skill:approachAndPlace")
  ↓
await locomotion
  ↓
await release
  ↓
await settle
  ↓
post-condition
  ↓
commit final snapshot
```

因此整个：

```text
走过去 + 放下 + 等稳定
```

只有一个 History command。

专项 deferred test 要求 settle promise 未完成前，Skill 不能先返回。

---

## 29. 已经发生运动后的失败不能 throw 掉 History

1.18 顺便统一了三个具身高层动作的事务语义。

之前：

```text
Agent 已经走了一段
→ final guard fail
→ throw
→ runtime.mutate cancel history
```

世界位置已经改变，但 History 没记录。

现在规则：

### 没有发生 world movement

Precondition failure：

```text
NO_INTERACTION_POSE
NO_FREE_SURFACE_SPACE
NOT_HOLDING_OBJECT
```

仍然 throw。

### 已经发生 locomotion

返回结构化：

```text
interaction-blocked
pickup-blocked
place-blocked
```

这样 mutation 正常 commit 最终真实位置，用户可以 Undo。

---

## 30. Place blocked / failed / unverified

三个状态不能混：

### `place-blocked`

还没 release，物体仍 held：

```text
APPROACH_FAILED
NO_FREE_SURFACE_SPACE_AFTER_APPROACH
LINE_OF_SIGHT_BLOCKED
OUT_OF_RANGE
RELEASE_OUT_OF_RANGE
PLACE_TRANSFER_BLOCKED
```

通常：

```text
stillHeld = true
```

### `place-failed`

已经 release，并已物理稳定，但 post-condition 不成立：

```text
SUPPORT_NOT_REACHED
```

### `place-unverified`

无法给确定结论：

```text
SETTLE_TIMEOUT
RUNTIME_DISPOSED
OBJECT_REMOVED
```

只有：

```text
placed
```

是成功。

---

## 31. Settle lifecycle ownership

InteractionSystem 只维护一个：

```text
settleTasks: Map<objectId, task>
```

它不是新的 TaskManager。

用途只有：

- 跨帧累计稳定窗口。
- 持有 Promise resolve。
- teardown 时结束 pending。

Runtime dispose 前：

```text
interactions.cancelPending("RUNTIME_DISPOSED")
```

对象 remove 时：

```text
beforeRemove(id)
→ finish pending place as place-unverified / OBJECT_REMOVED
```

不会留下永不 resolve 的 Skill mutation。

---

## 32. 为什么 InteractionSystem.update 在 Physics.step 后

WorldRuntime 当前：

```text
locomotion.update(dt)
→ physics.step(dt)
→ interactions.update(dt)
```

所以 settle 每帧读取的是：

```text
刚完成当前 Physics step 的 Rapier body state
```

不是上一个 frame 的 stale velocity。

这个 update order 正好满足 settle observation，不需要新 scheduler。

---

## 33. WorldValidator 也要认识 Agent-held

旧 Validator 的 floating exemption：

```text
interactions.heldId !== object.id
```

只认识 Human-held 全局 ID。

1.17 已把真实 ownership 移到：

```text
record.state.heldBy
```

所以 1.18 修成：

```text
interactions.isHeld(object.id)
```

Agent 手里的 Cup 不会被错误报：

```text
G_FLOATING
```

专项 Validator test 已覆盖。

---

## 34. Real model Tool contract

Agent-facing：

```text
approachAndPlace(
  actorId,
  supportId,
  surfaceId?,
  speed?
)
```

不暴露：

```text
heldId
clearance
settle timeout
velocity thresholds
```

这些属于 Runtime policy，不让 LLM 临时调大/调小来“提高成功率”。

---

## 35. Local fallback 也使用具身 Place

本地模式：

```text
“把杯子放到桌上”
```

现在：

```text
approachAndPlace(
  actorId=agent_01,
  supportId=table_01
)
```

不再调用低层 scene `place`。

`建立咖啡角` 仍然是 scene-layout intent，所以其内部低层 `place` 保留；它不是“Agent 拿杯子去摆桌”的具身任务。

---

## 36. Pages 快捷入口

1.18 新增：

```text
把手中物体放到桌上
```

对应自然语言：

```text
让 agent_01 把当前拿着的物体放到 table_01 上
```

和现有：

```text
走过去拿起杯子
放下手中物体
```

形成可直接演示的：

```text
pickup → carry → place
```

---

## 37. 真实 Nemotron / Muse Place Probe

运行：

```bash
npm run agent:probe -- place
```

Probe world 表示：

```text
agent_01 已经持有 cup_01
```

这份 ownership 不塞进 `listObjects`，因为真实 Runtime `listObjects()` 也不暴露 `heldBy`。

模型如果需要，可调用：

```text
getCarryStatus(agent_01)
```

Probe 明确拒绝：

```text
low-level place
```

成功条件：

```text
approachAndPlace
```

Nemotron 当前：

```text
2 planning steps
first tool = approachAndPlace
```

Muse 在把 Schema 从 `targetId` 改成 `supportId` 后同样：

```text
2 planning steps
first tool = approachAndPlace
```

两者最终都只在：

```text
status=placed
supportVerified=true
settled=true
```

后宣布成功。

---

## 38. 当前仍不是完整机器人 Place

1.18 仍然没有：

```text
arm IK
end-effector trajectory
finger release timing
contact wrench
orientation optimization
rotational shape sweep
regrasp
compliance
```

三段：

```text
lift / traverse / lower
```

是 collision-checked kinematic transfer，不是机械臂 motion planning。

所以 AgentScape 当前 claim 是：

> 简单 held object 可以通过确定性、碰撞检查过的 release trajectory 被放到一个 support surface，并在 Dynamic settle 后验证支撑 post-condition。

不是：

> 已实现通用 robotic manipulation。

---

## 39. 当前简单 Shape 限制仍继承 1.17

Agent carry / place 仍限定：

```text
simple non-articulated Dynamic root
cylinder / capsule colliders
no pitch/roll carry rotation
```

这是因为当前 `bodyMotionClear` 是 linear shape cast。

一般 Box + orientation change 需要 rotational sweep / 更完整 manipulation planner。

1.18 不扩大 unsupported surface。

---

## 40. 当前最小完整 Manipulation Baseline

现在终于有：

```text
User / LLM
   ↓
approachAndPickup
   ↓
interaction pose
   ↓
pickup transfer shape cast
   ↓
heldBy ownership
   ↓
carry locomotion clearance
   ↓
approachAndPlace
   ↓
carry-aware interaction pose
   ↓
lift / traverse / lower shape casts
   ↓
detach to Dynamic
   ↓
Rapier settle
   ↓
supportStatus
   ↓
placed + supportVerified
```

这不是完整 Grasp/Manipulation，但它是 AgentScape 第一个真正从：

```text
pickup
→ carry
→ place
```

全部经过 Runtime / Physics / deterministic post-condition 的纵向闭环。

## 41. 1.20：完整任务暴露了 Arrival Yaw 与 Release Reach

单独 Place 测试常让 Agent 已经面向 Table，但真实 `open → pickup → place` 任务中，Agent 到达 interaction pose 后的 yaw 来自最后一个 locomotion waypoint。1.20 因此让 Place candidate 额外验证“如果 Agent 在该候选处朝向 release，预测 HoldAnchor 到 release 是否仍在固定交互距离减 waypoint tolerance 内”。到达后再用 `reorientHeldToward` 分段旋转，每一步都调用 `bodyMotionClear` 检查 held-object 圆弧占用；遇阻恢复原 yaw / held pose 并返回 `CARRY_REORIENT_BLOCKED`。这不是机械臂 IK，只是把 carried-object occupancy truth 延伸到原地转向。详见 [`verified-task-sequencing.md`](./verified-task-sequencing.md)。
