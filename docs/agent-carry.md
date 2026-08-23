# Agent Carry：Hold Anchor、Ownership 与携带碰撞

AgentScape 1.17 第一次把 `pickup` 从 Human Camera 语义中拆出来，建立一个明确的 Agent carry contract。

它完成的是：

```text
approach target
→ range / Rapier LOS
→ transfer sweep to hold anchor
→ durable heldBy ownership
→ kinematic-anchor attachment
→ carried-object locomotion clearance
→ drop restores original body type
```

它**不是**机器人夹爪力学验证。

所以成功结果明确：

```text
status = held
attachment = kinematic-anchor
graspVerified = false
```

---

## 1. 为什么不能直接复用旧 `pickup()`

旧 Human/Editor pickup 的目标是：

```text
camera.position
+
camera.forward * 1.6
```

如果 Agent 直接调用它，会出现：

```text
Agent 走到 Cup
→ pickup
→ Cup 飞到 Human Camera 前
```

这不是具身抓取。

因此 1.17 保留旧低层：

```text
pickup / drop / place
```

作为 Human / scene primitive，同时新增：

```text
approachAndPickup
dropHeld
getCarryStatus
```

Agent Prompt 明确要求具身任务使用新工具。

---

## 2. Hold Anchor 是 Asset contract

Builtin Agent Manifest 现在声明：

```json
{
  "embodiment": {
    "holdAnchor": {
      "translation": [0, 0.95, -0.62],
      "rotation": [0, 0, 0, 1]
    }
  }
}
```

它与 Agent foot-root 同一局部 frame。

视觉 Asset 里也有：

```text
HoldAnchor
```

但物理计算不依赖 visual Node；Runtime 使用 Manifest anchor + Rapier Agent body pose 计算世界 anchor。

这样空 visual Group 的测试 Agent 仍然可以正确 carry。

Schema 会验证 hold anchor translation / quaternion 的有限性。

---

## 3. `heldBy` 才是 durable ownership

被持有对象的 state：

```json
{
  "heldBy": {
    "kind": "agent",
    "id": "agent_01",
    "anchor": "hold"
  }
}
```

Human held：

```json
{
  "heldBy": {
    "kind": "human"
  }
}
```

没有同时在 Agent state 再写一份：

```text
agent.state.holding = cup_01
```

避免双向 durable truth。

`InteractionSystem.agentHeld` 只是运行时派生索引，用于快速更新；Scene restore 会从 `record.state.heldBy` 重建。

---

## 4. Scene persistence

SceneSerializer 本来就保存：

```text
record.state
```

所以 `heldBy` 不需要升级 Scene schemaVersion。

但 1.17 增加 preflight：

```text
heldBy.kind 必须是 human | agent
agent owner 必须存在于 scene.objects
同一个 Agent 最多持有一个对象
Human 最多持有一个对象
```

这些检查在 destructive restore 前完成。

所有对象恢复并 attach Physics 后：

```text
InteractionSystem.rebuildHeldOwnership()
```

重新：

```text
heldBy
→ kinematic body
→ Agent hold anchor pose
```

所以 restore 顺序不会决定最终 attachment。

---

## 5. 删除 holder 时的 lifecycle

如果：

```text
remove(agent_01)
```

但 Cup 仍 `heldBy agent_01`，不能留下孤儿 kinematic body。

WorldRuntime.remove 在 Physics teardown 前调用：

```text
InteractionSystem.beforeRemove(id)
```

如果被删对象是 holder：

```text
release carried object
→ clear heldBy
→ restore original body type
```

如果被删对象本身正在 held：同样先 release ownership 再移除。

---

## 6. Physics body type 不再硬编码恢复 Dynamic

旧 `setHeld(false)` 总是假设：

```text
held object 原来一定是 Dynamic
```

1.17 改成：

```text
pickup
→ save heldOriginalType
→ KinematicPositionBased

drop
→ restore heldOriginalType
```

所以 attachment lifecycle 不会偷偷重写原资产 physics contract。

当前 Agent carry eligibility 仍要求目标原本是 `dynamic`；保存原 type 是为了 Physics primitive 本身保持正确、以后不埋坑。

---

## 7. 为什么当前只支持简单 Root-body carry

1.17 fail closed：

```text
Target must:
- support pickup + drop
- physics.body = dynamic
- have no articulated parts
- have root colliders
- collider shape currently cylinder or capsule
```

复杂 articulated object 如果直接只把 root 改成 kinematic，会破坏 Part/joint ownership。

因此：

```text
ARTICULATED_TARGET_UNSUPPORTED
```

不是“尽量抓一下看看”。

---

## 8. 为什么当前 collider 只支持 Cylinder / Capsule

Pickup transfer 与 carry clearance 使用 Rapier linear shape cast。

当前 Agent movement 只有 yaw rotation，builtin hold anchor 也不倾斜。

Cylinder / Capsule 绕 Y 轴旋转保持碰撞几何不变，因此 linear cast 能准确表达当前 Cup carry。

如果：

```text
hold anchor 有 pitch/roll
```

返回：

```text
HOLD_ANCHOR_ROTATION_UNSUPPORTED
```

如果 collider 自己有非 yaw rotation：

```text
CARRY_COLLIDER_ROTATION_UNSUPPORTED
```

Box 等一般刚体需要 rotational sweep 才能严谨支持；1.17 不假装已经完成。

---

## 9. Pickup 先找真实 interaction pose

`approachAndPickup(actorId,targetId)` 复用 1.16：

```text
findInteractionPose
→ Detour reachable
→ fixed 1.5m range
→ Rapier line-of-sight
```

如果需要：

```text
LocomotionSystem.navigate
```

到达后再次检查 current range / LOS。

所以 Agent 不能隔墙“吸”Cup。

---

## 10. Pickup transfer 不能 teleport 穿物体

即使 Agent 已经在交互距离内：

```text
Cup current pose
→ HoldAnchor pose
```

仍是一段空间运动。

PhysicsSystem 使用：

```text
World.castShape
```

对每个 supported root collider 做完整 shape sweep。

Rapier 官方把 shape cast 定义为完整 shape 沿直线运动并返回第一个 time-of-impact；这正是这里需要的确定性工具。

同时在 target anchor pose 再做：

```text
intersectionsWithShape
```

所以：

```text
路径 blocked
→ CARRY_SWEEP_BLOCKED

终点 occupied
→ CARRY_TARGET_BLOCKED
```

高层统一：

```text
PICKUP_TRANSFER_BLOCKED
```

只有 transfer clear 后才写 `heldBy` 和切 Kinematic。

---

## 11. Holder-self collision

Held Cup 的 collider 不能被 Agent CharacterController 当成“前方障碍”，否则 Agent 会被自己的手中物卡住。

Rapier CharacterController 支持 `filterPredicate` 排除 query collider。

Locomotion 每帧从 durable state 派生：

```text
heldBy.kind = agent
heldBy.id = current agent
```

并把这些 carried object ids 传给：

```text
PhysicsSystem.moveCharacter(..., { ignoreIds })
```

只忽略 holder-self pair。

不是关闭 Cup 的所有碰撞。

---

## 12. Carried object 仍不能穿墙

忽略 holder-self collision 后，如果什么都不补，会导致：

```text
Agent capsule 能过
Cup 也被 anchor 强推过去
```

所以每个 locomotion frame：

```text
1. KCC 计算 Agent corrected movement
2. 读取 Agent nextTranslation / nextRotation
3. 计算 next hold anchor pose
4. 对 carried object 从当前 pose → next anchor 做 bodyMotionClear
5. clear 才同时 setNextKinematicTranslation
```

如果 Cup 会先撞墙：

```text
cancelCharacterMovement(agent)
→ Agent next pose 回滚到 current
→ Cup 保持 current safe pose
→ locomotion status = blocked
→ reason = CARRIED_OBJECT_BLOCKED
```

这避免：

```text
Agent 过去了，Cup 留下
```

或：

```text
Cup 穿墙
```

---

## 13. 真实 Carry Blocked E2E

测试故意让 Recast 只知道 floor，但 Rapier 额外有一堵墙。

Agent：

```text
capsule radius = 0.32m
```

Cup 在身体前：

```text
hold offset z = -0.62m
cup radius = 0.15m
```

因此 Cup 会比 Agent body 更早碰墙。

结果必须：

```text
status = blocked
reason = CARRIED_OBJECT_BLOCKED
carry.id = cup_01
```

并且 Agent 停在墙前较远位置。

这个测试证明 carry clearance 不是注释里的未来计划，而是真正进入执行层。

---

## 14. Held object 不再是独立 Nav obstacle

PhysicsSystem 的 current-world navigation snapshot 原来会看到所有 Dynamic/Kinematic object。

如果 held Cup 仍进入 TileCache：

```text
Cup 在 Agent 前方
→ Navigation 把自己手里的物体 carve 成世界 obstacle
→ 可能干扰 start polygon
```

1.17 的 `setHeld(true)` 标记 transient：

```text
entry.held = true
```

`navigationObstacles()` 跳过 held root。

这不是忽略占用：

```text
carried-object clearance
```

已经由 Locomotion 每帧负责。

Drop 后：

```text
entry.held = false
→ Dynamic obstacle snapshot 恢复
```

专项 E2E 同时断言这两个状态。

---

## 15. `approachAndPickup`

Agent-facing Skill：

```text
approachAndPickup(
  actorId,
  targetId,
  speed?
)
```

整个链处于一个：

```text
runtime.mutate('skill:approachAndPickup')
```

里面直接调用 LocomotionSystem，不嵌套 `navigateTo` Skill。

因此：

```text
走过去
+
pickup transfer
+
heldBy write
```

仍然是一个 History command。

---

## 16. `dropHeld`

```text
dropHeld(actorId)
```

查派生 Agent-held index：

```text
agent_01 → cup_01
```

然后：

```text
clear heldBy
restore body type
wakeUp
```

对象从当前 hold anchor 位置开始重新受 Dynamic Physics。

当前 `dropHeld` 是“释放”，不是“精确放置到桌面”。

---

## 17. `getCarryStatus`

只读 Skill：

```json
{
  "status": "held",
  "actorId": "agent_01",
  "targetId": "cup_01",
  "attachment": "kinematic-anchor",
  "graspVerified": false
}
```

没有对象时：

```json
{
  "status": "empty",
  "actorId": "agent_01"
}
```

真实 LLM probe 会在 pickup 后调用它确认 ownership。

---

## 18. 为什么不叫 Grasp Verified

当前没有：

```text
gripper fingers
contact force
force closure
friction cone
IK
wrench resistance
```

因此不能声称：

```text
graspVerified = true
```

Isaac Sim 的 Grasp Editor 也区分“通过物理模拟建立接触置信度”和“跳过模拟只 author grasp”。AgentScape 同样保持 provenance：1.17 证明的是 attachment/carry ownership，不是机器人手指抓持质量。

---

## 19. Human pickup 保留，但不再是 Agent tool choice

低层：

```text
pickup
drop
place
```

仍然需要服务：

```text
Human UI
World pipeline
scene-level deterministic editing
```

所以没有删除。

但 Skill description 明确：

```text
pickup = Human/scene primitive
approachAndPickup = embodied Agent primitive
```

ToolCallingAgent system prompt 也重复这个边界。

---

## 20. Local fallback 同样升级

本地无 LLM 模式：

```text
“拿起杯子”
→ approachAndPickup(agent_01,cup_01)

“放下杯子”
→ dropHeld(agent_01)
```

不再绕回 Human Camera pickup。

`“把杯子放到桌上”` 暂时仍走低层 scene `place`，因为真正 Agent-held place 还没有完成。

---

## 21. Pages 快捷入口

1.17 把 1.16 暂时移除的 pickup UI 重新加入，但文案现在明确具身：

```text
走过去拿起杯子
放下手中物体
```

它们对应已经存在的真实 Agent carry contract，不再暗示不存在的能力。

---

## 22. 当前真实模型 Probe

```bash
npm run agent:probe -- pickup
```

Probe 明确禁止：

```text
low-level pickup
```

成功条件：

```text
approachAndPickup
```

当前两个真实模型都已通过：

```text
Nemotron
→ approachAndPickup
→ getCarryStatus
→ final

Muse
→ approachAndPickup
→ getCarryStatus
→ final
```

Muse 最终回答明确包含：

```text
graspVerified: false
```

说明 tool contract 的 provenance 能被真实 Agent 理解。

---

## 23. 当前仍不做 Agent-held Place

1.17 还不能把：

```text
“把手里的杯子放到 table_01 上”
```

宣称为具身完成。

真正 place 还需要：

```text
held object 当前 shape
→ target surface
→ Agent 可站立 release pose
→ carried-object path clearance
→ release pose occupancy
→ detach
→ Dynamic settle
→ support relation verification
```

旧 `place()` 仍是 scene-level deterministic placement。

下一阶段 P0 就是这条链。

---

## 24. 当前完成的最小闭环

```text
User / LLM
   ↓
approachAndPickup
   ↓
interaction pose
   ↓
Agent locomotion
   ↓
range / Rapier LOS
   ↓
shape cast to hold anchor
   ↓
heldBy durable ownership
   ↓
kinematic-anchor attachment
   ↓
carried-object clearance each locomotion frame
   ↓
getCarryStatus
   ↓
dropHeld
   ↓
restore Dynamic Physics
```

这让 AgentScape 从：

```text
“Agent 会走到目标并请求开门”
```

推进到：

```text
“Agent 能拥有并安全携带一个简单物体”
```

同时仍然没有把 attachment 冒充完整机器人 grasp/manipulation。
