# Live Articulation Completion：从 Motor Request 到 Verified Action

AgentScape 1.19 把具身 `open / close` 从：

```text
approach
→ motor request
→ interaction-requested
```

升级为：

```text
approach
→ motor request
→ observe live joint coordinate
→ moving / reached / stalled / timeout
→ action-completed | action-failed | action-unverified
```

最终成功必须同时满足：

```text
status = action-completed
targetReached = true
settled = true
```

这不是文案升级，而是 Runtime action truth 的升级。

---

## 1. 为什么 Motor Request 不是动作完成

Rapier：

```text
configureMotorPosition(target, stiffness, damping)
```

只表达：

> “让这个 Joint 朝 target 运动。”

它不保证：

- target 最终被达到。
- 外部障碍不会卡住 Part。
- Joint 不会 stall。
- 关节不会在 tolerance 内持续摆动。
- 当前世界不会让资产离线验证过的动作失败。

所以：

```text
requested = true
```

永远不能等价成：

```text
opened = true
```

---

## 2. 1.8 Motion Sweep 与 1.19 Live Completion 是不同层

1.8 的 `ArticulationVerifier`：

```text
clone asset
→ isolated Physics world
→ run fixed-step sweep
→ collision regression / limits / stall / target error
```

回答：

> “这个资产在验证环境中是否具有可信的 articulation execution geometry？”

1.19：

```text
current scene instance
→ current Rapier bodies
→ current external obstacles
→ current motor request
→ observe across normal Runtime frames
```

回答：

> “这一次 live action 最终完成、失败，还是无法证明？”

所以没有把 `ArticulationVerifier` 实例化进 Runtime 热路径。

---

## 3. Joint coordinate 的唯一 live 事实入口

新增：

```text
PhysicsSystem.articulationState(
  objectId,
  partName,
  { target? }
)
```

返回：

```text
jointType
coordinate
target
error
tolerance
limits
localAxis
coordinateReference
```

`InteractionSystem.actionSweepBounds()` 也改为复用这个 coordinate，不再维护第二套当前关节公式。

---

## 4. Coordinate reference

当前 live coordinate 明确标记：

```text
coordinateReference = rest-zero-pose
```

Part attach 时 PhysicsSystem 已保存：

```text
restLocalPosition
restLocalRotation
```

这些是 joint zero-reference，不是第二份 world transform truth。

当前 world transform 仍来自 Rapier body，随后同步回 Three node。

---

## 5. Revolute coordinate

对于 revolute：

```text
deltaRotation
=
currentLocalRotation
*
inverse(restLocalRotation)
```

然后沿 Joint axis 读取 signed angle：

```text
angle = 2 * atan2(
  delta.xyz · axis,
  delta.w
)
```

最终 wrap 到：

```text
[-π, π]
```

Tolerance 沿用 Motion Sweep：

```text
0.08 rad
```

---

## 6. Prismatic coordinate

对于 prismatic：

```text
coordinate
=
(currentLocalPosition - restLocalPosition)
· localJointAxis
```

Tolerance：

```text
0.03m
```

`tests/physics-articulation.test.js` 对 revolute 与 prismatic 都有直接覆盖。

---

## 7. Joint axis 仍要转换到真实 Node parent frame

Manifest Joint axis 属于 articulated parent body/link frame。

Three node 实际 parent hierarchy 可能不同。

所以 PhysicsSystem：

```text
Manifest joint parent frame
→ world axis
→ actual node.parent local frame
```

再计算 coordinate。

这与 1.16 action swept bounds 的 frame 原则一致。

---

## 8. `setArticulationAction()` 仍是 request-only primitive

低层：

```text
setArticulationAction(id, action)
```

责任仍然只有：

```text
validate action
→ set Rapier motor target
→ record active request
→ start background observer
→ return requested=true
```

它没有被改成 async long Skill primitive。

这是为了继续服务：

- Human Runtime 操作。
- Restore target replay。
- Scene-level deterministic action request。
- Action-aware navigation fixtures。

Agent-facing 最终动作仍使用：

```text
approachAndInteract
```

---

## 9. Durable state 被拆成 requested 与 verified

1.18 以前：

```text
motor request
→ state.parts[door] = open
```

这会让被障碍卡住的门在 Scene JSON 中仍然声称 open。

1.19 改成两层：

```text
state.partTargets[door] = open
```

含义：

> active/requested motor target。

而：

```text
state.parts[door] = open
```

含义：

> 已在 transaction 内被 live completion promote 的 verified action state。

---

## 10. 为什么不把 observer result 持久化成第三份 state

Runtime observer 会产生：

```text
action-completed
action-failed
action-unverified
```

这些报告只保存在：

```text
InteractionSystem.articulationResults
```

运行时 ephemeral map。

没有写：

```text
record.state.partResult
```

因为：

- STALL 是某一时刻的世界条件。
- TIMEOUT 是某一轮 observer 的证据不足。
- 当前 Physics pose 才是 live transform truth。

瞬时诊断不应该伪装成长期物理状态。

---

## 11. 为什么 background observer 不能自己写 `state.parts`

一个看似方便的实现是：

```text
low-level open Skill transaction 已 commit
↓
未来某帧 observer 发现 target reached
↓
偷偷 state.parts=open
```

这违反 AgentScape 的 mutation ownership：

```text
Scene durable mutation
必须属于一个明确 transaction owner
```

所以 observer 只完成 Promise / runtime result。

Durable promotion 由高层长 mutation 自己完成。

---

## 12. `promoteArticulationCompletion()`

只有报告满足：

```text
status = action-completed
targetReached = true
```

而且当前 active `partTargets[part]` 仍与报告 action 一致，才允许：

```text
state.parts[part] = action
删除 state.partTargets[part]
```

否则：

```text
statePromoted = false
```

这避免一个旧 observer 在新 action 已开始后覆盖 durable state。

---

## 13. High-level `approachAndInteract` 现在是完整长事务

完整链：

```text
find interaction pose
→ real locomotion
→ arrival range/LOS recheck
→ action sweep recheck
→ motor request
→ await live completion
→ promote verified state on success
→ return final result
```

整个过程仍然位于：

```text
runtime.mutate("skill:approachAndInteract")
```

因此最终 verified state 与 locomotion 位移属于同一个 History command。

---

## 14. Observer state machine

每个 live Part 最多一个 pending observer：

```text
articulationTasks: Map<objectId:partName, task>
```

Task 记录：

```text
action
target
initialCoordinate
elapsed
stable duration
rolling coordinate samples
stall window
```

这不是通用 TaskManager，只服务 joint completion observation。

---

## 15. 为什么用时间窗口，不用固定帧数

离线 verifier 可以固定：

```text
180 steps × 1/60s
```

因为它拥有自己的 isolated simulation loop。

Live Runtime 不应该假设：

```text
“第 180 帧就是 3 秒”
```

所以 live observer 使用：

```text
dt accumulated time
```

默认：

```text
timeout        = 4.0s
stableDuration = 0.18s
stallWindow    = 0.5s
stallTolerance = 0.008 coordinate units
```

---

## 16. `action-completed`

第一层：

```text
targetError <= tolerance
```

并且持续：

```text
stableDuration >= 0.18s
```

还不够。

1.19 真实审计继续收紧：Joint 在 tolerance 内左右摆动，也不能叫 settled。

---

## 17. Coordinate stability

在 stable window 内，再检查：

```text
settleMovement
=
abs(currentCoordinate - stableWindowReference)
```

revolute 使用 wrapped delta。

要求：

```text
settleMovement <= tolerance * 0.25
```

所以 revolute 默认：

```text
<= 0.02 rad
```

prismatic 默认：

```text
<= 0.0075m
```

只有：

```text
in target tolerance
+
continuous stable window
+
coordinate no longer meaningfully moving
```

才返回：

```text
action-completed
targetReached = true
settled = true
```

---

## 18. Oscillation direct test

专项 unit test 给 observer 一个始终在 target tolerance 内但来回摆动的 coordinate：

```text
-0.94
-1.06
-0.94
-1.06
...

target = -1.0
tolerance = 0.08
```

虽然每个 sample 都“接近目标”，但 coordinate movement 不稳定。

最终必须：

```text
action-unverified
reason = TIMEOUT
settled = false
```

不是 completed。

---

## 19. `action-failed / STALL`

当：

```text
targetError > tolerance
```

且已经观察至少一个 stall window，并且：

```text
recent joint movement < stallTolerance
```

返回：

```text
status = action-failed
reason = STALL
targetReached = false
settled = false
```

这是确定性失败，不是“模型觉得门好像没动”。

---

## 20. 真实 STALL E2E

测试在 builtin Cabinet Door 中后段扫掠区加入一个真实 fixed Rapier blocker：

```text
Door motor target = open
↓
Door moves
↓
Door contacts external blocker
↓
Joint stops far from target
↓
0.5s rolling coordinate movement ≈ 0
```

Live observer 必须：

```text
action-failed / STALL
```

并且：

```text
state.parts.door
仍保持 verified close
```

没有把 motor request promote 成 open。

---

## 21. 高层真实 STALL 也覆盖

另一条 E2E 不是直接发 motor：

```text
Agent 从远处出发
→ find interaction pose
→ navigate
→ arrival guard
→ request open
→ Door 被 external blocker 卡住
```

最终 `approachAndInteract` 自己返回：

```text
action-failed
reason = STALL
statePromoted = false
```

所以 ToolCallingAgent 收到的就是最终失败，不需要再单独猜测。

---

## 22. `action-unverified / TIMEOUT`

如果 Joint 仍有进展、因此不是 STALL，但直到 timeout 仍无法满足：

```text
target reached + settled
```

返回：

```text
status = action-unverified
reason = TIMEOUT
```

这和：

```text
action-failed
```

不同。

TIMEOUT 表示证据不足，不代表确定“永远无法完成”。

---

## 23. LIMIT_VIOLATION

如果 live coordinate 超出 Manifest Joint limits，加上当前 type tolerance：

```text
action-failed
reason = LIMIT_VIOLATION
```

不会继续等 timeout。

这是和 Motion Sweep 一致的 fail-fast 原则。

---

## 24. JOINT_STATE_UNAVAILABLE

如果：

```text
Part missing
frame unavailable
coordinate non-finite
```

Live completion 不能伪造结果。

返回：

```text
action-unverified
reason = JOINT_STATE_UNAVAILABLE
```

---

## 25. SUPERSEDED

同一个：

```text
objectId + partName
```

同时只允许一个 observer。

如果旧动作：

```text
open
```

还没完成，新动作：

```text
close
```

到来，旧 Promise 返回：

```text
action-unverified
reason = SUPERSEDED
```

新 observer 接管当前 Part。

同 action + 同 target 重复 `waitForArticulationCompletion()` 会复用同一个 Promise，不会启动两个 observer。

---

## 26. 失败后 motor 为什么必须真正终止

如果 observer 已经返回：

```text
STALL
```

但 Rapier motor 仍然保持原 `open target`，那么 blocker 一旦移除：

```text
Door 可能在“报告失败之后”又自己继续打开
```

这会破坏 action result 的终态语义。

所以高层失败还要 finalize motor。

---

## 27. `holdArticulationCurrent()`

Rapier 当前 joint API 没有单独的：

```text
disablePositionMotor()
```

但有：

```text
configureMotorPosition(targetPos,...)
```

所以失败 finalization：

```text
read current live coordinate
→ configureMotorPosition(currentCoordinate)
```

把 motor target 改成当前姿态。

这不是 teleport；Part 仍由真实 Joint/Physics 保持。

---

## 28. 失败 finalization 也必须属于 transaction

不能让 background observer 自己清 durable request。

因此高层 `approachAndInteract` 在 observer 返回失败后、自己的 mutation 尚未结束时执行：

```text
finalizeArticulationAttempt(report)
```

它：

```text
hold current coordinate
清除仍匹配本 action 的 partTargets
保留 state.parts 的上一个 verified action
```

返回：

```text
stateFinalized = true
```

---

## 29. 为什么 SUPERSEDED 不会误清新 request

Finalization 先验证：

```text
record.state.partTargets[part]
=== report.action
```

旧 open observer 被 close supersede 时：

```text
partTargets = close
old report.action = open
```

所以旧 report 无法清掉新 request。

---

## 30. `partTargets` 与 Navigation

Action-aware Navigation 以前只看：

```text
state.parts[door] === open
```

1.19 moving 期间 verified state 仍可能是 close，所以现在：

```text
partTargets[door] === open
OR
parts[door] === open
```

都会被视为：

```text
alreadyRequested
```

如果当前 Door 仍挡路，返回：

```text
waiting-for-world-update
```

而不是每一帧重复推荐 open。

---

## 31. 高层失败后 Navigation 不会永远 waiting

High-level STALL/TIMEOUT finalization 会清掉对应 active `partTargets`。

所以失败返回后：

```text
Navigation
```

不会永远认为这个 request 仍在 active progress。

如果 Agent 后续希望重试，可以基于新的世界状态重新诊断。

---

## 32. Scene restore

新 Scene state 可能同时包含：

```text
parts.door = close
partTargets.door = open
```

含义是：

```text
上一个 verified state = close
当前 active/requested target = open
```

Restore 优先 replay：

```text
partTargets
```

如果没有 `partTargets`，仍兼容旧 scene：

```text
parts
```

专项测试锁住这两个路径。

---

## 33. 为什么 Scene schemaVersion 不需要升级

SceneSerializer 本来就保存：

```text
record.state
```

`partTargets` 是 state 中新增的可选字段。

旧 scene 没有它，兼容读取 `parts`。

所以：

```text
agentscape.scene schemaVersion = 1
```

仍然足够。

---

## 34. `getArticulationStatus`

新增只读 Skill：

```text
getArticulationStatus(
  id,
  partName?
)
```

每个 Part 返回：

```text
status
requestedAction
verifiedAction
pending?
last?
live.coordinate
live.target
live.error
live.tolerance
live.coordinateReference
```

---

## 35. Status 含义

Pending：

```text
status = moving
```

Observer 已完成：

```text
status = action-completed
```

失败：

```text
status = action-failed
```

证据不足：

```text
status = action-unverified
```

没有 runtime result 但已有 durable verified state：

```text
status = verified-state
```

无状态：

```text
status = idle
```

---

## 36. Agent 为什么不需要成功后再查一次 status

`approachAndInteract` 已经等待 live observer 完成。

所以如果结果本身：

```text
action-completed
targetReached=true
settled=true
```

这已经是 deterministic final post-condition。

Prompt 明确要求：

```text
不要再重复 getArticulationStatus
```

除非正在诊断失败，或用户后来询问当前状态。

---

## 37. Real Nemotron probe

```bash
npm run agent:probe -- interaction
```

当前 Nemotron 已真实通过 interaction probe；具体 planning steps 会随模型采样波动。某些 run 会第一步直接 `approachAndInteract`，也可能先尝试一个不合适的纯 `navigateTo`，被 Tool/Probe 拒绝后再纠正。成功标准不是步数，而是最终必须调用 `approachAndInteract` 且满足下面的 completion contract：

```text
status = action-completed
targetReached = true
settled = true
```

模型最终明确以这三个字段作为“Door 已打开”的依据。

---

## 38. Real Muse probe

当前 Muse 也已真实通过；常见行为是先 `findInteractionPose` 预览，再调用 `approachAndInteract`。planning steps 同样不是固定值。它最终明确引用：

```text
joint coordinate ≈ target
error < tolerance
action-completed
targetReached=true
settled=true
```

也没有调用低层 `open`。

---

## 39. Probe 里的低层 open 仍被禁止

测试 Gateway 对：

```text
open(cabinet_01)
```

继续直接拒绝。

成功必须走：

```text
approachAndInteract
```

所以 probe 测的是完整 embodied action，不是模型是否会发 motor request。

---

## 40. Offline collision regression 仍属于 Asset Verification

Live completion 当前不重新运行 1.8 的：

```text
baseline penetration map
collision regression sweep
```

原因：

- 那是资产级结构验证。
- Live world 有任意动态外部物体。
- Runtime 已通过真实 Rapier contacts 执行动作。
- Live STALL / target completion 负责最终 action outcome。

1.16 的 action swept AABB 仍在 motor request 前排除 Agent 自己阻挡动作。

所以当前组合是：

```text
Asset Motion Sweep
+
Runtime precondition sweep
+
Live Rapier execution
+
Live completion observer
```

---

## 41. 当前不 claim 什么

1.19 没有：

```text
force/torque threshold diagnosis
contact pair attribution in final action result
motor energy monitoring
joint effort limit
dynamic obstacle blame assignment
full live collision-regression provenance
```

因此：

```text
STALL
```

只确定：

> Joint 没有达到 target，并且在 stall window 内基本不再移动。

真实 blocker E2E 证明 external collision 可以导致这个结果，但通用 `STALL` 不声称已经知道“是谁卡住的”。

---

## 42. 1.19 的完整 open/close 闭环

```text
User / LLM
   ↓
approachAndInteract
   ↓
findInteractionPose
   ↓
real locomotion
   ↓
range / LOS / action-sweep recheck
   ↓
partTargets = requested action
   ↓
Rapier motor target
   ↓
Live articulation observer
   │
   ├─ target + stable
   │      ↓
   │ action-completed
   │      ↓
   │ promote state.parts
   │
   ├─ stalled / limit violation
   │      ↓
   │ action-failed
   │      ↓
   │ hold current + clear active request
   │
   └─ timeout / unavailable
          ↓
      action-unverified
          ↓
      hold current + clear active request
```

现在 open/close 与 pickup/place 一样，已经拥有明确的最终 action outcome，而不再停在“请求已发出”。
