# Counterfactual Articulated Recovery

AgentScape 1.27 解决 1.26 留下的一个窄问题：

```text
同一个 articulated blocker Part
当前 verified state 已知
但存在多个 alternate executable open/close
```

1.26 会明确返回：

```text
AMBIGUOUS_ARTICULATED_RECOVERY
```

1.27 不把选择权交给 LLM，而是增加一层**确定性的、非因果的几何反事实证据**。

---

## 1. 目标

当前只回答：

> 如果 blocker Part 到达某个 alternate target pose，它在 Three.js 几何上是否更少占据 original failed action sweep？

不回答：

> 这个动作是否已被证明是物理根因的最佳恢复动作？

所以所有 action ranking 都明确：

```text
causal = false
geometry = three-aabb
```

---

## 2. 仍然要求 Current Contact

Counterfactual 不是脱离 failure truth 的离线猜测。

入口仍必须来自：

```text
original action-failed / STALL
→ current-contact-at-failure
→ articulated blocker candidate
```

Proposal round 仍重新读取：

```text
PhysicsSystem.articulationContacts()
```

如果 contact 已 stale，后续 action ranking 不会执行。

---

## 3. Current Part State 仍必须 Verified

Blocker Part 必须：

```text
verifiedAction != null
requestedAction = null
status != moving
```

Counterfactual ranking 不会拿一个 request-only / moving joint 当确定起点。

---

## 4. 单 Alternate Action 不改变 1.26 Contract

如果：

```text
alternateActions.length = 1
```

继续使用 1.26 原逻辑：

```text
Policy
→ findInteractionPose(action, partName)
→ provisional recoverArticulatedBlocker
```

不会为了 1.27 强制增加不必要的 counterfactual gate。

---

## 5. 多 Alternate Action 才进入 Counterfactual Ranking

如果：

```text
alternateActions.length > 1
```

Runtime 先构造：

```text
original failed action sweep
current blocker target-pose bounds
每个 alternate target-pose bounds
每个 alternate action-sweep bounds
每个 alternate embodied interaction pose
```

这些都来自现有 Runtime truth。

---

## 6. `actionSweepBounds(..., samples=1)` 作为 Target Pose Bounds

1.27 没有新增第二套 articulation geometry owner。

现有：

```text
InteractionSystem.actionSweepBounds(
  objectId,
  action,
  partName,
  samples
)
```

当：

```text
samples = 1
```

该方法按现有实现直接采样 target coordinate。

因此 1.27 复用同一 joint axis / rest pose / target truth，得到：

```text
current target pose AABB
alternate target pose AABB
```

方法结束后 Three node 会恢复原 pose，不持久修改 Scene。

---

## 7. Original Sweep 仍来自同一个 Runtime Owner

原失败动作：

```text
A.open
```

使用：

```text
actionSweepBounds(A, open, failedPart)
```

得到从当前 stalled coordinate 到 original target 的 swept AABB。

Counterfactual 不建立第二个“原动作几何”。

---

## 8. Current Overlap 是 Counterfactual 基线

首先比较：

```text
originalSweep AABB
∩
current blocker target-pose AABB
```

得到：

```text
currentOverlapVolume
```

如果 Runtime 当前 contact 存在，但 Three AABB 根本没有显示 overlap：

```text
COUNTERFACTUAL_EVIDENCE_INSUFFICIENT
```

不会假装视觉 AABB 足以解释 Physics contact。

---

## 9. 为什么 Contact Truth 与 AABB Evidence 可以不一致

Rapier contact 来自真实 collider narrow-phase。

1.27 counterfactual 几何来自 Three node AABB。

两者来源不同：

```text
Rapier collider truth
!=
Three visual AABB approximation
```

所以 current Physics contact 是 failure evidence；AABB 只用于 action-choice 的 provisional counterfactual comparison。

---

## 10. 每个 Alternate Action 的 Evidence

每个 executable action 记录：

```text
counterfactual:
  causal = false
  geometry = three-aabb
  currentOverlapVolume
  targetOverlapVolume
  overlapReduction
  targetSweepClear
  actionSweepOverlapVolume
```

其中：

```text
overlapReduction
= max(0, currentOverlap - targetOverlap)
```

---

## 11. `targetSweepClear`

如果 alternate target pose 与 original sweep AABB 不再相交：

```text
targetSweepClear = true
```

这只意味着：

> 在当前 Three AABB approximation 下，该 target pose 已离开 original action sweep。

不意味着 blocker action trajectory 已被物理验证一定成功。

---

## 12. `actionSweepOverlapVolume`

Counterfactual 还记录 blocker 自己从 current pose 到 alternate target 的 action sweep，与 original failed sweep 的 AABB overlap。

这提供：

```text
该恢复动作本身经过 original conflict region 的程度
```

但同样不是动力学 collision proof。

真正 action execution 仍由 Rapier / live joint observer 验证。

---

## 13. Interaction Pose 仍必须可执行

每个 alternate action 还必须真实通过：

```text
findInteractionPose(
  actorId,
  blockerId,
  {
    action,
    partName:blockerPartName
  }
)
```

因此 action list 会区分：

```text
executable = true / false
```

而不是只有几何 ranking。

---

## 14. Executable 不等于 Ranked

这是 1.27 的重要语义：

```text
executable = Runtime 可以尝试这个 action
ranked = 这个 action 有明确 counterfactual clearance gain
```

一个 action 可以：

```text
executable = true
overlapReduction = 0
rank = undefined
```

它不会成为 selected recovery。

---

## 15. Viable Action 必须有 Clearance Gain

当前只有：

```text
overlapReduction > 0
```

的 alternate action 会进入 counterfactual rank set。

如果没有任何 action 改善：

```text
NO_COUNTERFACTUAL_CLEARANCE_GAIN
```

不会为了“必须恢复”选一个无改善动作。

---

## 16. Action Ranking Strategy

当前内部 action ranking：

```text
articulated-target-sweep-counterfactual-v1
```

并明确：

```text
causal = false
```

排序条件：

```text
1. targetSweepClear = true 优先
2. overlapReduction 更大
3. targetOverlapVolume 更小
4. actionSweepOverlapVolume 更小
5. embodied routeCost 更低
```

---

## 17. Action Ranking 不替代 Global Recovery Ranking

1.24–1.26 的 root recovery ranking 仍是：

```text
eligible-recovery-route-cost-v2
```

1.27 的 `actionRanking` 只解决：

> 同一个 articulated blocker Part 内部，多个 alternate actions 选哪个。

不会用一个 Part 的 AABB counterfactual score 去压过另一个完全不同 blocker 的 pickup recovery。

---

## 18. 完全打平时拒绝

如果两个 viable actions 的：

```text
targetSweepClear
overlapReduction
targetOverlapVolume
actionSweepOverlapVolume
routeCost
```

完全相同：

```text
COUNTERFACTUAL_ACTION_TIE
```

并记录：

```text
tiedActions
```

不会用 action name 字典序偷偷决定真正执行动作。

---

## 19. Tie Result 不伪造 Rank

在 `COUNTERFACTUAL_ACTION_TIE` 结果中：

```text
actionRanking.actions[].rank
```

全部为空。

只有明确 selected 的 evidence epoch 才产生 rank。

---

## 20. Selected Action 进入原有 Auxiliary Wrapper

最终 rank-1 action 仍变成：

```text
recoverArticulatedBlocker(
  blockerAction = selectedAction
)
```

没有新的 counterfactual execution tool。

真正 world mutation 仍只有 1.26 wrapper。

---

## 21. Execution-time 必须重新 Ranking

`recoverArticulatedBlocker` 执行前仍重新：

```text
buildRecoveryProposals()
```

所以 counterfactual ranking 不是缓存 decision。

如果 world 变化导致 rank-1 action 改变：

```text
recovery-stale
reason = COUNTERFACTUAL_SELECTION_CHANGED
currentRecommendedAction = ...
```

旧 action 不会继续执行。

---

## 22. Evidence Epoch 仍然有效

同一 original failure evidence epoch：

```text
selected articulated recovery
→ verified
```

再次请求同一 recovery 仍由 1.23 duplicate gate 阻止。

只有 original action 真正 retry 后才进入新的 failure evidence epoch。

---

## 23. Real `ajar` Two-cabinet Fixture

真实 E2E 沿用 1.26 两柜几何：

```text
cabinet_A = [0,0,0]
cabinet_B = [-2.2,0,1]
yaw(B) = +90°
```

但将 B.door 当前真实 joint target 设为：

```text
ajar = -0.8
```

测试 Manifest 只为 B.door 增加：

```text
actions += ajar
targets.ajar = -0.8
```

`approachAndInteract` 仍只执行 open/close；`ajar` 只是 verified current state，用来制造两个 alternate actions。

---

## 24. Real Physics Failure

B.door 真实 settle 到 -0.8 后：

```text
A.door open
→ STALL around -0.93
→ current Rapier contact = B.door
```

不是 mock attribution。

---

## 25. Real Counterfactual Geometry

该真实 fixture 的 Three AABB evidence 大致为：

```text
current ajar overlap ≈ 0.664
open target overlap  ≈ 0.622
close target overlap = 0
```

因此：

```text
open
→ executable
→ overlapReduction small
→ targetSweepClear = false
→ rank 2

close
→ executable
→ overlapReduction largest
→ targetSweepClear = true
→ rank 1
```

---

## 26. Real Recovery E2E

真实 Agent / Recast / Rapier 链：

```text
A.open
→ STALL / B.door contact

suggestRecoveryActions
→ B.door verifiedAction=ajar
→ open + close executable
→ counterfactual actionRanking
→ close rank 1

recoverArticulatedBlocker(B.close)
→ real approach
→ real motor
→ action-completed

fresh replan
→ A.open retry
→ action-completed
```

最终：

```text
B.door = close
A.door = open
```

---

## 27. Original Task Ledger 不变

和 1.23–1.26 一样：

```text
A.open STALL
→ unresolved = 1

B.close auxiliary verified
→ unresolved = 1

A.open retry verified
→ unresolved = 0
```

Counterfactual ranking 不拥有任务成功语义。

---

## 28. Nemotron Strict Probe

新增：

```bash
npm run agent:probe -- recovery-counterfactual
```

Nemotron 当前样本最终选择 Runtime rank-1 `close`，没有自行执行 `open`。

它曾在真正制造 STALL 前过早调用一次 suggestion，被 probe 明确拒绝；之后仍必须回到真实 original failure，再消费 Runtime evidence。

这说明系统保证来自 Runtime gate，而不是模型采样完美。

---

## 29. Muse Strict Probe

Muse 当前样本严格执行：

```text
A.open STALL
→ suggestRecoveryActions
→ close rank 1 / targetSweepClear=true
→ recoverArticulatedBlocker(close)
→ A.open retry verified
```

Final 文本虽然正确复述 ranking evidence，但任务成功仍只来自 tool outcome。

---

## 30. 1.26 Regression

1.27 最终 live smoke 还重新运行：

```text
recovery-articulated
```

唯一 alternate action 的 1.26 路径仍正常，不受 multi-action ranking 影响。

---

## 31. 当前 Claim

AgentScape 现在可以说：

> 当一个 current-contact articulated blocker Part 具有多个 executable alternate open/close actions，并且当前 verified target-pose AABB 与 original failed action sweep 存在可解释 overlap 时，Runtime 可以复用现有 articulation sweep geometry 和 embodied interaction planning，对每个 alternate action 构造 non-causal Three-AABB counterfactual evidence，并只在存在明确 clearance improvement 且没有完全 tie 时选择一个 provisional articulated recovery；execution-time 会重新 ranking，真正 action verified 后仍必须 retry original post-condition。

不能说：

> 1.27 已经用 Physics 仿真证明 selected action 必然解除碰撞。

---

## 32. 当前不做

1.27 没有：

```text
Rapier shadow-world simulation
hypothetical collider trajectory query
continuous collision prediction
contact impulse prediction
causal root-cause score
multi-action recovery tree
lookahead search
```

---

## 33. 下一阶段：Physics-backed Counterfactual Geometry

下一阶段更合理的是把：

```text
Three AABB counterfactual
```

升级为：

```text
Rapier collider-level hypothetical pose / sweep evidence
```

要求仍然是：

```text
不修改 live world
不调用 motor 试错
不把 prediction 叫 verified
执行后仍重新观察 original post-condition
```

---

## 34. 1.28：Three AABB 降级为 Explicit Fallback

1.28 保留本章 v1 作为 coverage fallback，但首选改为 `articulated-rapier-shape-counterfactual-v2 / basis=rapier-shape-pairs`。Physics helper 使用真实 collider shapes 与 hypothetical joint poses做 17-sample shape-pair comparison；只有 coverage 完整、current baseline 一致时采用。否则 actionRanking 明确 `basis=three-aabb-fallback` 并附 `fallbackReason`。详见 [`physics-counterfactual-geometry.md`](./physics-counterfactual-geometry.md)。
