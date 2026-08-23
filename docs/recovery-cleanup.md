# Verified Recovery Cleanup / Held Blocker Placement

AgentScape 1.25 解决 1.23–1.24 pickup-blocker recovery 的直接后果：成功拿走一个 blocker 后，Agent 的唯一 Hold Anchor 被占用，下一轮即使发现新的可拾取 blocker，也会得到 `HANDS_FULL`。

1.25 不把 cleanup 做成任意 scene teleport，也不把 `dropHeld` 冒充安全清理。它建立一条窄而可验证的 world-space cleanup contract：

```text
recovery-held blocker
→ read-only cleanup plan
→ Environment-supported release point
→ original action sweep exclusion
→ Agent reachability
→ endpoint occupancy check
→ real carried-body transfer
→ Dynamic release
→ settle
→ released + settled + sweepClear + contactClear
```

只有全部 post-condition 成立，结果才是 `recovery-cleaned`。

---

## 1. Cleanup 是 Housekeeping，不是原任务成功

1.23 的核心约束保持不变：

```text
recovery mutation verified
!=
original task verified
```

1.25 再增加：

```text
recovery-cleaned
!=
original task verified
```

`cleanupRecoveryBlocker` 是 `auxiliary=true` mutation。即使它完全成功，原始 `approachAndInteract(open)` 的 unresolved failure 仍必须保留，直到原始 action 在 fresh world 中重新得到：

```text
action-completed
targetReached = true
settled = true
```

---

## 2. 为什么不能直接 `dropHeld`

普通 `dropHeld` 只保证：

```text
held ownership released
physics body restored
```

它不保证：

```text
落点远离 Door sweep
落点当前无碰撞
释放轨迹可行
落地后稳定
不再和失败 Part 接触
```

因此 1.25 没有把 `dropped` 纳入 cleanup success。

---

## 3. Recovery Provenance 是瞬态状态

`InteractionSystem` 新增：

```text
recoveryHeld: Map<actorId, {
  blockerId,
  targetId,
  partName,
  action
}>
```

它只表示：

> 当前 Agent 手里的这个 object 是由哪一次 recovery pickup 获得的。

它不是 durable Scene truth。

`heldBy` 仍然是可持久化 ownership truth；`recoveryHeld` 不进入 SceneSerializer。

---

## 4. 为什么不持久化 Recovery Provenance

保存并恢复一个 Scene 后，不能声称：

```text
这个 cup / blocker 仍然属于某个正在进行的失败恢复计划
```

因为原 planning transcript / unresolved run context 不属于 Scene state。

所以：

```text
rebuildHeldOwnership()
→ rebuild heldBy
→ recoveryHeld.clear()
```

恢复后只保留真实 ownership，不虚构历史 recovery intent。

---

## 5. Provenance 生命周期

`recoverPickupBlocker` 真正返回 `held` 后：

```text
markRecoveryHeld(actorId,...)
```

普通 release / cleanup release：

```text
releaseHeld()
→ agentHeld delete
→ recoveryHeld delete
```

Actor、blocker 或原 target 被删除时也同步清理。

---

## 6. 普通 Held Object 不会被自动 Cleanup

如果 Agent 因用户任务拿着：

```text
cup_01
```

但没有 `recoveryHeld` provenance，`suggestRecoveryActions` 即使遇到 `HANDS_FULL` 也不会生成：

```text
cleanupRecommended
```

否则 Runtime 会擅自把用户任务物体当垃圾清理掉。

---

## 7. `suggestRecoveryCleanup` 是纯只读 Skill

新增：

```text
suggestRecoveryCleanup(
  actorId,
  targetId,
  partName?,
  blockerId?,
  action?
)
```

它只调用：

```text
InteractionSystem.findRecoveryCleanupPlan()
```

不会修改 Scene / Physics / History。

---

## 8. Cleanup 不复用 `SpatialSystem.findFreeSpace()`

现有 `findFreeSpace()` 的语义是：

```text
在一个有 Manifest surface 的 support object 上找 placement grid
```

Recovery cleanup 的问题不同：

```text
把 blocker 放到 world 中一个安全、不妨碍原 action 的位置
```

很多目标是：

```text
Environment floor
```

而不是 table surface。

因此 1.25 没有扭曲 `findFreeSpace()` 的 contract。

---

## 9. World-space Support 来自 Rapier Raycast

Cleanup candidate 通过：

```text
PhysicsSystem.raycast()
```

从候选 XZ 上方向下射线。

只接受：

```text
hit.environment = true
```

所以 release 高度来自当前 Rapier Environment truth，而不是：

```text
y = 0
visual floor guess
Three mesh-only surface
```

---

## 10. Release Candidate 围绕 Original Action Sweep 生成

先调用已有：

```text
actionSweepBounds(targetId, action, partName)
```

然后在 sweep AABB 外部生成固定 8 个 perimeter candidates：

```text
left / right / front / back
+ 4 corners
```

偏移会考虑 held blocker 当前 AABB half-size 与 sweep margin。

---

## 11. Candidate 不移动 Object 来试位置

Planner 不会：

```text
teleport blocker
→ 看看会不会碰撞
→ 再放回去
```

它根据当前 blocker root pose 与 Three bounds 计算 prospective AABB。

如果这个 AABB 进入 expanded action sweep，candidate 直接拒绝。

---

## 12. Endpoint Occupancy 与 Motion Sweep 分层

1.25 从已有 `bodyMotionClear()` 中抽出：

```text
PhysicsSystem.bodyPoseClear()
```

`bodyPoseClear()` 只回答：

> carried body 如果处于这个最终 pose，当前是否与其它 Physics collider 重叠？

它使用与 carry 相同的 Rapier `intersectionsWithShape()` truth。

---

## 13. `bodyMotionClear()` 没有复制 Physics Truth

原来 `bodyMotionClear()` 同时：

```text
castShape path sweep
+ endpoint intersectionsWithShape
```

现在只是：

```text
path castShape
→ bodyPoseClear(endpoint)
```

因此 Physics endpoint occupancy 仍只有一份实现。

---

## 14. Planner 只检查 Endpoint

Cleanup proposal 阶段，Agent 尚未站到 release stance。

如果直接从当前 held pose 对每个 candidate 做完整 body motion sweep，会把“未来 Agent 会先导航到正确 stance”错误当成 blocker path。

因此 planner 使用：

```text
bodyPoseClear(release)
```

只确认 release endpoint 本身当前可占用。

---

## 15. Executor 才检查完整 Transfer

真正 `cleanupRecoveryBlocker` 到达目标 stance 后，再执行完整：

```text
transferHeldToRelease()
```

它使用：

```text
bodyMotionClear()
```

逐段验证实际 carried-body trajectory。

---

## 16. Place 与 Cleanup 共用同一 Transfer Helper

1.25 把 `approachAndPlace()` 原来的三段 release motion 抽成：

```text
transferHeldToRelease(actorId, heldId, release)
```

路径仍然是：

```text
current held pose
→ vertical lift
→ horizontal traverse
→ final release pose
```

Place 与 Recovery Cleanup 都调用它。

---

## 17. 每一段都是真实 Rapier Shape Motion

每一段调用：

```text
PhysicsSystem.bodyMotionClear()
```

如果任何一段 blocked：

```text
restore original held pose
→ return TRANSFER_BLOCKED
```

不会把 held object 留在半途。

---

## 18. Lift 不会先把物体向下压

Shared transfer 的 lift Y：

```text
max(
  currentHeldY,
  releaseY + objectHeight + 0.08
)
```

所以如果当前 Hold Anchor 已经更高，第一段保持当前高度，不会为了固定公式先把物体降下来。

---

## 19. Cleanup Stance 仍由 Navigation Truth 决定

对每个 release candidate，Planner 生成：

```text
current pose
+ 8 个 release 周围的 stance
```

非 current stance 必须通过：

```text
NavigationSystem.findPath()
```

要求：

```text
reachable = true
end.snapped exists
```

---

## 20. Agent 自己也不能站进 Original Action Sweep

即使 blocker release 点安全，如果 Agent stance 占据 Door sweep，下一步 retry 仍会失败。

所以 cleanup plan 同样检查：

```text
actionSweep.box
intersects actorBoxAt(candidate stance)
```

有交集则拒绝。

---

## 21. Release Range 预留 Locomotion Margin

Planner 使用：

```text
releaseDistance
<=
DEFAULT_INTERACTION_DISTANCE
-
DEFAULT_WAYPOINT_TOLERANCE
```

即：

```text
1.5m - 0.18m
```

真正到达后仍用原始 1.5m guard 重新检查。

没有放宽交互规则。

---

## 22. Deterministic Cleanup Ranking

多个 cleanup plan 按：

```text
1. routeCost ASC
2. releaseDistance ASC
3. stable release coordinate string
```

排序。

这只是 cleanup execution cost，不是 causal ranking。

---

## 23. Execution-time Revalidation

`cleanupRecoveryBlocker()` 第一轮 plan 可能要求导航。

Agent 到达后必须再次：

```text
findRecoveryCleanupPlan()
```

并要求新的 plan 已经是：

```text
pose.status = current-pose
```

否则返回：

```text
CLEANUP_PLAN_CHANGED
```

不会执行历史计划。

---

## 24. Held Reorientation 复用现有 Carry Truth

真正 transfer 前使用：

```text
reorientHeldToward()
```

它逐步旋转 Agent，并对 held body 每一步调用 `bodyMotionClear()`。

如果转身过程中 blocker 会撞环境：

```text
CARRY_REORIENT_BLOCKED
```

cleanup 不继续。

---

## 25. Release 后恢复 Dynamic Physics

Cleanup 调用：

```text
releaseHeld(blockerId, 'RECOVERY_CLEANUP_RELEASE')
```

因此 blocker 不再是 kinematic held body，而恢复自己的 Dynamic body contract。

---

## 26. Settle Owner 仍然只有一个

1.18 已经有：

```text
InteractionSystem.settleTasks
```

1.25 没新增：

```text
CleanupSettleManager
RecoveryPhysicsService
```

而是将 settle task 增加：

```text
kind = place | recovery-cleanup
```

底层 motion-stability loop 仍然只有 `updatePlacementSettles()` 一处。

---

## 27. Place Verifier 保持原 Contract

Place settle 仍然要求：

```text
slow/sleeping
+ supportStatus.on
```

成功：

```text
placed
supportVerified = true
settled = true
```

1.25 没改变这个 truth。

---

## 28. Cleanup Verifier

Cleanup settle 经过同一 motion stability 后，再验证：

```text
released
settled
sweepClear
contactClear
```

全部成立：

```text
status = recovery-cleaned
```

---

## 29. `released`

必须同时满足：

```text
record.state.heldBy absent
Agent agentHeld no longer points to blocker
```

因此单纯 Physics body type 改回 Dynamic，但 ownership state 没清，不算成功。

---

## 30. `sweepClear`

重新计算当前：

```text
actionSweepBounds(targetId, action, partName)
```

然后用 blocker 的 settle 后实际 bounds 检查：

```text
!sweep.box.intersectsBox(blockerBox)
```

不是使用 planner 预测 box 冒充结果。

---

## 31. `contactClear`

重新读取：

```text
PhysicsSystem.articulationContacts(targetId, partName)
```

要求没有 external contact 的 target objectId 等于该 blocker。

所以即使 AABB 刚好在 sweep 外，但 blocker settle 后仍真实接触 Door，也不能叫 cleanup verified。

---

## 32. `recovery-cleaned` Outcome Contract

SkillRegistry 只在：

```text
status = recovery-cleaned
released = true
settled = true
sweepClear = true
contactClear = true
```

全部成立时分类：

```text
state = verified
```

缺任一字段：

```text
state = unverified
reason = POST_CONDITION_NOT_VERIFIED
```

---

## 33. Cleanup Failure States

当前区分：

```text
recovery-cleanup-blocked
recovery-cleanup-failed
recovery-cleanup-unverified
```

分别继续复用 SkillRegistry 的 blocked / failed / unverified outcome 分类。

---

## 34. `cleanup-unavailable` 不会被 Mutation 当成功

只读 planner 可以正常返回：

```text
cleanup-unavailable
```

但真正 mutating Skill `cleanupRecoveryBlocker` 若拿不到 plan，会映射成：

```text
recovery-cleanup-blocked
```

避免未知 status 被默认分类为 `accepted`。

---

## 35. `suggestRecoveryActions` 自动暴露 Cleanup Requirement

如果新 STALL candidate 本来可 pickup，但：

```text
assertAgentCarryable
→ HANDS_FULL
```

并且 Agent 当前 held object 有同一 target 的 recovery provenance，`buildRecoveryProposals()` 会额外调用：

```text
findRecoveryCleanupPlan()
```

成功时返回：

```text
status = recovery-cleanup-proposed
cleanupRecommended.tool = cleanupRecoveryBlocker
```

---

## 36. Cleanup 只在当前无 Eligible Pickup 时推荐

如果当前仍存在直接 executable recovery：

```text
eligible.length > 0
```

Runtime 不会先强迫 cleanup。

Cleanup 只解决：

```text
下一步因 recovery-held blocker 导致 HANDS_FULL
```

的情况。

---

## 37. Cleanup 后必须重新生成 Recovery Proposal

`cleanupRecommended.verification` 明确：

```text
required = replan-recovery-after-cleanup
cleanupStatus = recovery-cleaned
```

Cleanup 后不能继续使用 cleanup 前的 candidate list。

必须重新：

```text
suggestRecoveryActions
```

因为 Physics/contact/world 已经变化。

---

## 38. Duplicate Auxiliary Gate 也覆盖 Cleanup

1.23 的 evidence-epoch gate 现在同时识别：

```text
recoverPickupBlocker
cleanupRecoveryBlocker
```

两种 auxiliary mutation 都会绑定当前 original unresolved mutation，保持统一审计与 fresh-replan 纪律。

---

## 39. Settle Target Removal Lifecycle 修复

CodeGraph blast-radius 审计暴露一个旧边界：settle task 过去主要按：

```text
settle.objectId
```

取消。

如果 `targetId`（如 support table / failed cabinet）在 settle 中被删除，Promise 可能继续悬着。

现在 `beforeRemove(id)` 会取消：

```text
settle.objectId === id
OR
settle.targetId === id
```

Place 与 Cleanup 都有直接回归。

---

## 40. Real Single-cleanup E2E

真实 Rapier/Recast 测试执行：

```text
open
→ STALL
→ suggestRecoveryActions
→ recoverPickupBlocker
→ held
→ suggestRecoveryCleanup
→ cleanupRecoveryBlocker
→ real navigation
→ shared three-segment transfer
→ Dynamic release
→ settle
→ recovery-cleaned
```

随后故意不 retry Door。

期望：

```text
taskStatus = incomplete
original open unresolved remains
```

证明 cleanup success 不会洗白原任务。

---

## 41. Real Cleanup E2E Post-conditions

专项 E2E 还要求：

```text
blocker.state.heldBy absent
heldByAgent(actor) = null
recoveryHeldStatus(actor) = null
Door current contacts 不再包含 blocker
blocker actual AABB 不再 intersect Door action sweep
```

---

## 42. Two-blocker Full Recovery Chain

1.25 真实模型 probe 场景：

```text
Door first STALL
→ obstacle_01 + obstacle_02

rank #1 obstacle_02
→ pickup recovery

retry open
→ still STALL on obstacle_01
→ hands full with obstacle_02

cleanup obstacle_02
→ recovery-cleaned

fresh suggestRecoveryActions
→ obstacle_01 now eligible
→ recover obstacle_01

retry open
→ action-completed
```

---

## 43. Nemotron Cleanup Probe

```bash
npm run agent:probe -- recovery-cleanup
```

Nemotron 当前严格样本按完整链执行。

Sequence ledger 在 cleanup 后仍保持：

```text
unresolved = 1
```

最终 original open verified 后才：

```text
unresolved = 0
```

---

## 44. Muse Cleanup Probe

Muse 当前样本同样：

```text
open fail
→ ranked recovery
→ retry fail
→ cleanupRecommended
→ recovery-cleaned
→ fresh recovery proposal
→ second blocker recovery
→ original retry verified
```

没有使用 `dropHeld / moveObject / direct approachAndPickup` 绕过 cleanup contract。

---

## 45. Cleanup Proposal 与 Execution 共享同一 Policy Truth

当 `suggestRecoveryActions` 因 `HANDS_FULL` 考虑 cleanup 时，不会只做几何 preflight。它先调用：

```text
SkillRegistry.authorization(
  cleanupRecoveryBlocker,
  profile
)
```

这与真正执行 `cleanupRecoveryBlocker` 时 `SkillRegistry.invoke()` 使用的是同一个 `PolicyEngine.evaluate()` 来源。

如果 Policy 不允许：

```text
cleanupRecommended.status = denied
reason = POLICY_DENIED
```

并且不会附 executable `tool`，也不会继续执行 cleanup path / geometry search。

因此：

```text
proposal-time authorization
==
execution-time authorization source
```

没有第二套 cleanup Policy。

---

## 46. 当前 Claim

AgentScape 现在可以说：

> 当一个 verified pickup-blocker recovery 占用了 Agent Hold Anchor，而新的 failure evidence 又需要处理另一个 blocker 时，Runtime 可以只读规划一个由 Rapier Environment 支撑、远离原 action sweep、Agent 可达且 endpoint clear 的 cleanup release；显式 auxiliary cleanup 通过真实 carried-body motion、Dynamic settle，并重新验证 released/sweepClear/contactClear。Cleanup 完成后必须 fresh replan，原始任务仍只有在原 post-condition 再次 verified 时才完成。

不能说：

> AgentScape 已经拥有通用整理/收纳规划器。

---

## 47. 当前不做

1.25 没有：

```text
arbitrary object relocation planner
support-object cleanup placement
semantic tidy-up
long-term blocker storage
multi-hand manipulation
grasp-force / payload limit
IK placement
articulated blocker recovery
```

---

## 48. 下一阶段：Articulated Blocker Recovery

当前 recovery 已覆盖：

```text
Dynamic root Object blocker
→ pickup
→ cleanup
```

下一类真正不同的 blocker 是：

```text
objectId = another articulated object
partName != $root
```

它不能被整体 pickup。

下一阶段应建立 typed articulated recovery：

```text
blocking Part
→ available open/close capability
→ Policy
→ action-aware counterfactual / sweep
→ provisional articulated recovery
→ explicit approachAndInteract
→ fresh original retry
```

仍然保持：

```text
recovery action verified
!=
original task verified
```
