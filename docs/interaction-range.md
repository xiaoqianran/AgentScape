# Embodied Interaction：交互距离、物理视线与动作扫掠

AgentScape 1.16 把：

```text
open(cabinet)
```

第一次升级成真正的具身任务：

```text
找到目标
  ↓
找到可达交互位
  ↓
真实走过去
  ↓
确认距离
  ↓
确认 Rapier 物理视线
  ↓
确认 Agent 不会挡住 articulation sweep
  ↓
请求 open / close motor target
```

核心不是多一个高层工具，而是建立四种不能混为一谈的事实：

```text
NAVIGABLE
    ≠
IN RANGE
    ≠
VISIBLE
    ≠
ACTION CLEAR
```

只有四项同时成立，Agent 才能请求具身 `open / close`。

---

## 1. 成熟具身系统给出的边界

AI2-THOR 的交互语义不是“只要知道 objectId 就可以远程操作”。它把 interactability 与 Agent 距离、可见性和遮挡联系起来；默认 `visibilityDistance` 是 1.5m，并提供 `GetInteractablePoses` 查询哪些 Agent pose 能与目标对象交互。

参考：

- https://ai2thor.allenai.org/ithor/documentation/concepts/
- https://ai2thor.allenai.org/ithor/documentation/objects/domain-randomization/#getinteractableposes
- https://ai2thor.allenai.org/ithor/documentation/object-state-changes/

另一个重要经验是：

```text
OpenObject request accepted
≠
door guaranteed fully opened
```

门可能在运动中碰到别的物体。

AgentScape 沿用这个原则，但不复制 AI2-THOR 的离散 pose/grid 搜索。我们已经有连续 Detour + Rapier，所以交互位由当前世界自己的导航和物理系统验证。

---

## 2. 为什么不能只看距离

最简单的实现可能是：

```text
distance(agent, cabinet) < 1.5m
→ allow open
```

这会允许：

```text
Agent  | WALL | Cabinet
```

隔墙开门。

因此 1.16 的 interaction truth 至少要求：

```text
range
+
physical line-of-sight
```

而不是视觉 Mesh raycast。

---

## 3. 固定 1.5m，而不是让模型自己传距离

Runtime 现在有唯一默认值：

```js
DEFAULT_INTERACTION_DISTANCE = 1.5
```

内部方法仍接受 `maxDistance`，方便：

- Runtime 测试。
- 将来由 Policy / Agent embodiment profile 决定。
- 非 Agent 调试工具。

但是 Agent-facing Skill schema **不暴露 `maxDistance`**。

也就是说 LLM 不能：

```text
approachAndInteract(..., maxDistance=10)
```

把具身约束偷偷变成 `forceAction`。

这个设计来自一次真实模型 probe：Nemotron 曾主动传 `maxDistance=3`。如果参数继续暴露，模型会天然倾向扩大成功边界。

因此当前策略是：

> interaction range 是 Runtime policy，不是模型参数。

---

## 4. 距离怎么计算

不是：

```text
agent root → target center
```

而是 Agent 脚底 XZ 位置到 target world AABB 的水平距离。

如果 Agent 已经位于 target AABB 的某一轴投影范围内，该轴距离就是 0。

因此一个宽柜子不会因为中心离 Agent 很远而误判不可交互。

当前：

```text
vertical reach
```

还没有单独建模成手臂长度；1.16 只建立 locomotion-level proximity。

这也是为什么 pickup/grasp 暂不进入这一版。

---

## 5. 物理视线使用 Rapier，不使用 Three.js Mesh

已有 `SpatialSystem.raycast()` 是视觉/场景查询能力。

1.16 没有拿它冒充交互遮挡。

新增：

```text
PhysicsSystem.raycast(origin, target, { excludeId })
```

它直接调用 Rapier World query：

```text
Rapier Ray
  ↓
world.castRay()
  ↓
first physical collider
```

因此：

- Environment fixed collider 会挡住视线。
- 普通 Object collider 会挡住视线。
- articulated Part collider 会挡住视线。
- Agent 自己的 root rigid body 会从 query 排除。

返回：

```text
id
part
environment
distance
point
```

如果 first hit 的 `id === targetId`：

```text
visible = true
```

否则：

```text
visible = false
```

---

## 6. 当前 LOS 的确定性限制

当前 eye point：

```text
actor foot position + eyeHeight
```

Agent capsule 高约 1.70m，eyeHeight 取 body bounds 的约 82%。

当前 aim point：

```text
target world bounds center
```

这很保守，但非常确定。

1.16 **没有**实现：

- Camera FOV。
- 多个 visible sample points。
- Door handle 视觉点。
- Semantic gaze target。
- 头部/眼睛 articulation。

所以当前 `visible` 的准确含义是：

> Agent eye 到 target AABB center 的 Rapier 物理射线，第一命中属于 target。

不要把它描述成完整视觉感知。

---

## 7. `findInteractionPose`

新只读 Skill：

```text
findInteractionPose(
  actorId,
  targetId,
  action?,
  partName?
)
```

它不移动 Agent。

用途是：

- 调试为什么无法交互。
- 可视化 candidate pose。
- 未来任务规划诊断。

如果任务本身就是：

```text
“走到柜子前打开门”
```

Agent 不应该手动执行：

```text
findInteractionPose
→ navigateTo
→ open
```

应该直接使用：

```text
approachAndInteract
```

因为后者还会做**实际到达后的二次验证**。

---

## 8. 交互候选怎么产生

当前不是无限连续搜索。

Target world AABB 周围产生 8 个确定候选：

```text
        NW       N       NE

        W      TARGET     E

        SW       S       SE
```

偏移量：

```text
Agent capsule radius
+
clearance
```

默认：

```text
radius    ≈ 0.32m
clearance = 0.12m
```

每个候选都交给：

```text
NavigationSystem.findPath(current, candidate)
```

只接受：

```text
reachable = true
```

并使用 Detour 最终：

```text
route.end.snapped
```

而不是原始猜测坐标。

---

## 9. 为什么候选还要重新检查 range / LOS

Recast snap 后的位置可能与原候选有差异。

所以每个候选流程是：

```text
raw candidate
     ↓
findPath
     ↓
Detour snapped end
     ↓
interactionStatusAt(snapped end)
     ↓
range + Rapier LOS
```

不是：

```text
候选满足几何距离
→ 默认 snapped position 也满足
```

---

## 10. 第一次真实失败：Agent 自己挡住了柜门

第一版实现只有：

```text
reachable
+
in range
+
LOS
```

真实 E2E 找到的最短候选在柜门正前方：

```text
Agent
  ↓
[front of door]
  ↓
Cabinet
```

结果：

```text
range      PASS
LOS        PASS
navigate   PASS
```

但真正请求 `open` 后：

```text
Door rotation ≈ 0.32 rad
```

就停住。

Rapier penetration 证明：

```text
Door collider
→ Agent capsule
```

发生接触。

这说明：

> “Agent 能站在那里交互”不等于“Agent 站在那里不会妨碍被操作物体的动作”。

这个失败直接催生了 1.16 的第四层：

```text
ACTION CLEAR
```

---

## 11. Action Swept Bounds

对于 `open / close`，InteractionSystem 现在可以计算：

```text
actionSweepBounds(targetId, action, partName)
```

它不是第二个 Physics simulator。

它是一个**确定性的保守几何排除区**。

流程：

```text
Part rest pose
+
Joint axis
+
current coordinate
+
action target
      ↓
固定采样 9 个 joint coordinates
      ↓
临时修改 Three Part local transform
      ↓
Box3.setFromObject(part node)
      ↓
union
      ↓
swept AABB
      ↓
恢复原始 transform
```

整个过程：

- 不修改 Rapier。
- 不修改 Object state。
- 不写 History。
- 不发 motor target。
- 不持久化候选姿态。

---

## 12. 为什么需要稳定 Rest Pose

PhysicsSystem 原来只有：

```text
lastLocalPosition
lastLocalRotation
```

它们会随每个 physics step 更新。

Action sweep 需要：

```text
joint coordinate = 0
```

对应的稳定参考。

所以 Part attach 时现在额外保留：

```text
restLocalPosition
restLocalRotation
```

并通过：

```text
getPartRestPose(id, partName)
```

只读暴露给 interaction geometry。

这个 Rest Pose 不是新的 world transform truth；它是 joint-coordinate 参考系数据。

---

## 13. Prismatic Sweep

对于 prismatic joint：

```text
coordinate
=
(node.position - restPosition) · axis
```

采样：

```text
currentCoordinate
→ target
```

每步：

```text
position = restPosition + axis * coordinate
rotation = restRotation
```

真实测试构造了一个 Drawer：

```text
closed z = 0
open target = 1m
```

要求 sweep Z 长度 > 1.8m，并验证：

```text
Agent 站在抽屉正前方
→ intersects sweep

Agent 站在侧面
→ clear
```

因此这不是 Cabinet Door 特判。

---

## 14. Revolute Sweep

对于当前支持的 revolute joint：

```text
coordinate
=
wrapped angle(restRotation → currentRotation, joint axis)
```

1.16 专门补了“部分打开 → close”的回归，避免只从零姿态测试 open。

采样：

```text
current angle
→ target angle
```

然后：

```text
rotation = axisAngle(coordinate) * restRotation
```

---

## 15. Revolute 为什么对 non-zero childAnchor fail closed

一般 revolute joint 如果：

```text
childAnchor != [0,0,0]
```

单纯绕 node origin 旋转不一定等价于真正 joint frame 的运动。

1.16 不猜。

这类 Part：

```text
checked = false
reason = REVOLUTE_CHILD_ANCHOR_UNSUPPORTED
```

然后：

```text
findInteractionPose(action=...)
→ ACTION_SWEEP_UNAVAILABLE
```

不能以“没算出来”为理由跳过安全约束。

这是 fail closed。

---

## 16. Joint Axis 不能默认等于 Node Local Axis

Manifest joint axis 属于 articulated parent body / link frame。

Three Part node 可能有不同的实际 parent hierarchy。

所以 sweep 先把 axis：

```text
joint parent world frame
→ world axis
→ actual node.parent local frame
```

再做局部 transform。

这沿用了 AgentScape 从 JointFramePass 开始一直坚持的原则：

> Source frame / Runtime frame / actual Three hierarchy 不能混为一谈。

---

## 17. Agent 占用为什么来自 Physics Manifest

第一次测试中的 Agent visual 是一个空 `THREE.Group`。

如果 interaction sweep 用：

```text
Box3.setFromObject(agent visual)
```

会得到退化 bounds。

但是 Agent 的真实身体一直存在于：

```text
Manifest capsule collider
```

所以：

```text
actorBoxAt(candidatePose)
```

现在优先直接使用：

```text
capsule radius
capsule halfHeight
capsule local translation
```

生成 physical conservative AABB。

这再次保持：

```text
Physics truth
>
visual proxy
```

Fallback 只有在没有 capsule contract 时才使用 visual bounds。

---

## 18. Candidate Pose 的 Action Sweep 检查

如果调用：

```text
findInteractionPose(
  actorId,
  targetId,
  action='open'
)
```

每个 Detour candidate 还必须：

```text
Agent physical AABB at candidate
        ∩
Action swept AABB
        =
empty
```

否则 candidate 被丢弃。

结果里明确记录：

```json
{
  "actionSweep": {
    "checked": true,
    "clear": true,
    "partName": "door"
  }
}
```

---

## 19. 为什么到达后还要检查第二次

规划出来的 pose 不是最终 body pose。

Locomotion 有：

- waypoint tolerance。
- CharacterController collision correction。
- snap-to-ground。
- autostep。

所以：

```text
planned interaction pose
≠
actual Rapier arrival pose
```

`approachAndInteract` 在 `navigateTo` 返回 `arrived` 后重新执行：

```text
current range
current Rapier LOS
current action sweep clearance
```

如果实际 Agent 位置漂进 sweep：

```text
INTERACTION_UNAVAILABLE
reason = AGENT_BLOCKS_ACTION_SWEEP
```

并且：

```text
motor target 不会下发
```

专项测试会故意把 Agent 在“到达”时放回柜门正前方，要求 Cabinet state 仍保持 `close`。

---

## 20. `approachAndInteract`

Agent-facing 高层 Skill：

```text
approachAndInteract(
  actorId,
  targetId,
  action: open | close,
  partName?,
  speed?
)
```

它内部完成：

```text
findInteractionPose
      ↓
LocomotionSystem.navigate
      ↓
actual arrival
      ↓
range recheck
      ↓
Rapier LOS recheck
      ↓
action sweep recheck
      ↓
face target
      ↓
setArticulationAction
```

这是一个 `mutates:true` Skill。

因此整个：

```text
走过去
+
请求开门
```

仍然只有**一个 `runtime.mutate()` / 一个 History transaction**。

没有嵌套调用 `navigateTo` Skill；内部直接复用 LocomotionSystem。

---

## 21. 为什么不让模型自己拼三个 Tool

如果模型手工：

```text
findInteractionPose
→ navigateTo
→ open
```

它会绕过：

```text
actual arrival pose action-sweep recheck
```

并且三个 Skill 是三个 mutation ownership 边界。

所以 Agent Prompt / Skill descriptions 都明确：

```text
正常 embodied open/close
→ 直接 approachAndInteract
```

只有高层工具失败、需要诊断时才单独调用 `findInteractionPose`。

---

## 22. `interaction-requested` 不等于 Door 已 settled

底层：

```text
setArticulationAction
```

做的是：

```text
Rapier motor target request
```

所以现在返回：

```json
{
  "requested": true
}
```

高层返回：

```text
status = interaction-requested
```

而不是：

```text
opened
closed
settled
verified
```

因为动作后仍可能有：

- 外部物体进入扫掠区。
- Motor stall。
- Joint 未完全收敛。
- 动态碰撞。

真实 E2E 在请求后继续跑 240 个 Rapier steps，并要求 Door rotation > 0.5 rad；这证明动作确实发生，但 Runtime API 仍不会把“运动发生”冒充“最终 settled”。

---

## 23. 为什么当前没有 `getJointSettledState`

当前 Rapier 0.17.3 contract 没有被 AgentScape 用作稳定的公开 current-joint-coordinate API。

ArticulationVerifier 可以通过 Three node transform / reference frame 做离线/隔离验证，但 live Agent observation 还没有正式的：

```text
joint target reached?
settled?
blocked?
```

Skill。

因此真实 LLM probe 后的正确回答是：

> Agent 已到达合法交互位，并已发出 open motor request；当前工具结果不保证关节已经完全 settled。

Prompt 明确禁止模型在没有 dedicated observation tool 时反复 `listObjects` 假装验证最终关节状态。

---

## 24. 真实模型 Probe

本地测试 Gateway 支持：

```bash
npm run agent:probe -- interaction
```

目标：

```text
Walk agent_01 to cabinet_01 and open its door.
Do not open it remotely; use the embodied interaction abstraction.
```

Probe 会拒绝低层：

```text
open(cabinet_01)
```

如果模型试图远程开门，测试失败。

当前 Nemotron 和 Muse 都已经在真实 upstream 上成功选择：

```text
approachAndInteract
```

并且能正确解释：

```text
interaction-requested
≠
settled
```

这是 behavioral smoke，不是模型能力的确定性 benchmark；模型可能在某次 run 先尝试不合适的 pure `navigateTo`，但 Runtime/Probe 会拒绝错误路径，并要求最终使用高层具身工具。

详细本地模型配置见 [`test-agent.md`](./test-agent.md)。

---

## 25. Local fallback 也不能绕过

没有外部 LLM 时，`LocalPlannerGateway` 以前：

```text
“打开柜子”
→ open(cabinet_01)
```

1.16 改为：

```text
“打开柜子”
→ approachAndInteract(
    actorId=agent_01,
    targetId=cabinet_01,
    action=open
  )
```

所以本地 demo 和真实 LLM 走同一具身动作边界。

---

## 26. Pages 示例也改成具身措辞

快捷按钮不再只是：

```text
打开柜子
关闭柜子
```

现在是：

```text
走过去打开柜门
走过去关闭柜门
```

输入 placeholder 同样使用：

```text
让 agent_01 走到 cabinet_01 前并打开柜门
```

这不是文案装饰，而是让 UI 与 Runtime capability 对齐。

---

## 27. 为什么这轮不做 Pickup / Place

现有：

```text
InteractionSystem.pickup()
```

是 Human/Editor 语义。

Held object 的 target 仍然来自：

```text
camera.position
+
camera.forward * 1.6
```

也就是说：

```text
Agent 走到 Cup 前
→ pickup()
```

如果直接复用，Cup 会飞到**Human Camera** 前方，而不是 Agent 手上。

所以 1.16 明确不把 pickup/place 宣称成 embodied task。

底层原语保留，因为：

- Human 操作需要。
- Scene pipeline 需要。
- Existing placement contract 仍正确。

但是 Pages Agent 快捷按钮移除了：

```text
拿起杯子
放到桌上
```

下一阶段必须先有：

```text
Agent hold anchor
grasp / hand ownership
interaction pose for pickup
held-object collision policy
```

再接具身 pickup/place。

---

## 28. 当前不做完整 Manipulation Planner

1.16 没有新增：

```text
TaskManager
InteractionPlanner
ReachabilityManager
GraspManager
BehaviorTree
```

当前责任仍然非常直接：

```text
NavigationSystem
→ path truth

LocomotionSystem
→ path execution

PhysicsSystem
→ LOS / body / articulation truth

InteractionSystem
→ interaction pose + action preconditions

SkillRegistry
→ Agent-facing capability boundary
```

---

## 29. 当前限制

1.16 还没有：

```text
full FOV visibility
semantic handle points
multiple LOS sample points
arm reach / IK
grasp pose
Agent hand anchor
live joint-settled observation
external-object action sweep prediction
multi-agent interaction occupancy
interaction pose learning
```

Action swept AABB 目前只保证：

> Agent 自己不会站在目标 Part 的保守运动排除区里。

它不代表整个未来世界在动作轨迹上都没有动态障碍；真正执行仍由 Rapier 决定。

---

## 30. 1.16 的最小闭环

最终完整链：

```text
User / LLM
   │
   ▼
approachAndInteract
   │
   ├─ target supports action?
   │
   ├─ action sweep computable?
   │
   ▼
findInteractionPose
   │
   ├─ 8 candidate poses
   ├─ Detour reachable
   ├─ fixed 1.5m range
   ├─ Rapier LOS
   └─ Agent outside action sweep
   │
   ▼
LocomotionSystem.navigate
   │
   ▼
Rapier CharacterController
   │
   ▼
actual arrival pose
   │
   ├─ range recheck
   ├─ LOS recheck
   └─ action sweep recheck
   │
   ▼
Rapier motor target request
   │
   ▼
interaction-requested
```

这一步把 AgentScape 从：

```text
“Agent 能走”
```

推进到：

```text
“Agent 必须先以物理上合理的位置接近目标，才能请求交互”
```

而没有假装已经完成机器人手部 Manipulation。

## 31. 1.17：同一 Interaction Pose 基线进入 Pickup

`approachAndPickup` 复用 1.16 的 Detour reachable + fixed 1.5m range + Rapier LOS，但没有 action swept AABB；取而代之的是目标对象当前 pose 到 Agent hold anchor 的 Rapier shape cast。这样 open/close 与 pickup 共享“先走到真正可交互位置”的事实层，而不共享错误的动作几何假设。详见 [`agent-carry.md`](./agent-carry.md)。

## 32. 1.18：Interaction Pose 需要区分 Actor Envelope 与 Carry Envelope

Place E2E 证明普通 Agent capsule stand-off 不足以承载手中物：Cup 会在 Agent 到达 Table pose 前先撞桌沿。1.18 因此让 `findInteractionPose` 接受内部 `standOff`，普通 open/pickup 仍使用 actor radius；Agent-held place 使用 `holdAnchor horizontal offset + held collider radius` 的 carry envelope。另一个修复是 candidate Y 改用 target root world Y，而不是 visual bounds.min.y，避免只有桌面 Mesh 的 Table 把 Agent 站位抬到桌面高度。详见 [`agent-place.md`](./agent-place.md)。

## 33. 1.19：`interaction-requested` 只剩低层 Primitive 语义

本文件 1.16 历史章节中的 `interaction-requested` 是当时高层 `approachAndInteract` 的终点。1.19 已升级：低层 `setArticulationAction/open/close` 仍只表示 motor request；高层 `approachAndInteract` 会继续等待 live joint completion，最终返回 `action-completed / action-failed / action-unverified`。成功要求 target tolerance + stable duration + coordinate stability，详见 [`live-articulation.md`](./live-articulation.md)。
