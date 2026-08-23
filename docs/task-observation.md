# Compact Task Observation / Recovery Context

AgentScape 1.21 在 1.20 Verified Multi-step Sequencing 之上增加一个**只读、短、provider-neutral** 的任务观察面。

目标不是增加 Planner，而是把已经存在的 Runtime truth：

```text
Physics / Interaction / Navigation / SceneGraph
+
ToolCallingAgent sequencing ledger
```

压成一个稳定的：

```text
agentscape.task-observation.v1
```

供下一轮 LLM planning 使用。

---

## 1. 为什么 `listObjects + tool history` 不够

1.20 已经做到：

```text
mutation
→ structured outcome
→ fresh replan
```

但每轮 gateway context 仍重复发送完整 `listObjects()`。

大型 world 中这会让 prompt 体积随对象数量线性增长；失败恢复时模型还容易重复调用：

```text
listObjects
getBounds
getArticulationStatus
findNearby
relations
...
```

即使这些事实已经在上一轮 Runtime result 中出现。

1.21 的目标不是删除这些 Skills，而是让常见恢复所需的 verified evidence 默认已经在 compact context 里。

---

## 2. 它不是新的 World State

`buildTaskObservation()` 是纯组装器。

它没有：

```text
setPosition
setState
SceneSerializer write
Physics mutation
History transaction
```

它只读取现有 owner：

```text
ObjectStore
PhysicsSystem
LocomotionSystem
InteractionSystem
SceneGraph
ToolCallingAgent unresolved ledger
```

所以：

```text
Task Observation
!=
第二份 Scene state
```

---

## 3. Schema

当前根结构：

```json
{
  "schema": "agentscape.task-observation.v1",
  "actor": {},
  "lastMutation": null,
  "unresolvedMutations": [],
  "objects": [],
  "relations": [],
  "recoveryHints": [],
  "articulation": []
}
```

字段按需要省略，不追求固定大对象。

---

## 4. Actor Observation

Actor 只包含当前具身执行直接需要的事实：

```text
id
position
navigation
carry
```

其中：

```text
position   ← Rapier body
navigation ← LocomotionSystem.status()
carry      ← InteractionSystem.carryStatus()
```

Held object 仍然来自 `heldBy` durable ownership；Task Observation 不复制 ownership truth。

---

## 5. Relevant Object Selection

Observation 不遍历整个 world 输出对象详情。

Relevant IDs 只来自：

```text
actor
lastMutation args
unresolvedMutation args
```

当前识别：

```text
actorId
id
targetId
supportId
instanceId
```

所以一个有 120 个无关对象的 world，如果当前失败步骤是：

```text
approachAndInteract(agent_01, cabinet_01, open)
```

默认对象详情只会包含：

```text
agent_01
cabinet_01
```

专项测试要求 JSON 仍保持小于几 KB，而不是随着 120 个 junk objects 增长。

---

## 6. 第一次 Planning 仍给完整 World Index

第一次 planning round 还没有 mutation 上下文。

此时 LLM 需要知道有哪些对象，因此仍发送：

```text
context.world = listObjects()
```

这是 entity discovery。

---

## 7. 发生 Mutation 后不再重复完整 World Dump

一旦已有 `lastMutation`：

```text
context.world = { count: N, index: [{ id, asset }, ...] }
context.task  = compact observation
```

Relevant object detail 已经在 `context.task.objects`。

这样不会每一轮重复：

```text
75 objects × position/actions
```

但仍保留世界规模信息。

只读 query 本身不会触发缩短；必须真的发生过 mutation。

---

## 8. 为什么仍保留旧 Tool Messages

OpenAI-compatible tool-call protocol 要求 assistant tool call 与 tool result 保持历史配对。

1.21 没有擅自裁剪协议历史。

所以 Compact Task Observation 解决的是：

```text
重复 world dump
+
重复恢复查询
```

不是完整 conversation compression。

长期 transcript summarization 是另一个问题。

---

## 9. Relevant Relations

SceneGraph 仍是：

```text
ON / SUPPORTS / NEAR / INSIDE / CONTAINS
```

Task Observation 最多抽取少量与 relevant IDs 相连的 edges。

默认：

```text
maxRelations = 8
```

并压缩 meta，只保留当前有价值的：

```text
distance
surfaceId
```

不会把整个 SceneGraph dump 给模型。

---

## 10. Live Articulation Evidence

Relevant object 如果含 executable articulated Part，Observation 会调用已有：

```text
InteractionSystem.articulationStatus()
```

但进一步压缩成：

```text
partName
status
requestedAction
verifiedAction
live.coordinate
live.target
live.error
live.tolerance
coordinateReference
last.status / reason / targetReached / settled
```

不会复制完整 observer report 的 progress/samples 等诊断细节。

---

## 11. STALL 的 Compact Evidence

真实 Door blocker E2E 的第二 planning round 会直接看到近似：

```text
lastMutation:
  approachAndInteract
  outcome = failed / STALL

articulation:
  door
  verifiedAction = close
  live.coordinate = current stalled coordinate
  live.error > tolerance
  last.reason = STALL
```

模型不必再调用 `getArticulationStatus` 才知道同一事实。

---

## 12. `unresolvedMutations` 仍来自 1.20 Ledger

Task Observation 不重新判断任务成功失败。

它只复制 Agent loop 当前 ledger：

```text
unresolvedMutations
```

Mutation identity 和 outcome truth 仍由 1.20：

```text
SkillRegistry.executionPolicy
ToolCallingAgent mutation barrier
```

负责。

---

## 13. Recovery Hint 是 Provisional

Recovery hint 明确：

```text
status = provisional
```

它不能成为：

```text
world fact
verified action
automatic mutation
```

它只是把 deterministic failure 映射为较合理的恢复方向。

---

## 14. 已经内嵌的 Evidence 不再推荐重复 Tool

1.21 第一版对 STALL 给出：

```text
recoveryHint.tool = getArticulationStatus
```

真实 Muse probe 证明这是错误激励：articulation evidence 已经在 compact observation 中，却又鼓励模型重复读取。

现在 STALL / LIMIT / TIMEOUT 类 hint 改成：

```text
action = report-incomplete-or-retry-after-world-change
```

并明确：

```text
live articulation evidence already embedded
```

---

## 15. 哪些 Hint 仍然推荐 Tool

只有 compact observation 当前并没有计算的额外诊断，才推荐 Tool。

例如 Place transfer geometry：

```text
PLACE_TRANSFER_BLOCKED
CARRY_REORIENT_BLOCKED
RELEASE_OUT_OF_RANGE
```

可以 provisional 推荐：

```text
findFreeSpace
```

Navigation path counterfactual 仍可推荐：

```text
suggestNavigationActions
```

这些结果依然不是 world truth；执行任何 recovery mutation 后必须重新查询真实世界。

---

## 16. 为什么只靠 Prompt 仍不够

Nemotron 在 STALL 后通常很快停止。

Muse 的真实 failure probe 曾经继续调用约十个只读工具，直到全局 `maxSteps`。

这说明：

```text
compact evidence
+
prompt instruction
```

不能保证所有模型停止 read-loop。

因此 1.21 增加一个很小的执行预算，而不是 Planner。

---

## 17. Bounded Recovery Observation

`ToolCallingAgent` 新增：

```text
maxRecoveryReadRounds = 4
```

定义：

- 存在 unresolved mutation；
- 当前 planning round 没有执行新 mutation；
- 只执行了 read-only/diagnostic tools；

则：

```text
recoveryReadRounds += 1
```

任何 mutation attempt 会重新从 0 计数。

Unresolved 清零后也重置。

---

## 18. Budget 会暴露给模型

存在 unresolved 时，gateway context 增加：

```json
{
  "recovery": {
    "readOnlyRoundsUsed": 2,
    "readOnlyRoundsRemaining": 2
  }
}
```

模型知道它不能无限做重复诊断。

---

## 19. 为什么是 Round，不是 Tool Call 数

同一 assistant response 可以合理批量调用多个只读 query。

所以预算单位是：

```text
planning round
```

不是：

```text
单个 read tool
```

这避免因为一次并行/组合诊断就快速耗尽预算。

---

## 20. Recovery Observation Limit

如果已使用完允许的 read-only recovery rounds，模型下一轮仍只提出 read tools 而不采取 recovery mutation / final response，这批 read calls 不再执行：

```text
taskStatus = incomplete
termination = recovery-observation-limit
```

并保留：

```text
lastMutation
unresolvedMutations
execution
```

Trace 记录：

```text
termination = recovery-observation-limit
recoveryReadRounds
unresolved = N
```

---

## 21. 它不是自动 Failure Recovery

Recovery budget 不会：

```text
自动 open
自动 move blocker
自动换路径
自动 retry
```

LLM 仍决定：

```text
retry mutation
选择另一条动作
报告 incomplete
```

Runtime 只阻止“世界没有改变却无限读”的无效循环。

---

## 22. Mutation Identity 也被真实模型暴露了问题

Muse 在一次 STALL 后重试同一扇门：

第一次：

```text
approachAndInteract(... action=open)
```

第二次：

```text
approachAndInteract(... action=open, partName=door)
```

旧 identity 只看调用 args，因此把它们记成两个 unresolved mutations。

但第一次 Runtime result 已经明确：

```text
interaction.part = door
```

---

## 23. Runtime-result-normalized Mutation Identity

现在 identity 同时读取：

```text
call.args.partName
```

如果调用没有显式 Part，则从实际执行结果补：

```text
result.partName
result.interaction.part
result.actionSweep.partName
```

因此：

```text
implicit door
==
explicit door
```

对于真正不同的 Part，identity 仍然不同。

---

## 24. 为什么不能简单忽略 `partName`

多门 Cabinet / Drawer 可能存在：

```text
left_door
right_door
```

如果 mutation identity 永远忽略 Part：

```text
open left
```

的成功会错误清掉：

```text
open right
```

的 unresolved failure。

所以正确方案是：

```text
实际执行 Part canonicalization
```

而不是删掉 Part identity。

---

## 25. 真实 Muse Failure 的变化

第一版 compact context：

```text
open → STALL
→ 约 10 次 read diagnostics
→ retry open with explicit door
→ 又 STALL
→ 2 unresolved
→ planning-limit
```

1.21 最终版本：

```text
open → STALL
→ bounded diagnostics
→ recovery-observation-limit
→ 1 unresolved semantic open failure
```

没有 pickup/place 越级，也不会把同一个 Door failure 复制成两个 ledger entries。

---

## 26. Success Path 不受 Recovery Budget 影响

Nemotron 与 Muse 的真实 success probe 仍能执行：

```text
approachAndInteract
→ verified
approachAndPickup
→ verified
approachAndPlace
→ verified
```

每次 verified mutation 后：

```text
unresolved = 0
recoveryReadRounds = 0
```

所以正常 multi-step execution 不消耗 recovery budget。

---

## 27. Compact 不等于隐藏 World Truth

任何需要更深诊断的事实仍可以通过已有 read Skill 获取。

例如：

```text
findPath
suggestNavigationActions
findFreeSpace
describeObjectRelations
getBounds
```

1.21 只改变默认 context，不删除 API。

---

## 28. Provider-neutral

Task Observation 不包含：

```text
OpenAI message format
Anthropic block format
model-specific tokens
provider reasoning schema
```

它只是 JSON-compatible plain data。

Gateway 再决定怎样把 `context` 注入具体模型协议。

---

## 29. Secret Boundary 不变

Task Observation 只来自 Runtime world/task state。

不会包含：

```text
API key
.env.local
Gateway authorization header
provider credential
```

Secret 仍只在本地 server boundary。

---

## 30. 当前测试

专项覆盖：

```text
120 unrelated objects → compact relevant object set
relation limit / compact meta
live articulation compression
provisional recovery hints
first round full world
post-mutation world count + id/asset entity index
real Rapier STALL → compact second-round context
implicit/explicit Part mutation identity normalization
bounded recovery read loop
recovery budget context
```

---

## 31. 当前仍不做

1.21 没有：

```text
conversation semantic summarizer
long-term memory
BehaviorTree
TaskManager
automatic recovery executor
contact blocker attribution
learned failure policy
```

尤其是：

```text
STALL
```

现在仍不能确定性回答：

> 哪一个 collider / object 导致这次 stall？

---

## 32. 下一阶段

Compact context 已经把“发生了什么”压清楚。

下一步更有价值的是：

```text
Failure Attribution / Contact Provenance
```

例如：

```text
Door STALL
→ current Part collider contacts
→ external owner ids
→ blocker provenance
→ deterministic recovery evidence
```

这样 Recovery Hint 才可能从：

```text
“门卡住了”
```

升级成：

```text
“门在当前世界被 obstacle_03 接触阻挡；若要恢复，先处理这个具体 blocker。”
```

仍然要求真实 world mutation 后重新验证，不把 attribution 直接变成自动行动。

---

## 33. 1.22：Compact Context 获得 Contact Provenance

当 relevant articulated Part 的最近失败报告包含 attribution，`agentscape.task-observation.v1` 会压缩带入：`status / evidence / blockerCandidates`，以及最多 4 条 current contact evidence（source/target、contactCount、activeContactCount、minDistance、totalImpulse、normal）。它仍是 Physics truth 的只读快照，不产生新持久状态。详见 [`failure-attribution.md`](./failure-attribution.md)。

---

## 34. 1.23：Attributed STALL Hint 指向 Recovery Eligibility

当当前 focus mutation 是 STALL，且 compact articulation evidence 含 current-contact blocker candidates，`recoveryHints` 现在 provisional 指向 `suggestRecoveryActions(actorId,targetId,partName)`。这个 read Skill 会重新检查 contact / Policy / capability / pickup geometry；Hint 本身仍不会执行任何 world mutation。与当前 focus 无关的历史 STALL 不会覆盖 Place 等其它失败的 recovery hint。详见 [`verified-recovery.md`](./verified-recovery.md)。
