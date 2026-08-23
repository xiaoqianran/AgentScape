# Articulated Blocker Recovery

AgentScape 1.26 扩展 Verified Recovery，使一个 live articulated STALL 可以在严格条件下通过**另一个 articulated Part 的 verified state change**解除。

它仍然坚持：

```text
blocker Part action verified
!=
original task verified
```

原始失败动作必须 fresh-replan 后重新执行，并再次满足原 post-condition。

---

## 1. 1.25 以前的 Recovery 边界

1.23–1.25 已经覆盖：

```text
Dynamic root Object blocker
→ pickup
→ optional cleanup
→ retry original action
```

但 contact provenance 也可能指向：

```text
kind = object
partName = door / drawer / slider
```

这样的 blocker 不能被整体 pickup，也不应该被 generic `moveObject` teleport。

---

## 2. 1.26 的最小支持范围

当前只支持 blocker Part 的：

```text
open
close
```

并且必须满足：

```text
current active contact still exists
blocker Part exists in Manifest
Part has joint + physics + targets
current verifiedAction exists
requestedAction = null
Part is not moving
exactly one alternate executable open/close action exists
Policy allows recoverArticulatedBlocker
findInteractionPose(action, partName) succeeds
```

任一条件不满足，都不会生成 executable proposal。

---

## 3. 为什么必须有 `verifiedAction`

Motor request 不是 world fact。

因此 proposal 不读取：

```text
requestedAction
```

来猜 blocker 当前状态，而是要求：

```text
articulationStatus().verifiedAction
```

已经存在。

如果没有：

```text
ARTICULATED_STATE_UNVERIFIED
```

---

## 4. Moving Part 不进入 Recovery

如果：

```text
requestedAction != null
OR
status = moving
```

返回：

```text
ARTICULATED_ACTION_PENDING
```

Runtime 不会在一个尚未 settle 的 blocker joint 上叠加第二个恢复动作。

---

## 5. Alternate Action 来自 Manifest Executable Truth

候选 action 必须同时满足：

```text
part.actions includes action
manifest.actions includes action
part.targets[action] is finite
```

并且当前只接受：

```text
open / close
```

不会根据 action 名字符串以外的语义自行推断未知 target。

---

## 6. 当前只接受唯一 Alternate Action

例如：

```text
verifiedAction = open
Part actions = [open, close]
```

唯一 alternate：

```text
close
```

可以继续 preflight。

如果没有 alternate：

```text
NO_ALTERNATE_ARTICULATED_ACTION
```

如果有多个：

```text
AMBIGUOUS_ARTICULATED_RECOVERY
```

1.26 不让 LLM 在多个 action 中猜一个。

---

## 7. Current Contact 必须重新验证

Failure-time attribution 仍然只是历史 snapshot。

`buildRecoveryProposals()` 会重新调用：

```text
PhysicsSystem.articulationContacts(
  originalTarget,
  originalPart
)
```

如果 blocker Part 已不再是 current external contact：

```text
CONTACT_EVIDENCE_STALE
```

不会继续 action recovery。

---

## 8. Policy 仍只有一个 Truth

Proposal 使用：

```text
SkillRegistry.authorization(
  recoverArticulatedBlocker,
  profile
)
```

Execution 仍由同一 SkillRegistry / PolicyEngine 重新授权。

Policy denied：

```text
status = denied
reason = POLICY_DENIED
```

并且不会继续 interaction-pose preflight。

---

## 9. Interaction Preflight 复用现有 Runtime

1.26 没有新的 articulated recovery geometry planner。

它直接调用：

```text
findInteractionPose(
  actorId,
  blockerId,
  {
    action: blockerAction,
    partName: blockerPartName
  }
)
```

因此继续复用：

```text
Detour reachability
1.5m interaction range
Rapier LOS
actionSweepBounds
Agent body clearance
```

---

## 10. Proposal 仍是 Provisional

Eligible proposal：

```text
recovery = articulated-blocker
status = provisional
```

并携带：

```text
blockerState
blockerAction
currentContact
Policy evidence
interaction pose
route cost
original retry contract
```

Proposal 不是执行结果。

---

## 11. `recoverArticulatedBlocker`

真正 mutation 使用专用 Skill：

```text
recoverArticulatedBlocker(
  actorId,
  original targetId,
  original partName,
  blockerId,
  blockerPartName,
  blockerAction
)
```

它是：

```text
mutates = true
barrier = true
batchable = false
auxiliary = true
tracksUnresolved = false
```

---

## 12. 为什么不用普通 `approachAndInteract(blocker)` 直接恢复

普通 `approachAndInteract` 是用户任务 mutation。

如果直接把 blocker action 当普通 mutation：

```text
blocker action failure
→ 会进入用户 unresolved ledger
```

这会把恢复手段变成新的独立用户任务债务。

专用 auxiliary wrapper 保持：

```text
original task identity
!=
recovery helper identity
```

---

## 13. Execution-time Revalidation

`recoverArticulatedBlocker` 不信任旧 proposal。

执行前重新：

```text
buildRecoveryProposals()
```

并要求同一个：

```text
blockerId
blockerPartName
blockerAction
```

仍然 eligible。

否则：

```text
status = recovery-stale
```

且不会调用 `approachAndInteract`。

---

## 14. 真正执行仍只有 `approachAndInteract`

通过 revalidation 后 wrapper 调用：

```text
InteractionSystem.approachAndInteract(
  actorId,
  blockerId,
  blockerAction,
  { partName:blockerPartName }
)
```

所以：

```text
navigation
LOS
action sweep
motor request
live joint observer
STALL / TIMEOUT
verified state promotion
```

全部仍由原 Runtime owner 负责。

---

## 15. Recovery Success 的含义

只有 blocker action 返回：

```text
action-completed
targetReached = true
settled = true
```

SkillRegistry 才把 auxiliary recovery 判为 verified。

这只表示：

> blocker Part 已经真实到达指定 alternate state。

不是：

> 原任务已经恢复成功。

---

## 16. Original Unresolved 必须保留

序列：

```text
A.open → STALL
unresolved = 1

recoverArticulatedBlocker(B.close)
→ verified
unresolved = 1
```

只有：

```text
A.open retry
→ action-completed
```

才：

```text
unresolved = 0
```

---

## 17. Duplicate Recovery Gate 同样适用

同一 original failure evidence epoch 中：

```text
recoverArticulatedBlocker(B.door, close)
→ verified
```

如果模型在没有 retry original action 前再次请求同一 recovery：

```text
RECOVERY_ALREADY_APPLIED
```

第二次不会进入 `tools.call()`，也不会再次改变 blocker joint。

---

## 18. Recovery Identity

Articulated recovery identity 包含：

```text
actorId
original targetId
original partName
blockerId
blockerPartName
blockerAction
```

因此：

```text
B.door close
!=
B.drawer close
!=
B.door open
```

Trace 不会把不同 Part/action 混成同一次辅助恢复。

---

## 19. Mixed Recovery Ranking

1.26 将 ranking strategy 从 pickup-only 名称升级为：

```text
eligible-recovery-route-cost-v2
```

它可以同时比较：

```text
pickup-blocker
articulated-blocker
```

排序仍然只是 executable recovery 的 route cost：

```text
causal = false
```

不会把 rank-1 叫做“最可能根因”。

---

## 20. Real Two-cabinet Physics Fixture

真实 E2E 使用：

```text
cabinet_A
position = [0,0,0]

cabinet_B
position = [-2.2,0,1]
yaw = +90°
```

初始化时先让：

```text
B.door → real open target -1.35
```

并等待 Physics 验证 error < tolerance。

随后：

```text
A.door open
→ stalls around -1.02
→ current contact target = B.door
```

不是 mock collision。

---

## 21. Real Recovery Chain

真实 Rapier/Recast/Agent E2E：

```text
Agent approach A
→ A.open
→ STALL
→ contact B.door

suggestRecoveryActions
→ B.door verifiedAction=open
→ unique alternate=close
→ Policy allow
→ interaction/action sweep preflight

recoverArticulatedBlocker
→ Agent real approach B
→ B.close
→ action-completed

fresh replan
→ retry A.open
→ action-completed
```

最终 A=open，B=close。

---

## 22. Arrival Correction：不放宽 Action Sweep

真实两柜 E2E 还暴露一个连续执行误差：

```text
planned safe stance
→ Locomotion default arrival tolerance 0.18m
→ actual body stops ~0.15m before plan
→ actual body enters original Door action sweep
```

最初尝试全局扩张 planner sweep，会改变 1.25 pickup/cleanup 的 stance selection，因此被撤销。

最终实现只在：

```text
normal approach 已 arrived
AND
final exact sweep 发现 Agent 因 arrival drift 挡住动作
```

时，对同一个已规划 safe pose 做一次：

```text
waypointTolerance = 0.05m
```

的 correction navigation。

然后重新检查：

```text
range
LOS
exact action sweep
```

最终 sweep guard 没有放宽。

---

## 23. Arrival Correction 不是 Recovery 特判

该修复位于：

```text
InteractionSystem.approachAndInteract
```

因此普通 articulated interaction 也获得同样的执行精度修正。

但只在 final sweep 实际失败时触发，不改变正常 1.25 stance selection。

---

## 24. Policy Denied Regression

一个 otherwise executable articulated candidate，如果：

```text
recoverArticulatedBlocker permission denied
```

必须：

```text
eligible = false
status = denied
reason = POLICY_DENIED
```

并且不调用 `findInteractionPose`。

---

## 25. Execution-time Stale Regression

即使历史 STALL attribution 仍保存 B.door，如果 execution round 当前 contact 已不存在：

```text
recoverArticulatedBlocker
→ recovery-stale
→ CONTACT_EVIDENCE_STALE
```

并且真正 blocker interaction 不会执行。

---

## 26. Unverified / Pending / Ambiguous Regressions

专项测试要求：

```text
verifiedAction missing
→ ARTICULATED_STATE_UNVERIFIED

requestedAction != null / moving
→ ARTICULATED_ACTION_PENDING

multiple alternate executable open/close
→ AMBIGUOUS_ARTICULATED_RECOVERY
```

都不能进入 executable proposal。

---

## 27. Real Nemotron Probe

新增：

```bash
npm run agent:probe -- recovery-articulated
```

当前 Nemotron 严格样本：

```text
A.open → STALL
suggestRecoveryActions
recoverArticulatedBlocker(B.door, close)
A.open retry
→ verified
```

没有直接操作 B 绕过 wrapper。

---

## 28. Real Muse Probe

Muse 当前样本执行同一顺序，并明确区分：

```text
B.close recovery verified
```

与：

```text
A.open original retry verified
```

最终 taskStatus 才为 completed。

---

## 29. 当前 Claim

AgentScape 现在可以说：

> 当一个 live articulated STALL 的 current-contact blocker 指向另一个 articulated Part，且该 Part 当前 verified state 明确、没有 pending request、Manifest 中恰好存在一个 alternate executable open/close action、Policy 允许并且具身 interaction/action-sweep preflight 可执行时，Runtime 能生成 provisional articulated recovery，使用专用 auxiliary wrapper 在执行时重新验证条件并真实改变 blocker Part；随后只有原始 action 重新通过 post-condition verification，任务才算恢复成功。

不能说：

> AgentScape 已经能在多个可能 articulated recovery actions 中自动证明最佳动作。

---

## 30. 下一阶段：Counterfactual Articulated Recovery

当前如果：

```text
alternateActions.length > 1
```

Runtime 明确拒绝。

下一阶段才应该研究：

```text
multiple executable blocker actions
→ deterministic counterfactual evidence
→ action sweep / contact change prediction
→ non-causal action ranking
→ one auxiliary action
→ original retry verification
```

仍然禁止让 LLM 在没有 Runtime evidence 时自行选择。
