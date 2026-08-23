# Counterfactual Calibration & Joint-frame Generalization

AgentScape 1.29 在 1.28 Physics-backed Counterfactual Geometry 之上做三件事：

```text
1. non-zero revolute childAnchor hypothetical pose
2. adaptive counterfactual sampling
3. post-recovery observed calibration
```

它仍然坚持：

```text
prediction != calibration != verification
```

---

## 1. 1.28 的剩余边界

1.28 已经可以用 live Rapier collider shapes 做 hypothetical shape-pair comparison，但仍有三个明确局限：

```text
revolute childAnchor != 0
→ Physics hypothetical 明确拒绝

sample count
→ proposal 固定 17

prediction quality
→ 只有执行后的 original retry 间接证明最终结果
```

1.29 只收紧这三个边界，不增加 recovery tree。

---

## 2. Non-zero Revolute Child Anchor

Rapier `JointData.revolute(anchor1, anchor2, axis)` 中：

```text
anchor2
```

是 joint pivot 在 child rigid-body local frame 中的位置。

因此 Part body 旋转时不能只改变 body quaternion。

---

## 3. 正确 Pivot Transform

当前 body pose：

```text
p0, q0
```

child local anchor：

```text
c
```

世界 pivot：

```text
pivotWorld = p0 + q0 * c
```

给定 joint delta：

```text
q1 = rotation(worldAxis, delta) * q0
p1 = pivotWorld - q1 * c
```

这样：

```text
p1 + q1 * c == pivotWorld
```

child anchor 的 world position 保持不变。

---

## 4. 为什么不能只绕 Body Origin 转

如果：

```text
childAnchor = [0,0,0]
```

body origin 就是 pivot，1.28 的简化公式成立。

但如果：

```text
childAnchor != 0
```

只改 quaternion 会让 joint anchor 在世界里绕 body origin 漂移。

1.29 补上的就是 body translation correction。

---

## 5. Motor 对拍，不靠公式自证

专项测试构造：

```text
child body origin = [1,1,0]
childAnchor = [-1,0,0]
parentAnchor = [0,1,0]
```

先只读预测：

```text
articulationColliderPoses(target=-1)
```

再让真实 Rapier motor 执行到：

```text
-1 rad
```

比较 hypothetical collider 与真实 collider。

要求：

```text
position error < 3.5 cm
rotation error < 0.08 rad
world pivot remains stable
```

---

## 6. 真实 Compiled Asset Coverage

仓库真实 Compiler→Runtime fixture 本来就包含：

```text
parentAnchor = [-.82,1,.355]
childAnchor  = [-.81,0,0]
```

所以 non-zero childAnchor 不是理论边角。

1.29 generalization 后该 compiled articulated runtime 继续通过 real motor open→close regression。

---

## 7. Adaptive Sampling 的目的

固定 17 个 samples 有两个问题：

```text
小 motion
→ 浪费 query

大 motion / small collider
→ 可能过稀
```

1.29 改为由 Runtime 根据实际 joint travel 和 Rapier collider extent 决定。

---

## 8. Shape Characteristic Radius

`shapeBoundingRadius()` 直接读取 live Rapier shape：

```text
Cuboid / RoundCuboid
→ halfExtents

Cylinder / Capsule / Cone
→ radius + halfHeight family

Ball
→ radius

Convex / TriMesh
→ vertices max norm

Segment
→ endpoint max norm
```

无法确定 extent 时：

```text
COLLIDER_EXTENT_UNAVAILABLE
```

上层可以保守 fallback。

---

## 9. Prismatic Travel

对 prismatic：

```text
maxTravel = abs(target - current)
```

不依赖 collider lever arm。

---

## 10. Revolute Travel

对 revolute，先计算每个 collider 相对 joint child anchor 的最大 lever：

```text
lever
= distance(colliderLocalCenter, childAnchor)
+ shapeBoundingRadius
```

然后：

```text
maxTravel ~= abs(deltaAngle) * maxLever
```

这是 collider surface arc-length 的保守近似。

---

## 11. Sampling Resolution

当前 resolution：

```text
clamp(
  minColliderBoundingRadius * 0.35,
  0.02,
  0.08
)
```

单位是 world meters。

因此：

```text
small collider
→ 更细 sampling

large collider
→ resolution 最多 8 cm
```

---

## 12. Sample Count

```text
count
= ceil(maxTravel / resolution) + 1
```

然后 clamp：

```text
[5, 33]
```

防止极小 motion 退化成两个点，也防止 browser query 爆炸。

---

## 13. Original / Blocker 独立 Sampling

1.28 强制两条 trajectory 使用同一 `samples=17`。

1.29 改为：

```text
samples:
  original = N
  blocker  = M
  mode = adaptive
```

所以 original retry 轨迹与不同 alternate blocker actions 可以有不同密度。

---

## 14. Fixed Override 仍保留

调用：

```text
articulationPairCounterfactual(..., { samples:17 })
```

仍会得到：

```text
mode = fixed
original = 17
blocker = 17
```

用于 regression / diagnosis / reproducible comparison。

---

## 15. Real Ajar Fixture 的 Adaptive Counts

当前真实两柜 E2E 中：

```text
original A retry trajectory
→ 12 samples

B.open
→ 16 blocker samples

B.close
→ 22 blocker samples
```

因为 close 从约 `-0.803` 移到 `0`，travel 比 open 到 `-1.35` 更长。

---

## 16. Adaptive Physics Result

同一 fixture：

```text
open:
  current conflicts = 12
  target conflicts  = 9
  reduction         = 3

close:
  current conflicts = 12
  target conflicts  = 0
  reduction         = 12
```

Physics rank 仍稳定选择：

```text
close
```

---

## 17. Current Baseline 仍必须一致

即使不同 alternate action 使用不同 blocker sample counts，original trajectory sample count 相同。

因此各 action 的：

```text
current.conflictSamples
current.pairIntersections
```

仍必须一致。

否则继续触发：

```text
PHYSICS_COUNTERFACTUAL_BASELINE_INCONSISTENT
```

---

## 18. Real Prismatic Counterfactual Fixture

1.29 新增真实 prismatic fixture：

```text
Original slider:
  axis = X
  target = 0.6

Blocker slider:
  world offset x = 0.3
  axis = Z
  target = 0.5
```

blocker current pose 位于 original X trajectory 中。

---

## 19. Prismatic Physics Evidence

Hypothetical blocker target 移到 Z=0.5 后：

```text
current.conflictSamples > 0
target.conflictSamples = 0
targetSweepClear = true
```

query 前后两个 live joints 都不移动。

---

## 20. Prismatic Motor 对拍

随后真实执行 blocker prismatic motor 到 0.5。

要求：

```text
motor target error < 0.03
hypothetical collider position
≈ real collider position
```

因此 1.29 的 hypothetical pose coverage 不再只有 revolute Door。

---

## 21. Counterfactual Calibration

1.29 在真实：

```text
recoverArticulatedBlocker
```

完成后增加一次只读 observation。

它只在 selected proposal 包含 checked Physics counterfactual evidence 且 blocker action 本身 verified 时出现。

---

## 22. Calibration Scope

当前 scope：

```text
post-recovery-current-contact
```

读取：

```text
PhysicsSystem.articulationContacts(
  originalTarget,
  originalPart
)
```

检查 original stalled Part 与该 blocker Part 是否仍有 current external contact。

---

## 23. Calibration Prediction

记录 selected action 的：

```text
strategy
basis
targetSweepClear
targetConflictSamples
conflictReduction
samples
```

它仍来自 pre-execution prediction。

---

## 24. Calibration Observation

记录：

```text
blockerActionVerified
currentContactStillPresent
```

其中 `blockerActionVerified` 仍要求：

```text
action-completed
targetReached = true
settled = true
```

---

## 25. Calibration Consistency

如果预测：

```text
targetSweepClear = true
```

且执行后 current contact 已消失：

```text
consistency = consistent
```

如果 contact 仍存在：

```text
consistency = contradicted
```

---

## 26. Predicted Not-clear 当前不可直接校准

如果：

```text
targetSweepClear = false
```

单一 post-recovery current-contact observation 不能证明 sampled full trajectory prediction 对错。

因此：

```text
consistency = not-comparable
```

不会硬造 accuracy label。

---

## 27. Calibration 不持久化

当前 calibration：

```text
只存在于 recoverArticulatedBlocker result
```

没有：

```text
CalibrationManager
Scene persistence
长期 learned score
自动调权
```

先积累真实 contract，再决定是否需要统计层。

---

## 28. Calibration 不是 Task Verification

无论：

```text
consistency = consistent
```

还是：

```text
contradicted
```

结果都明确：

```text
originalRetryRequired = true
```

original unresolved 不会因为 calibration 清除。

---

## 29. Real Consistent Calibration

真实 `B.close` E2E：

```text
Physics prediction:
  targetSweepClear = true
  targetConflictSamples = 0

real recovery:
  B.close action-completed

post-recovery observation:
  currentContactStillPresent = false

calibration:
  consistent
```

随后仍要：

```text
A.open retry
→ action-completed
```

任务才完成。

---

## 30. Contradicted Calibration Regression

专项 mock 明确构造：

```text
prediction target clear
blocker action verified
but current contact still present
```

要求：

```text
consistency = contradicted
originalRetryRequired = true
```

不会隐藏 Physics prediction 与 live observation 的冲突。

---

## 31. Agent Contract

Agent prompt 明确：

```text
sample counts are Runtime evidence
not constants
```

以及：

```text
calibration consistent
!= original success

calibration contradicted
must not be hidden
```

---

## 32. Strict Live Probe

`recovery-counterfactual` payload 升级为 adaptive evidence：

```text
open:
  original samples = 12
  blocker samples = 16
  target conflicts = 9

close:
  original samples = 12
  blocker samples = 22
  target conflicts = 0
```

并返回 post-recovery `counterfactualCalibration`。

Probe 仍只接受：

```text
A.open STALL
→ suggest
→ recover B.close
→ calibration observed
→ A.open retry verified
```

---

## 33. 当前 Claim

AgentScape 现在可以说：

> Physics-backed articulated counterfactual query 已支持 non-zero revolute child-anchor pivot transform，并通过 hypothetical-vs-real-motor collider pose 对拍；sample density 可以按真实 Rapier collider extent 与 joint travel 自适应，original/blocker trajectories 独立取样，同时保留 fixed override；真实 prismatic fixture 也进入同一 query contract。执行 selected articulated recovery 后，Runtime 会用 live Rapier current contact 做一次 ephemeral observed calibration，显式记录 Physics prediction 与 post-recovery contact observation 是 consistent、contradicted 或 not-comparable，但 calibration 永远不能替代 original action retry verification。

不能说：

> calibration consistent 就证明完整 sampled trajectory 或原始任务一定成功。

---

## 34. 下一阶段

下一阶段优先：

```text
sampling convergence / calibration coverage
nested articulated parent-frame validation
third-object hypothetical collision coverage
```

具体先研究：

```text
adaptive N vs N×2 prediction stability
nested Part parent motion 下 hypothetical frame 是否仍准确
selected action 与实际 retry outcome 的 bounded calibration record
```

仍然不先造 multi-step recovery search tree。

---

## 35. 1.30：Calibration 前先要求 Sampling Convergence

1.30 对 selected Physics counterfactual 加 denser resampling gate。只有定性 `targetSweepClear / clearanceGain` 保持一致时才继续 v2；翻转则 `PHYSICS_COUNTERFACTUAL_UNSTABLE` 并 fallback。Nested Part query 也显式标注 parent pose conditional assumption。详见 [`counterfactual-convergence.md`](./counterfactual-convergence.md)。
