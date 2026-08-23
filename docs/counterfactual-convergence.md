# Counterfactual Convergence & Nested-frame Coverage

AgentScape 1.30 在 1.29 的 adaptive Physics counterfactual 上增加两类证据：

```text
1. denser resampling convergence
2. nested articulated parent-frame validation
```

仍然坚持：

```text
convergence stable != continuous collision proof
nested frame match != parent/child dynamics prediction
```

## 1. Convergence 为什么需要显式化

1.29 的 adaptive sampler 会根据 joint travel 与 collider extent 选择 sample count，但 sample density 本身仍是 approximation。

1.30 对 Physics rank-1 action 再做一次更密采样：

```text
adaptive base
→ denser fixed-pair samples
→ compare qualitative outcome + normalized conflict ratios
```

## 2. `articulationPairCounterfactualConvergence`

新只读 helper：

```text
articulationPairCounterfactualConvergence(...)
```

先运行 adaptive base，再把 original / blocker sample counts 分别提高，单边最多33。

Dense rerun 不修改 live world，也不执行 motor。

## 3. Independent Dense Counts

`articulationPairCounterfactual` 的 `samples` 现在支持：

```text
number
→ original/blocker 同一 fixed count

{ original, blocker }
→ fixed-pair independent counts

null
→ adaptive
```

因此 denser rerun 可以保持 original/blocker 各自 motion scale。

## 4. Convergence Qualitative Contract

当前只把两条定性结论作为 hard stability gate：

```text
targetSweepClear 是否一致
conflictReduction > 0 是否一致
```

两者都一致：

```text
status = stable
```

任一翻转：

```text
status = unstable
```

## 5. Normalized Conflict Ratios

为了避免 sample count 变化导致 raw counts 不可直接比较，还记录：

```text
current conflict ratio
target conflict ratio
action conflict-pair ratio
```

并计算 base vs dense drift。

这些 drift 当前是 calibration evidence，不直接作为 success condition。

## 6. Physics Rank-1 必须通过 Convergence Gate

多 action articulated recovery 中：

```text
Physics v2 ranking
→ selected rank-1
→ convergence rerun
```

如果 stable：继续使用：

```text
articulated-rapier-shape-counterfactual-v2
```

如果 unstable：

```text
PHYSICS_COUNTERFACTUAL_UNSTABLE
→ three-aabb-fallback
```

模型不能自行坚持旧 Physics rank。

## 7. Convergence Unavailable / Error

如果 denser query 本身不可用：

```text
PHYSICS_COUNTERFACTUAL_CONVERGENCE_UNAVAILABLE
```

如果 query 抛错：

```text
PHYSICS_COUNTERFACTUAL_CONVERGENCE_ERROR
```

都不会继续假装 Physics v2 已收敛。

## 8. Compact Agent Evidence

Agent 只看到 compact report：

```text
status
qualitative
base/dense sample counts
normalized ratios
maxRatioDrift
```

不会重复塞完整 base/dense geometry payload。

## 9. Real Two-cabinet Convergence

真实 `ajar=-0.8` 两柜 fixture：

```text
adaptive base
→ denser fixed-pair
→ targetSweepClear 保持 true
→ clearanceGain 保持 true
→ status = stable
```

并继续选择 `close`。

## 10. Unstable Regression

专项测试故意构造：

```text
base:
  close target clear

dense:
  close target not clear
```

Runtime 必须：

```text
PHYSICS_COUNTERFACTUAL_UNSTABLE
→ explicit Three fallback
```

不能因为 base 结果更“漂亮”就继续 Physics rank。

## 11. Nested Part Frame

1.30 还验证：

```text
Door (revolute)
└─ Slider (prismatic)
```

当 parent Door 已真实旋转后，child Slider 的 hypothetical axis / collider pose 必须使用当前 parent world rotation。

## 12. Parent Pose 是 Query-time 条件

`articulationColliderPoses` 现在显式返回：

```text
frameAssumption = parent-pose-at-query
```

pair counterfactual 返回：

```text
frameAssumption = parent-poses-static-during-hypothesis
```

这不是隐藏限制，而是当前 evidence contract。

## 13. 为什么 Nested World Pose 不能直接和 Real Motor World Pose 完全相等

真实 child motor 会对 dynamic parent 产生反作用。

因此执行 child slider 时：

```text
parent world pose may drift
```

而 hypothetical query 没有模拟这段 dynamics coupling。

所以正确验证对象是：

```text
predicted child pose relative to parent at query
≈
actual child pose relative to actual parent after execution
```

而不是强行要求两个 world poses 完全相同。

## 14. Free Child Joint 不是“默认零位”

Nested fixture 还暴露一个重要事实：如果 child prismatic joint 没有 hold motor，parent motion 可以通过真实 Physics 让 child 沿 joint limits 滑动。

因此：

```text
no explicit child request
!=
child coordinate must remain zero
```

测试会先真实请求 child close/hold，再移动 parent。

## 15. Nested Motor-vs-Hypothetical Fixture

测试流程：

```text
hold Slider at 0
→ Door real motor to -0.5 rad
→ query Slider hypothetical +0.35m
→ real Slider motor +0.35m
```

验证：

```text
predicted child local-to-parent position
≈ actual local-to-parent position

predicted child local-to-parent rotation
≈ actual local-to-parent rotation
```

并确认 parent world pose 在 child motor action 中确实有非零 drift，证明测试没有偷把 parent 当 fixed body。

## 16. Agent Contract

Agent prompt 明确：

```text
Physics-first v2 + convergence present
→ only stable is accepted as converged Physics evidence

Runtime fallback
→ must accept fallback
```

Agent 不允许重新解释 unstable base result。

## 17. Strict Live Probe

`recovery-counterfactual` strict payload 新增：

```text
convergence.status = stable
base.mode = adaptive
dense.mode = fixed-pair
dense samples > base samples
```

Nemotron / Muse 都继续：

```text
A.open STALL
→ Physics v2 + stable convergence
→ recover B.close
→ calibration
→ original A.open retry verified
```

## 18. 当前 Claim

AgentScape 现在可以说：

> selected articulated Physics counterfactual action 会经过 adaptive→denser 的离散 resampling convergence check；如果 target-clear 或 clearance-gain 定性结论翻转，Runtime 会撤销 Physics-first selection并显式 fallback。Nested articulated child hypothetical pose 已在 parent 真实移动后通过 local-to-parent motor对拍，且 evidence 明确以 query 时 parent pose 为条件。

不能说：

> stable convergence 等于 continuous CCD / dynamics proof，或 nested hypothetical world pose 已预测 parent-child reaction dynamics。

## 19. 下一阶段

下一阶段优先补：

```text
third-object hypothetical collision coverage
selected recovery 与环境/第三对象的 collision envelope
bounded calibration summary
```

仍然先提升 evidence coverage，再考虑 multi-step search。
