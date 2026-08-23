# Verified Multi-step Task Sequencing

AgentScape 1.20 第一次把多个已经具有真实 post-condition 的具身 Skill 串成一个可审计任务链。

目标不是新增 BehaviorTree、TaskManager 或第二个 Planner，而是给现有 ToolCallingAgent 增加最小的确定性执行纪律：

```text
LLM plans
   ↓
read-only tools may continue
   ↓
first world mutation executes
   ↓
SkillRegistry classifies result semantics
   ↓
mutation barrier
   ↓
all remaining tool calls in this turn = not-executed
   ↓
fresh world + fresh planning round
```

对于具身任务：

```text
open
→ action-completed
→ replan
→ pickup
→ held
→ replan
→ place
→ placed + supportVerified + settled
```

任何一步如果返回：

```text
blocked
failed
unverified
requested-only
error
```

都不能被当成“函数调用正常返回，所以继续”。

---

## 1. 1.19 之前的真正 sequencing 缺口

ToolCallingAgent 原来会接收一个 assistant response：

```text
toolCalls = [
  approachAndInteract,
  approachAndPickup,
  approachAndPlace
]
```

然后顺序把三个全部执行。

问题是第一个调用即使真实返回：

```text
action-failed
reason = STALL
```

后面的 pickup/place 仍然已经在同一 planner turn 中排队。

这会把 LLM 的一次预测计划错误地当成执行计划。

---

## 2. Prompt 不能解决这个问题

仅仅告诉模型：

```text
“失败后不要继续”
```

不够。

原因：

- 模型可能一次输出多个 tool calls。
- tool calls 在 Runtime 执行前已经生成。
- 模型生成第二个 call 时还没有看到第一个 call 的真实 Physics result。
- 不同模型、temperature、provider 会产生不同 tool-call batching 行为。

因此 sequencing 必须有 Runtime 级确定性 gate。

---

## 3. 不新增第二 Planner

1.20 没有：

```text
TaskManager
BehaviorTree
HTNPlanner
SequencePlanner
RecoveryManager
```

LLM 仍决定“下一步做什么”。

Runtime 只决定：

```text
这个 tool call 是否已经执行
这个 result 属于什么 outcome
世界是否已经发生 mutation
是否必须重新 planning
这个 run 是否仍有 unresolved mutation
```

这是执行纪律，不是规划系统。

---

## 4. `mutates` 成为 sequencing barrier 的唯一元数据源

SkillRegistry 早已有：

```text
mutates: true | false
```

1.20 直接复用它：

```text
mutates=false
→ read/query
→ 不形成 barrier

mutates=true
→ world-changing step
→ 执行后必须 replan
```

没有另外维护：

```text
WORLD_CHANGING_TOOL_NAMES
```

这种第二份名单。

---

## 5. LLM Tool Schema 没有被污染

`mutates / batchable / executionPolicy` 都属于 Runtime internal metadata。

`SkillRegistry.definitions()` 仍只导出：

```text
name
description
parameters
```

所以 OpenAI-compatible tool schema 不会出现 AgentScape 内部字段。

直接测试要求内部 `executionPolicy()` 能读取 Skill 的 mutation 语义，而 LLM schema 仍不泄漏控制面字段：

```text
registry.executionPolicy('write').mutates === true
registry.definitions()[...].mutates === undefined
registry.definitions()[...].batchable === undefined
```

---

## 6. `executionPolicy()`

SkillRegistry 新增内部查询：

```text
executionPolicy(name, result)
```

返回：

```text
mutates
barrier
batchable
batchAcceptable
outcome
```

其中 `barrier` 当前严格等于：

```text
mutates === true
```

不根据模型、Prompt 或 tool name 临时猜测。

---

## 7. 为什么 `invoke().success` 不是任务成功

SkillRegistry 的：

```text
success: true
```

只表示：

> Handler 没有 throw，并且 Policy/参数校验通过。

但 handler 完全可能正确返回：

```text
{
  status: "action-failed",
  reason: "STALL"
}
```

因此：

```text
invoke success
≠
post-condition success
```

1.20 首次把这两层正式分开。

---

## 8. Outcome 分类

当前统一 outcome：

```text
verified
accepted
blocked
failed
unverified
requested
noop
error
```

ToolCallingAgent、executeBatch 和 Local fallback 共用这套语义。

---

## 9. `verified`

以下结构化终态属于 verified：

```text
action-completed
arrived
held
placed
dropped
committed batch
```

但两个关键 status 不能只信名字。

---

## 10. `action-completed` 必须显式满足 post-condition

分类器要求：

```text
status = action-completed
AND targetReached === true
AND settled === true
```

如果模型/Provider mock 只给：

```text
status = action-completed
```

缺少 final evidence，则降级：

```text
outcome = unverified
reason = POST_CONDITION_NOT_VERIFIED
```

---

## 11. `placed` 同样必须显式验证

要求：

```text
status = placed
AND supportVerified === true
AND settled === true
```

缺任意一个字段：

```text
outcome = unverified
```

因此 sequencing classifier 不会因为一个漂亮的 status string 自动相信结果。

---

## 12. `blocked`

包括：

```text
blocked
unreachable
interaction-blocked
pickup-blocked
place-blocked
*-blocked
```

这些结果表示 Runtime 已有明确阻挡证据。

---

## 13. `failed`

包括：

```text
action-failed
place-failed
*-failed
batch committed=false
batch rolledBack=true
```

例如：

```text
action-failed / STALL
place-failed / SUPPORT_NOT_REACHED
```

---

## 14. `unverified`

包括：

```text
action-unverified
place-unverified
cancelled
*-unverified
```

它与 failed 不同：

```text
failed
= deterministic negative result

unverified
= final truth could not be proven
```

Sequencing 两者都不能继续当作成功。

---

## 15. `requested`

包括：

```text
moving
interaction-requested
requested === true
```

它表示动作只进入 request/progress 阶段。

所以低层：

```text
open()
```

即使没有 throw，也不能作为一个 verified sequence step。

---

## 16. `accepted`

同步、确定性 Runtime primitive 可能没有结构化 status：

```text
moveObject
spawnAsset
removeObject
```

Handler 正常返回、没有 failure evidence 时分类为：

```text
accepted
verified = null
```

它可以完成普通 scene editing mutation，但仍然形成 replan barrier。

---

## 17. Mutation barrier

ToolCallingAgent 每一轮：

```text
for call in response.toolCalls
```

允许连续执行 read-only tools。

一旦第一个：

```text
policy.barrier = true
```

被执行：

```text
barrier = active
```

同一 assistant response 的后续调用全部不再进入 SkillRegistry。

---

## 18. 为什么成功 mutation 后也必须 replan

不仅失败要 replan。

成功：

```text
open → action-completed
```

也改变了：

- Rapier collider pose。
- Navigation current-world obstacles。
- Scene relations。
- Agent position。
- held ownership。

所以旧 planner turn 中基于 mutation 前世界生成的后续 tool call 已经过期。

1.20 对任何 mutation 一律：

```text
replanRequired = true
```

---

## 19. Provider tool-call 协议必须完整

如果 assistant 发了三个 tool calls：

```text
call_open
call_pickup
call_place
```

但 Runtime 只执行第一个，不能简单丢弃后两个。

OpenAI-compatible history 通常要求每个 toolCallId 都有对应 tool response。

所以 1.20 为未执行调用回填：

```json
{
  "status": "not-executed",
  "reason": "REPLAN_REQUIRED_AFTER_WORLD_CHANGE",
  "afterTool": "approachAndInteract",
  "afterOutcome": "verified"
}
```

这让下一 planner round 的 conversation history 仍然协议完整。

---

## 20. Skipped 不是 Failure

`not-executed` 的意思不是：

```text
pickup failed
```

而是：

```text
pickup 根本没有被 Runtime 执行
```

Execution ledger 中：

```text
executed = false
outcome.state = skipped
```

这对审计很重要。

---

## 21. Tool result 中的 `_sequence`

Mutation result 写回 LLM history 时增加：

```json
{
  "_sequence": {
    "outcome": { "state": "verified" },
    "barrier": true,
    "replanRequired": true,
    "instruction": "World state changed..."
  }
}
```

真实 tool handler 返回值本身不被修改；这个 envelope 只存在于 Agent conversation history。

所以 Runtime API caller 不会突然看到额外字段。

---

## 22. Fresh world context

下一 planner round 本来就重新调用：

```text
listObjects()
```

因此 mutation barrier 之后模型同时获得：

```text
previous tool result
+
not-executed calls
+
fresh world summary
```

不是只靠一句“请重新规划”。

---

## 23. `unresolvedMutations`

只看最后一个 mutation 仍然不够。

错误模型可能：

```text
open → STALL
pickup → held
final
```

如果只看最后一步：

```text
held = verified
```

整个 task 会被错误标 completed。

1.20 增加 runtime-only ledger：

```text
unresolvedMutations
```

---

## 24. Mutation identity

一个 adverse mutation 会按稳定语义键记录：

```text
tool name
+
actorId / id
+
targetId / supportId
+
action / partName
+
assetId / instanceId
+
end
```

例如：

```text
approachAndInteract:{
  actorId: agent_01,
  targetId: cabinet_01,
  action: open
}
```

速度等非语义执行参数不进入 identity。

---

## 25. 未解决失败不会被后续成功洗白

如果：

```text
open cabinet → failed
pickup cup → verified
```

最终：

```text
lastMutation = pickup verified
```

但：

```text
unresolvedMutations = [open cabinet failed]
```

所以：

```text
taskStatus = incomplete
```

直接测试锁住这个行为。

---

## 26. 同一语义步骤重试成功才能清掉 unresolved

如果：

```text
open cabinet → STALL
...
open cabinet → action-completed
```

第二次 verified result 使用相同 mutation identity：

```text
unresolvedMutations.delete(identity)
```

最终才可能：

```text
taskStatus = completed
```

---

## 27. `taskStatus`

ToolCallingAgent.run 现在返回机器可读：

```text
completed
incomplete
no-mutation
```

### completed

```text
至少发生一个 mutation
最后 mutation outcome = verified | accepted
unresolvedMutations.length = 0
```

### incomplete

```text
最后 mutation 未成功
OR
仍存在任何 unresolved mutation
```

### no-mutation

本轮任务只有查询/解释，没有 world mutation。

---

## 28. 自然语言不再是唯一任务状态

模型仍生成：

```text
final message
```

但产品层不再只有这一句。

Pages 会另外显示：

```text
task status: completed · mutation chain verified
```

或：

```text
task status: incomplete · approachAndInteract → failed
```

即使模型措辞失误，UI 仍有确定性 task state。

---

## 29. Execution ledger

`run()` 同时返回：

```text
execution[]
```

每项：

```text
planningStep
tool
args
executed
outcome
mutates
reason?
```

可以明确区分：

```text
模型计划过
vs
Runtime 真执行过
```

---

## 30. Trace 复用现有 hash chain

AgentTools 没有新增 TaskLog store。

Sequencing decision 直接进入：

```text
TraceRecorder.emit('agent.sequence')
```

并同步发：

```text
runtime.events.emit('agent.sequence')
```

Trace payload 包括：

```text
planningStep
tool
executed
outcome
identity
barrier
replanRequired
unresolved
```

所以现有 Trace integrity chain 同时覆盖多步任务执行纪律。

---

## 31. `executeBatch` 不能成为 sequencing 后门

1.20 之前 `executeBatch` 只检查：

```text
registry.invoke(...).success
```

但：

```text
action-failed
```

是正常 handler return，因此 invoke success 仍为 true。

这意味着旧 batch 可能错误 commit structured failure。

---

## 32. Batch semantic rollback

现在 nested result 同样经过：

```text
executionPolicy()
```

如果 outcome 是：

```text
blocked
failed
unverified
requested
error
noop
```

则：

```text
committed = false
rolledBack = true
reason = SEMANTIC_STEP_NOT_VERIFIED
```

不仅仅在 throw 时 rollback。

---

## 33. Embodied action 不能进入 atomic batch

更重要的是，跨 Physics 帧的动作不能假装同步 rollback-safe。

1.20 将这些 Skill 标记：

```text
batchable = false
```

包括：

```text
navigateTo
approachAndInteract
approachAndPickup
approachAndPlace
open
close
pickup
drop
dropHeld
executeBatch
```

---

## 34. 为什么低层 open/close 也不可 batch

低层：

```text
open
close
```

只发 motor request，并启动 live observer。

如果先执行再发现 batch 后续失败并 restore，会引入：

```text
pending motor observer
restore lifecycle
async Physics state
```

因此最安全的语义是：

```text
在执行 batch 前直接拒绝
```

---

## 35. Batch preflight

`executeBatch` 先检查所有 calls：

```text
registry.executionPolicy(call.name).batchable
```

只要一个 false：

```text
committed = false
rolledBack = false
reason = UNBATCHABLE_SKILL
skill = offending skill
```

任何前面的 mutation 都还没有执行。

---

## 36. 什么仍然适合 Batch

同步 scene editing：

```text
spawnAsset
moveObject
deterministic scene place
duplicateObject
removeObject
```

仍可 batch。

例如 `建立咖啡角`：

```text
executeBatch([
  move table,
  move cabinet,
  scene-place cup
])
```

这是布局编辑，不是 Agent manipulation task。

---

## 37. Local fallback 也不能绕过 sequencing

旧 LocalPlanner：

```text
只要 messages 中已经有一个 tool result
→ “任务已执行。”
```

所以 mutation barrier 后，它会在第一步就提前结束。

1.20 改成重新从用户目标生成顺序 intent，然后逐项检查真实 tool results。

---

## 38. Local result consumption

Local fallback 读取：

```text
_sequence.outcome.state
```

规则：

```text
verified / accepted
→ 进入下一 intent

skipped
→ 重新发当前 intent

blocked / failed / unverified / requested / error / noop
→ 停止并报告 incomplete
```

不自己发明第三套 outcome taxonomy。

---

## 39. Local compound task

例如：

```text
打开柜门，取出杯子，把杯子放到桌上
```

本地模式现在实际规划轮次：

```text
round 1
→ approachAndInteract

verified

round 2
→ approachAndPickup

verified

round 3
→ approachAndPlace

verified

round 4
→ final
```

每轮只有一个 world mutation。

---

## 40. Local failure stop

如果第一步：

```text
action-failed / STALL
```

Local fallback 下一轮直接：

```text
任务未完成：approachAndInteract → STALL
```

不会调用 pickup/place。

直接测试覆盖。

---

## 41. Real LLM success probe

新增：

```bash
npm run agent:probe -- sequence
```

任务：

```text
open cabinet
→ pickup cup
→ place cup on table
```

Probe 真正启用 SkillRegistry executionPolicy，因此 mutation barrier 不是 mock 文案。

---

## 42. Nemotron success sample

一次当前真实样本：

```text
approachAndInteract
→ approachAndPickup
→ approachAndPlace
```

3 个 mutation 分别位于 3 个 planning rounds。

最终：

```text
taskStatus = completed
unresolvedMutations = []
```

模型最终明确引用每一步 post-condition。

Planning steps 是采样结果，不作为稳定指标。

---

## 43. Muse success sample

Muse 当前真实样本允许额外 read-only observation：

```text
listObjects
→ approachAndInteract
→ approachAndPickup
→ approachAndPlace
→ describeObjectRelations
```

World mutation 顺序仍严格：

```text
open
→ pickup
→ place
```

Read-only query 不被 mutation barrier 禁止。

---

## 44. Real LLM failure probe

新增：

```bash
npm run agent:probe -- sequence-failure
```

`approachAndInteract` 固定返回：

```text
action-failed
reason = STALL
```

Probe 要求：

```text
不得执行 approachAndPickup
不得执行 approachAndPlace
不得调用低层 pickup/place
最终 taskStatus = incomplete
unresolved open failure 必须存在
```

---

## 45. Nemotron failure sample

当前真实样本：

```text
approachAndInteract → STALL
→ listRelations
→ final incomplete
```

没有 pickup/place。

---

## 46. Muse failure sample

真实采样会波动。

一个 run 曾在失败诊断中过度循环直到 maxSteps；随后 run 正确收敛：

```text
approachAndInteract → STALL
→ getArticulationStatus
→ final incomplete
```

这说明：

```text
planning step count
```

不能当能力指标。

Runtime 的 deterministic invariant 仍然成立：失败被记录为 unresolved，后续成功不能自动洗掉它。

---

## 47. 真正的 Runtime multi-step E2E

1.20 不只测试 mock Tool results。

新增真实纵向测试：

```text
LocalPlannerGateway
→ ToolCallingAgent
→ AgentTools
→ SkillRegistry
→ Runtime mutate
→ Navigation / Locomotion
→ Rapier Physics
→ InteractionSystem
```

世界中真实存在：

```text
agent_01
cabinet_01
cup_01
table_01
```

---

## 48. Real success chain

真实 test：

```text
打开柜门，然后拿起杯子，再把杯子放到桌上
```

最终必须同时满足：

```text
cabinet.state.parts.door = open
cup.state.heldBy = undefined
supportStatus(cup, table.top).on = true
carryStatus(agent).status = empty
```

History/mutation labels 必须严格是：

```text
skill:approachAndInteract
skill:approachAndPickup
skill:approachAndPlace
```

没有低层 teleport/place 混入。

---

## 49. Real STALL chain

同一条完整链把一个真实 fixed Rapier blocker 放入 Door sweep。

结果：

```text
approachAndInteract
→ action-failed / STALL
```

并要求：

```text
mutation history 只有 approachAndInteract
Cup 未 held
Place 未执行
cabinet verified state 仍 close
unresolvedMutations.length = 1
```

这证明 failure stop 不只是 scripted gateway 行为。

---

## 50. Multi-step E2E 又暴露了一个真实 Place 问题

单独 Place E2E 中，Agent 常常已经面向 Table。

但完整任务：

```text
open cabinet
→ walk to cup
→ pickup
→ walk to table
```

到达 Table interaction pose 后，Agent yaw 取决于最后一个 Detour waypoint。

HoldAnchor 可能朝侧面。

于是：

```text
Agent body 在合法位置
BUT Cup hold pose 离 release 太远
```

甚至原地转向时 Cup 可能扫过障碍。

---

## 51. `setCharacterYaw()`

PhysicsSystem 新增明确的 kinematic Agent yaw primitive：

```text
setCharacterYaw(id, yaw)
```

只允许 kinematic body。

它同步：

```text
Rapier current rotation
Rapier next kinematic rotation
Three root quaternion
Physics cached lastRotation
```

有直接 Physics test。

---

## 52. `holdPoseAt()`

InteractionSystem 可以预测：

```text
actorPosition + yaw + Manifest holdAnchor
```

对应的：

```text
held world position
held world rotation
```

没有读取 Human Camera，也不复制 Physics state。

---

## 53. Place interaction candidate 需要保证 release reach

原来的 carry-aware stand-off 只保证：

```text
Agent + held envelope 不太靠近 Table
```

但不保证 Agent 站到候选后，把身体转向 release point 时：

```text
HoldAnchor → release
```

仍然在固定 interaction distance 内。

1.20 给 `findInteractionPose()` 增加内部 `candidateFilter`。

---

## 54. `candidateFilter` 不是新的 Planner

它只是 caller-specific deterministic predicate。

普通 open/pickup：

```text
candidateFilter = null
```

Place：

```text
预测 candidate 上 Agent 朝向 release
→ 计算 predicted HoldAnchor pose
→ distance(predicted hold, release)
<= interaction distance - waypoint tolerance
```

不满足的 candidate 在 Detour 可达也不会被选。

---

## 55. 为什么减 waypoint tolerance

Locomotion 到达定义允许：

```text
DEFAULT_WAYPOINT_TOLERANCE = 0.18m
```

所以候选几何如果刚好卡在 1.5m 极限，实际 Agent 在 tolerance 边缘停下就可能 reach fail。

1.20 把原来的 magic number 提升为：

```text
DEFAULT_WAYPOINT_TOLERANCE
```

Place candidate 使用：

```text
1.5m - waypointTolerance
```

给真实 arrival pose 留执行余量。

---

## 56. `reorientHeldToward()`

Agent 到达后不会瞬间把 yaw 设到 release。

而是：

```text
current yaw
→ target yaw toward release
→ split into <= 15° steps
```

每一步：

```text
predict HoldAnchor pose
→ Physics.bodyMotionClear(held object)
→ clear 才旋转 Agent + held object
```

---

## 57. 为什么原地转向也必须做 held-object collision

Agent capsule 绕 Y 自转几何基本不变。

但手中 Cup 位于身体前方：

```text
Cup 会沿圆弧移动
```

因此：

```text
Agent 自己能原地转
≠
Agent + held object 能安全原地转
```

这与 1.17 carry clearance 是同一 occupancy ownership 原则。

---

## 58. Reorientation failure

任意 yaw step：

```text
bodyMotionClear = false
```

返回：

```text
place-blocked
reason = CARRY_REORIENT_BLOCKED
stillHeld = true
```

并恢复：

```text
原 Agent yaw
原 held object pose
```

不会留下半转状态。

---

## 59. Reorientation direct test

专项测试构造：

```text
step 1 clear
step 2 blocked by wall
```

断言：

```text
bodyMotionClear called twice
Agent yaw restored
Cup pose restored
```

另一个 success test 验证 90° yaw 被分成三个 30° collision-checked steps。

---

## 60. Place 仍保留三段 transfer

Reorientation 不是取代 1.18：

```text
lift
→ traverse
→ lower
```

而是新增前置：

```text
arrival
→ reorient held safely
→ release reach check
→ lift/traverse/lower
→ Dynamic settle
→ support post-condition
```

---

## 61. 当前完整 verified task chain

```text
User goal
   ↓
LLM / Local planner
   ↓
ToolCallingAgent
   ↓
read tools (optional)
   ↓
MUTATION 1: approachAndInteract
   ↓
verified completion
   ↓
BARRIER + replan
   ↓
MUTATION 2: approachAndPickup
   ↓
held ownership
   ↓
BARRIER + replan
   ↓
MUTATION 3: approachAndPlace
   ↓
carry-aware candidate
   ↓
collision-checked reorientation
   ↓
release transfer
   ↓
Dynamic settle
   ↓
supportVerified
   ↓
BARRIER + final planning
   ↓
taskStatus = completed
```

---

## 62. 当前不 claim 什么

1.20 没有实现：

```text
通用 dependency graph
HTN planning
automatic causal recovery planner
arbitrary goal satisfaction theorem
persistent task database
multi-agent coordination
```

`taskStatus=completed` 的含义是：

> 本次 Agent run 的 world-changing execution ledger 没有 unresolved adverse mutation，最后 mutation 有可接受的完成语义。

它不是对任意自然语言目标的形式化逻辑证明。

---

## 63. 为什么这是合理的最小边界

Runtime 能可靠知道：

```text
某一步是否真正改变世界
某一步 final outcome 是什么
某一步是否仍未解决
当前世界是什么
```

Runtime 不能通用知道：

```text
“用户这句话中的第三个子目标是否逻辑依赖第一个子目标”
```

所以 1.20 不假装拥有完整因果 Planner。

它选择一个可证明的 invariant：

```text
每次 mutation 后重新规划
任何 adverse mutation 保持 unresolved
只有同语义 verified retry 才清除
最终产品层不会把 unresolved chain 标 completed
```

这已经把“LLM 一次性猜完整执行序列”升级成“LLM 在真实世界结果之间迭代决策”。

---

## 64. 数值 `error` 不是 Tool Error

真实三步 E2E 第一次接上 `SkillRegistry.executionPolicy` 时，`approachAndInteract` 明明返回：

```text
status = action-completed
targetReached = true
settled = true
error = 0.000013...
```

却被分类成 `TOOL_ERROR`。原因是旧 classifier 用 `if (result.error)` 判断异常，而 live articulation 的 `error` 是合法的 joint target metric。

1.20 因此只把字符串错误或带 `code` 的结构化 error 当 Tool failure；数值 error 继续作为 Physics evidence。直接 SkillRegistry 回归同时锁住数值 metric 与真正异常两条路径。

---

## 65. 连续任务暴露了 Place 的 Arrival Tolerance Margin

单独 Place 测试通常从一个已经较合理的 Agent pose 开始；真实 `open → pickup → place` 中，Place 第一次候选虽然理论上满足：

```text
predicted held → release < 1.5m
```

但 Locomotion 的合法 `waypointTolerance = 0.18m` 会让 Agent 在目标附近提前完成。一次真实 run 中理论约 1.47m 的候选，到达后变成 1.611m，正确触发 `RELEASE_OUT_OF_RANGE`。

修复没有放宽最终 1.5m policy，而是导出唯一 `DEFAULT_WAYPOINT_TOLERANCE`，候选阶段要求：

```text
predicted held → release
<= DEFAULT_INTERACTION_DISTANCE - DEFAULT_WAYPOINT_TOLERANCE
```

真正 arrival 后仍保留原 1.5m 二次验证。这样 planner candidate 对执行误差留有确定性 margin，而最终物理规则不变。

---

## 66. Real Model Success / Failure Sequence Probes

`npm run agent:probe -- sequence` 当前在 Nemotron 与 Muse 上都真实通过：

```text
approachAndInteract → verified
approachAndPickup   → verified
approachAndPlace    → verified
taskStatus          → completed
```

`npm run agent:probe -- sequence-failure` 同样在两个模型上通过。`approachAndInteract` 返回 `action-failed / STALL` 后，模型只允许继续只读诊断；`approachAndPickup / approachAndPlace` 从未执行，最终：

```text
taskStatus = incomplete
unresolvedMutations = [open failure]
```

具体 planning steps 会随采样波动，不作为能力指标。验证重点是 mutation 顺序、Runtime outcome 和最终 taskStatus。

---

## 67. 1.20.1：Planning Limit 也必须保留任务真值

1.20.0 发布后审计发现一个终止边界：如果 Agent 已经产生 unresolved mutation，但之后一直做只读诊断，直到 `maxSteps` 用尽，旧代码会直接 throw：

```text
Agent exceeded N planning steps
```

这会丢掉本轮已经积累的：

```text
lastMutation
unresolvedMutations
execution
```

1.20.1 改为：只有在 planning limit 用尽且仍有 unresolved mutation 时，返回结构化不完整结果：

```text
taskStatus = incomplete
termination = planning-limit
unresolvedMutations = [...]
execution = [...]
```

并通过现有 `agent.sequence` Trace 记录：

```text
termination = planning-limit
unresolved = N
```

如果 planning limit 用尽但没有 unresolved mutation，仍保留原来的异常语义，因为那表示 planner 自身没有正常收敛，而不是一个已经可解释的 world-task failure。
