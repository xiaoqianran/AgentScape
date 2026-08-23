# Verified Recovery Action / Blocker-aware Replan

AgentScape 1.23 在 1.22 的 contact blocker evidence 上增加第一条**可执行但非常窄**的恢复闭环。

目标不是“Agent 自动搬走所有障碍物”，而是证明下面这个 contract 可以成立：

```text
original action
→ verified failure
→ blocker evidence
→ read-only recovery proposal
→ one legal auxiliary mutation
→ fresh world re-observation
→ retry original action
→ original post-condition verified
```

只有最后一步 verified，原任务才算恢复成功。

---

## 1. 1.22 已经知道什么

1.22 可以得到：

```text
Door open
→ action-failed / STALL
→ current-contact-at-failure
→ obstacle_03 blocker candidate
```

但 candidate 只表示：

> STALL 发生时，这个 collider 正与失败 Part 发生 active Rapier contact。

它不回答：

```text
是否允许改变 blocker？
blocker 是否具备可执行 recovery capability？
Agent 当前是否真的拿得到它？
recovery 后原动作是否真的恢复？
```

1.23 只解决这四个问题的第一条窄路径。

---

## 2. 为什么不用通用 `moveObject`

Editor 的 `moveObject` 是通用 scene edit。

它可以技术上移动很多 fixed furniture，因为 Editor 的目标是编辑世界。

Recovery eligibility 不能因此推导：

```text
move action exists
→ Agent 可以自动移动它
```

这会让：

```text
fixed cabinet
fixed table
environment architecture
```

错误地变成具身 recovery object。

所以 1.23 不使用 generic teleport recovery。

---

## 3. 第一条 Recovery 只支持具身 Pickup

当前唯一可执行 proposal：

```text
pickup-blocker
```

要求 blocker：

```text
kind = object
partName = $root
current contact 仍存在
pickup + drop capability
root physics body = dynamic
无 articulated Parts
carry collider 当前受支持
actor hold anchor 当前受支持
actor hands 可用
Policy 允许 recoverPickupBlocker
pickup geometry preflight clear
```

任何一项不满足都不产生 executable proposal。

---

## 4. Environment 永远不会进入这个 Recovery

如果 blocker candidate：

```text
kind = environment
```

结果：

```text
eligible = false
reason = ENVIRONMENT_IMMOVABLE
```

不会生成：

```text
move environment
pickup environment
remove environment
```

真实 E2E 对 fixed Environment blocker 要求零 recovery mutation。

---

## 5. Articulated blocker 当前也不自动恢复

如果 candidate 指向：

```text
object + non-root Part
```

返回：

```text
ARTICULATED_PART_RECOVERY_UNSUPPORTED
```

因为它可能需要：

```text
open another door
close a drawer
change another joint
```

这属于下一阶段的 multi-action recovery，不应偷换成搬整个 object。

---

## 6. `suggestRecoveryActions` 是只读 Skill

新增：

```text
suggestRecoveryActions(
  actorId,
  targetId,
  partName?
)
```

它：

```text
不修改 Physics
不修改 Scene
不打开 History transaction
不清 unresolved mutation
```

输出仍然是：

```text
status = provisional
```

---

## 7. Proposal 会重新检查 Current Contact

1.22 保存的是 failure-time evidence。

但 recovery planning 发生在未来 planning round。

期间 world 可能已经变化。

所以 proposal 不只读历史：

```text
last.attribution.blockerCandidates
```

还会重新调用：

```text
PhysicsSystem.articulationContacts()
```

只有 candidate 仍出现在 current external contacts 中才继续。

否则：

```text
status = stale
reason = CONTACT_EVIDENCE_STALE
```

---

## 8. 为什么 Stale Revalidation 是必需的

真实开发 E2E 第一版使用一个很轻的 Dynamic blocker。

结果：

```text
Door motor
→ STALL evidence
→ 下一 planning round 前
→ blocker 已被 Physics 冲到几十米外
```

如果照旧 evidence 继续执行 pickup：

```text
Agent 会追逐一个已经不再阻挡 Door 的物体
```

1.23 因此明确：

```text
failure-time candidate
!=
current recovery eligibility
```

---

## 9. Policy 也必须在 Proposal 阶段参与

新增 SkillRegistry 内部只读：

```text
authorization(skillName, context)
```

它复用与真实 `invoke()` 相同的 PolicyEngine decision。

所以 proposal 可以提前返回：

```text
status = denied
reason = POLICY_DENIED
missing = [...]
```

而不是先给模型一个“可执行” proposal，再到执行时才发现权限不够。

---

## 10. Authorization 不是第二套 Policy

`authorization()` 没有新的 permission model。

仍然只调用：

```text
PolicyEngine.evaluate()
```

`SkillRegistry.invoke()` 本身也改为复用同一个 authorization 入口。

所以：

```text
proposal-time policy
==
execution-time policy source
```

---

## 11. Capability Truth 来自现有 Carry Contract

Recovery 没有自己写一套：

```text
isMovableBlocker()
```

而是直接复用：

```text
InteractionSystem.assertAgentCarryable()
```

它已经验证：

```text
pickup/drop capability
dynamic body
non-articulated
supported collider shape
supported rotations
valid hold anchor
held ownership / hands-full
```

所以 recovery capability 与普通 Agent pickup 是同一个 truth。

---

## 12. Capability 合法仍然不够

真实 recovery E2E 第二个反例：

```text
blocker Manifest 可携带
Policy 允许
```

但真正 `approachAndPickup` 时：

```text
PICKUP_TRANSFER_BLOCKED
```

说明：

```text
capability eligibility
!=
current geometric executability
```

因此 proposal 必须做 pickup geometry preflight。

---

## 13. `findPickupPlan()`

1.23 把原本散在 `approachAndPickup()` 中的 pickup geometry 收敛为：

```text
InteractionSystem.findPickupPlan()
```

它只读计算：

```text
interaction pose
facing yaw
predicted hold anchor
Rapier body-motion transfer clearance
```

Suggestion 与真正 execution 共用这一套 plan contract。

---

## 14. Pickup Plan 会主动面向目标

旧 pickup 最终 hold anchor 会受到最后一段 navigation 朝向影响。

1.23 改成：

```text
candidate Agent position
→ face target center
→ compute HoldAnchor world pose
→ test transfer
```

真正到达后也重新：

```text
face current target
→ recompute actual HoldAnchor
→ real bodyMotionClear
```

不是用 planner preview 冒充实际 execution。

---

## 15. Candidate 必须 Transfer-clear

`findInteractionPose()` 已支持 `candidateFilter`。

Pickup Plan 现在只接受：

```text
Detour reachable
+ interaction LOS/range
+ predicted pickup transfer clear
```

的候选。

所以不会再单纯选择：

> 路径最短，但拿不出来的一侧。

---

## 16. Pickup 也要预留 Locomotion Arrival Margin

连续 recovery 测试再次证明：

```text
planned legal pose
!=
actual exact final body position
```

Locomotion 有：

```text
DEFAULT_WAYPOINT_TOLERANCE = 0.18m
```

因此 pickup candidate 使用：

```text
plannedMaxDistance
=
1.5m - waypointTolerance
```

真正 arrival 后仍使用原始：

```text
1.5m interaction guard
```

规则没有放宽。

---

## 17. Proposal 的 Preflight

Eligible pickup proposal 会带：

```text
preflight.pose
preflight.transfer.clear = true
```

这是 planner-time evidence。

它不保证 execution 一定成功，因为：

```text
world may change
agent may stop at a different physical pose
blocker may move
```

所以 execution 必须重新验证。

---

## 18. Proposal 明确给出 Original Retry Contract

一个 proposal 不只说：

```text
recoverPickupBlocker(obstacle_03)
```

还带：

```text
verification.required
= retry-original-post-condition

verification.tool
= approachAndInteract

verification.args
= original actor / target / action / Part
```

以及成功要求：

```text
action-completed
targetReached = true
settled = true
```

---

## 19. 专用 `recoverPickupBlocker`

真正 mutation 使用：

```text
recoverPickupBlocker(
  actorId,
  targetId,
  partName,
  blockerId
)
```

而不是让模型直接调用普通：

```text
approachAndPickup(blockerId)
```

原因是 recovery 执行前必须重新验证：

```text
原 failure 仍是 STALL
candidate 仍存在
current contact 仍存在
Policy 仍允许
pickup plan 仍可执行
```

---

## 20. Recovery Tool 执行前再次生成 Proposal

`recoverPickupBlocker` handler 第一件事就是重新：

```text
buildRecoveryProposals()
```

再寻找指定 `blockerId`。

如果已经失效：

```text
status = recovery-stale
```

不会强行执行历史 proposal。

---

## 21. `recovery-stale` 是 No-op Outcome

SkillRegistry 将：

```text
status = recovery-stale
```

分类为：

```text
state = noop
verified = false
```

它仍然触发 mutation barrier / fresh replan，因为这是一次 recovery attempt。

但它不会被误叫 verified recovery。

---

## 22. 为什么 Recovery 是 Auxiliary Mutation

新增 Skill metadata：

```text
auxiliary = true
```

`recoverPickupBlocker` 仍然：

```text
mutates = true
barrier = true
batchable = false
```

所以它没有绕过：

```text
History transaction
fresh replan
Skill policy
Trace
```

`auxiliary` 只影响任务 ledger。

---

## 23. Auxiliary 不进入 User Task Unresolved Ledger

如果 recovery 本身失败：

```text
recoverPickupBlocker
→ pickup-blocked
```

不会新增一个永久用户子目标：

```text
“你还欠一个 pickup blocker 任务”
```

因为用户真正的任务是：

```text
open cabinet
```

Recovery 只是实现该任务的辅助动作。

---

## 24. Original Failure 仍然保留

初始：

```text
approachAndInteract(open)
→ STALL
→ unresolved = 1
```

执行 recovery 后：

```text
recoverPickupBlocker
→ held / verified
```

仍然要求：

```text
unresolved = 1
```

不会因为 blocker 被拿起来就把 open failure 清掉。

---

## 25. Recovery Verified 仍然不是 Task Completed

直接 sequencing test 锁住：

```text
open → STALL
recoverPickupBlocker → held
LLM 直接 final
```

结果必须：

```text
taskStatus = incomplete
unresolved = original open failure
```

这是一条核心 contract。

---

## 26. 只有 Original Retry 可以清 Ledger

下一 planning round重新：

```text
approachAndInteract(
  same actor,
  same target,
  same action,
  same canonical Part
)
```

并返回：

```text
action-completed
+ targetReached
+ settled
```

ToolCallingAgent 才会删除同一 mutation identity 的 unresolved failure。

---

## 27. Auxiliary Recovery Failure 也不会污染最终成功

另一个 direct test：

```text
open → STALL
aux recovery → blocked
retry same open → verified
```

最终：

```text
taskStatus = completed
```

因为 recovery failure 本身不是用户独立子目标。

当然，这不表示 recovery 成功；只表示世界后来允许原动作真正完成。

---

## 28. Recovery Identity 仍然可审计

即使 auxiliary 不进入 unresolved ledger，Trace identity 仍包含：

```text
actorId
targetId
partName
blockerId
```

不同 blocker recovery 不会在审计记录中合并成同一 identity。

---

## 29. Real Dynamic Blocker E2E

真实测试 world：

```text
agent_01
cabinet_01
blocker_01
Rapier floor
Recast navigation
```

`blocker_01` 是一个普通 Dynamic cylinder test fixture：

```text
mass = 10
friction = 5
```

这些参数只用于构造一个在 Door STALL 后仍保持 contact 的稳定测试场景；AgentScape 当前没有基于 mass 的 grasp-force capability claim。

---

## 30. Real Recovery Success Chain

真实 E2E：

```text
approachAndInteract(open)
→ real locomotion
→ Door STALL
→ current blocker provenance

suggestRecoveryActions
→ current-contact recheck
→ Policy allow
→ carry capability
→ pickup plan clear
→ provisional recoverPickupBlocker

recoverPickupBlocker
→ fresh proposal revalidation
→ real approachAndPickup
→ blocker held
→ auxiliary verified

fresh replan

approachAndInteract(open)
→ real retry
→ action-completed
→ targetReached
→ settled
→ original unresolved cleared
```

最终：

```text
taskStatus = completed
```

---

## 31. Real Environment Ineligible E2E

另一条真实 Rapier E2E：

```text
Door
↔ fixed Environment blocker
→ STALL
```

`suggestRecoveryActions` 必须：

```text
recovery-unavailable
ENVIRONMENT_IMMOVABLE
```

并断言：

```text
zero recovery mutation
state.parts.door = close
taskStatus = incomplete
original open unresolved remains
```

---

## 32. 为什么测试过一个会被 Door 打飞的 Blocker

开发过程中轻量 Dynamic blocker 会发生：

```text
STALL snapshot
→ Door impulse
→ blocker 被冲开
→ recovery execution 时 contact 已 stale
```

这个失败非常有价值。

它证明 execution-time revalidation 不是理论防御，而是实际必需。

因此没有删除 stale guard 来让 happy path 通过。

---

## 33. 为什么没有用极端重物伪造 Recovery

参数实验发现非常重的 Dynamic body 更容易保持 contact。

但用数百公斤 blocker 来证明“可 pickup recovery”会让测试语义失真，因为当前 carry 还没有 grasp force / payload limit。

最终使用较普通的 test fixture，并把 mass 明确标记为测试条件而不是 Agent capability。

---

## 34. Real Nemotron Recovery Probe

新增：

```bash
npm run agent:probe -- recovery
```

当前 Nemotron 样本执行：

```text
approachAndInteract
→ STALL

suggestRecoveryActions
→ eligible recoverPickupBlocker

recoverPickupBlocker
→ held / auxiliary verified

approachAndInteract retry
→ action-completed

final
```

任务最终：

```text
taskStatus = completed
unresolved = 0
```

---

## 35. Real Muse Recovery Probe

Muse 当前样本执行同一严格链：

```text
open failure
→ suggestion
→ auxiliary recovery
→ original retry
→ verified completion
```

它在最终回答中明确区分：

```text
blocker held
```

与：

```text
original cabinet open verified
```

没有在 recovery 后提前宣布任务完成。

---

## 36. Probe 禁止 Bypass

Recovery probe 禁止：

```text
low-level open
low-level pickup
low-level place
moveObject
navigateTo manual decomposition
direct approachAndPickup blocker
```

必须使用：

```text
suggestRecoveryActions
→ recoverPickupBlocker
```

这样真实模型 smoke 测的是 recovery contract，不是“模型会不会随便搬东西”。

---

## 37. 当前不会自动选择多个 Candidate

如果 STALL 有多个：

```text
blockerCandidates[]
```

1.23 可以逐个判断 eligibility，但没有：

```text
causal ranking
cost ranking
multi-blocker plan
```

LLM 可以读取 proposals，但 Runtime 不声称知道最佳候选。

---

## 38. 当前不会自动 Drop 已拿走的 Blocker

`recoverPickupBlocker` 成功后 blocker 处于：

```text
heldBy = agent
```

这本身已经让它离开原 Door contact，并通过 carry collision 继续参与 Physics。

1.23 不自动寻找“永久放置 blocker 的新位置”。

这属于后续 recovery cleanup / placement policy。

---

## 39. 当前没有 Payload / Grasp Force Verification

和 1.17 一样：

```text
held
```

表示：

```text
kinematic-anchor ownership
```

不是：

```text
grip force verified
payload mass verified
stable grasp wrench verified
```

所以 recovery eligibility 当前只覆盖已有 carry geometry contract。

---

## 40. 当前 Claim

AgentScape 现在可以说：

> 对于一个由 live articulated STALL 归因得到、当前仍接触失败 Part、Policy 允许且满足现有具身 carry / pickup geometry contract 的 Dynamic root Object blocker，Runtime 可以生成 provisional recovery proposal，显式执行辅助 pickup recovery，并在 fresh replan 后通过重新验证原始 articulation post-condition 决定任务是否真正恢复。

不能说：

> AgentScape 已经能自动解决任意物理失败。

---

## 41. 当前不做

1.23 没有：

```text
generic object relocation recovery
environment editing recovery
articulated blocker action recovery
multi-blocker ranking
recovery search tree
payload / force limits
IK / grasp planning
automatic blocker placement
causal root-cause proof
```

---

## 42. 下一阶段：Recovery Generalization

下一阶段更合理的是扩展“合法 recovery 类型”，而不是增加 Planner 框架：

```text
multiple blocker candidates
→ typed eligibility

movable pickup object
→ pickup recovery

articulated blocker
→ candidate open/close recovery

navigation blocker
→ action-aware route recovery

Environment
→ explicit ineligible
```

所有 recovery 仍必须遵守：

```text
proposal != execution
execution != original success
original post-condition verified
== task recovery success
```

---

## 43. Duplicate Recovery Gate

最终 release probe 又暴露一个模型采样边界：LLM 可能在 `recoverPickupBlocker` 已经 verified 后，再次请求同一个 recovery，而没有先 retry 原始失败动作。Prompt 中“execute at most one recovery mutation”不能作为 Runtime 安全保证。

1.23 最终版因此在 ToolCallingAgent 内维护仅限单次 run 的：

```text
appliedAuxiliaryRecoveries
  originalMutationIdentity
    → Set<recoveryMutationIdentity>
```

第一次 auxiliary recovery verified 后，绑定到当前 unresolved original mutation。若同一 failure evidence epoch 中再次请求同一 recovery：

```text
status = not-executed
reason = RECOVERY_ALREADY_APPLIED
```

并强制 fresh replan；不会再次进入 `tools.call()`，也不会再次改变世界。

当同一 original mutation 真正 retry 时，不论 retry verified 还是再次 STALL，都视为产生新 world evidence，清除该 original identity 的 applied-recovery gate。若 retry 再次失败，之后允许基于新 evidence 重新评估并执行同一 recovery。

Recovery identity 还会从 original unresolved identity canonicalize 缺省 `partName`，因此模型从：

```text
recoverPickupBlocker(... partName=door, blockerId=obstacle_03)
```

切换成：

```text
recoverPickupBlocker(... blockerId=obstacle_03)
```

仍被识别为同一个 semantic recovery；不同 `blockerId` 仍保持不同审计 identity。
