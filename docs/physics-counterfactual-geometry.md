# Physics-backed Counterfactual Geometry

AgentScape 1.28 把 1.27 的 articulated multi-action counterfactual 从纯 Three AABB comparison 升级为 **Physics-first Rapier shape-pair evidence**。

核心原则仍然不变：

```text
prediction != verification
```

真正任务成功仍只来自执行后的 original post-condition。

---

## 1. 三层 Evidence

1.28 明确区分：

```text
live Rapier contact
= 当前 failure truth

Rapier hypothetical shape-pairs
= preferred counterfactual geometry

Three AABB
= explicit fallback counterfactual geometry
```

三层 evidence 的角色不同，不能混称 Physics verification。

---

## 2. 为什么不创建 Shadow World

当前 Rapier `Shape` API 已能直接接受任意 hypothetical pose：

```text
Shape.intersectsShape()
Shape.contactShape()
Shape.castShape()
```

1.28 当前只需要 `intersectsShape()`。

因此无需：

```text
复制 World
复制 RigidBody
复制 Collider
执行 motor 试错
```

Counterfactual 查询不修改 live world。

---

## 3. `articulationColliderPoses`

PhysicsSystem 新增只读 helper：

```text
articulationColliderPoses(
  objectId,
  partName,
  hypotheticalCoordinate
)
```

它复用：

```text
当前 Rapier Part body pose
当前真实 collider shape
当前真实 collider world pose
当前 joint localAxis / coordinate
```

并计算给定 hypothetical joint coordinate 下每个 collider 的 world pose。

没有从 Manifest 重新创建 collider shape。

---

## 4. 为什么复用真实 Rapier Shape

这样可以继续覆盖：

```text
cuboid
cylinder
capsule
convex hull
未来 Rapier 已创建的其他 shape
```

Counterfactual shape 与 live collision shape 是同一对象类型，不会因为另写一套 Manifest→shape translator 而漂移。

---

## 5. Collider Local Pose 从 Live Rapier Truth 推导

对每个 Part collider：

```text
live collider world pose
relative to
live Part body world pose
```

得到 collider local transform。

再应用 hypothetical body pose：

```text
hypothetical body pose
× collider local pose
→ hypothetical collider world pose
```

因此 provider 生成的 collider local rotation/offset 仍被保留。

---

## 6. Prismatic Joint

Prismatic hypothetical pose 当前使用：

```text
bodyPosition += worldAxis * deltaCoordinate
```

body rotation 保持不变。

---

## 7. Revolute Joint

Revolute hypothetical pose 当前使用：

```text
bodyRotation =
  rotation(worldAxis, deltaCoordinate)
  × currentBodyRotation
```

但这只在：

```text
childAnchor ≈ [0,0,0]
```

时成立，因为此时 body origin 与 revolute child pivot 重合。

---

## 8. 非零 Revolute `childAnchor` 明确拒绝

如果：

```text
length(childAnchor) > 1e-5
```

返回：

```text
REVOLUTE_CHILD_ANCHOR_UNSUPPORTED
```

不会默默用错误的 body-center rotation。

上层可以转入明确标记的 AABB fallback。

---

## 9. `articulationPairCounterfactual`

第二个只读 helper：

```text
articulationPairCounterfactual(
  originalObject,
  originalPart,
  originalTarget,
  blockerObject,
  blockerPart,
  blockerTarget,
  { samples }
)
```

它比较 original failed Part trajectory 与 blocker candidate trajectory 的 Rapier collider geometry。

---

## 10. 默认使用离散采样

Proposal 当前固定调用：

```text
samples = 17
```

即：

```text
current coordinate
→ ... 17 个等距 joint coordinates ...
→ target coordinate
```

这不是 continuous collision detection。

---

## 11. Original Trajectory

Original failed Part 从：

```text
当前 stalled coordinate
```

采样到：

```text
original action Manifest target
```

因此 counterfactual 不是从 rest pose 重新猜原动作。

---

## 12. Blocker Trajectory

Blocker Part 从：

```text
当前 verified coordinate
```

采样到：

```text
candidate alternate action target
```

每个 alternate action 单独生成一条 hypothetical trajectory。

---

## 13. Pairwise Rapier Intersection

每个 hypothetical pose 使用真实 Rapier shape：

```text
left.shape.intersectsShape(
  leftPose,
  right.shape,
  rightPose
)
```

返回的是 collider-level geometry evidence，不依赖 Three visual mesh bounds。

---

## 14. Current Evidence

固定 blocker current pose，沿 original trajectory 检查：

```text
current.conflictSamples
current.pairIntersections
```

它表达：

> 当前 blocker collider pose 与 original sampled trajectory 有多少离散 conflict samples。

---

## 15. Target Evidence

固定 blocker candidate target pose，沿 original trajectory 检查：

```text
target.conflictSamples
target.pairIntersections
```

如果：

```text
target.conflictSamples = 0
```

则：

```text
targetSweepClear = true
```

这里只是 sampled shape-pair clear，不是 continuous proof。

---

## 16. Conflict Reduction

当前：

```text
conflictReduction
=
max(0, current.conflictSamples - target.conflictSamples)
```

只有：

```text
conflictReduction > 0
```

的 action 才进入 Physics viable rank set。

---

## 17. Blocker Action Envelope Evidence

还会对：

```text
original sampled poses
×
blocker sampled poses
```

做 Cartesian shape-pair comparison：

```text
action.conflictSamplePairs
action.pairIntersections
```

这是一个保守的**离散 sweep-envelope metric**。

它不是 time-synchronized dynamics simulation。

---

## 18. 为什么使用 Cartesian Sample Pairs

1.28 的目的不是预测两个 joint 的时间同步轨迹，而是回答：

> blocker candidate action 所经过的 sampled geometry envelope 与 original action sampled envelope 有多少潜在形状冲突。

因此该 metric 只作为后置 tie-break evidence。

---

## 19. Physics Ranking Strategy

当所有 executable alternate actions 都有有效且一致的 Physics baseline 时：

```text
strategy = articulated-rapier-shape-counterfactual-v2
basis = rapier-shape-pairs
causal = false
```

排序：

```text
1. targetSweepClear = true
2. conflictReduction 更大
3. target conflictSamples 更少
4. target pairIntersections 更少
5. action conflictSamplePairs 更少
6. action pairIntersections 更少
7. embodied routeCost 更低
```

---

## 20. Physics 优先于 Three

专项 regression 故意构造：

```text
Three AABB:
  open 看起来 clear
  close 看起来仍 overlap

Rapier shape-pairs:
  open target conflicts > 0
  close target conflicts = 0
```

最终 Runtime 必须：

```text
selected blockerAction = close
```

证明 Physics-first 是 executable contract，而不是文档偏好。

---

## 21. Physics Current Baseline 必须一致

同一 original trajectory + 同一 blocker current pose，与 alternate action 无关。

因此不同 alternate query 的：

```text
current.conflictSamples
current.pairIntersections
```

理论上必须相同。

如果不一致：

```text
PHYSICS_COUNTERFACTUAL_BASELINE_INCONSISTENT
```

不允许继续 Physics ranking。

---

## 22. Physics Coverage 不完整时 Fallback

如果任意 executable action 的 Physics hypothetical query：

```text
checked = false
```

或 baseline 不足/不一致，则 Physics rank 不成立。

只在 1.27 Three evidence 可用时进入：

```text
strategy = articulated-target-sweep-counterfactual-v1
basis = three-aabb-fallback
```

并记录 `fallbackReason`。

---

## 23. Fallback Reasons

当前包括：

```text
PHYSICS_COUNTERFACTUAL_UNAVAILABLE
PHYSICS_COUNTERFACTUAL_PARTIAL_COVERAGE
PHYSICS_COUNTERFACTUAL_BASELINE_INSUFFICIENT
PHYSICS_COUNTERFACTUAL_BASELINE_INCONSISTENT
```

Fallback 绝不会被叫做 Physics verification。

---

## 24. Physics Failure + Visual Failure

如果 Physics 不可用，同时 Three current AABB 也无法解释 current conflict：

```text
COUNTERFACTUAL_EVIDENCE_UNAVAILABLE
```

或：

```text
COUNTERFACTUAL_EVIDENCE_INSUFFICIENT
```

不会强行选择 action。

---

## 25. Query 不修改 Live World

真实两柜测试在调用前后记录：

```text
A.door coordinate
B.door coordinate
```

要求：

```text
before == after
```

Counterfactual helper 不调用：

```text
setArticulationTarget
setTranslation
setRotation
motor configure
```

---

## 26. Real Two-cabinet Physics Fixture

继续使用：

```text
A = [0,0,0]
B = [-2.2,0,1]
yaw(B) = +90°
B.door verified ajar = -0.8
```

A.open 在真实 Rapier world 中 STALL/contact B.door。

---

## 27. Real Rapier Evidence

当前真实 17-sample evidence：

```text
open:
  current.conflictSamples = 17
  target.conflictSamples  = 13
  conflictReduction       = 4
  targetSweepClear        = false

close:
  current.conflictSamples = 17
  target.conflictSamples  = 0
  conflictReduction       = 17
  targetSweepClear        = true
```

因此 Physics rank-1 是 `close`。

---

## 28. Real Agent E2E

真实 Agent E2E 现在要求 suggestion 输出：

```text
articulated-rapier-shape-counterfactual-v2
basis = rapier-shape-pairs
```

然后：

```text
recoverArticulatedBlocker(close)
→ real motor action verified
→ fresh retry original A.open
→ original verified
```

---

## 29. Execution-time Revalidation 不变

1.28 没有绕过 1.27 的：

```text
recoverArticulatedBlocker
→ rebuildRecoveryProposals
→ rerank
```

如果 execution-time selected action 变化：

```text
COUNTERFACTUAL_SELECTION_CHANGED
```

旧请求不执行。

---

## 30. Agent Prompt 的 Evidence Priority

Agent 被明确告知：

```text
rapier-shape-pairs / v2
优先于
three-aabb-fallback / v1
```

同时明确禁止：

```text
把 fallback 解释成 Physics verification
```

---

## 31. Nemotron Physics-first Probe

`recovery-counterfactual` probe 已升级为 v2 payload。

当前 Nemotron 样本使用 Runtime rank-1 `close`，final 也正确引用：

```text
articulated-rapier-shape-counterfactual-v2
targetSweepClear=true
conflictSamples=0
```

真正 task success 仍由 original retry tool outcome 决定。

---

## 32. Muse Physics-first Probe

Muse 同样选择：

```text
close rank 1
```

并在 blocker recovery 后 fresh retry A.open verified。

---

## 33. 旧 Recovery Regression

1.28 live gate 同时重跑：

```text
1.26 recovery-articulated
1.25 recovery-cleanup
```

两者继续 PASS。

---

## 34. 当前 Claim

AgentScape 现在可以说：

> 对 current-contact articulated blocker 的多个 executable alternate actions，Runtime 可以在不修改 live Physics world、不执行 motor 试错的前提下，使用当前真实 Rapier collider shapes 与 hypothetical joint poses 对 original sampled trajectory、blocker current/target/action sampled geometry 做离散 shape-pair comparison；在所有 action coverage 完整且 current baseline 一致时，以 `articulated-rapier-shape-counterfactual-v2` 作为 Physics-first non-causal ranking evidence，Three AABB 只作为明确标记的 fallback；真正 recovery 执行后仍必须重新验证 original post-condition。

不能说：

> 1.28 已经完成连续碰撞预测或动力学因果仿真。

---

## 35. 当前不做

```text
shadow Rapier world
continuous rotational CCD
contact impulse prediction
friction / motor dynamics prediction
third-object hypothetical collisions
causal score
multi-step lookahead tree
```

---

## 36. 下一阶段

优先方向是：

```text
Counterfactual Calibration
+ Adaptive Sampling
+ Joint-frame Generalization
```

具体包括：

```text
根据 joint delta / collider extent 自适应 sample density
比较 prediction 与实际 recovery 后 contact/result
支持 non-zero revolute childAnchor 的正确 pivot transform
补 prismatic counterfactual fixture
```

仍然先提升 evidence fidelity，再考虑搜索树。
