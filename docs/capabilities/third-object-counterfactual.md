# Third-object Hypothetical Collision Coverage

AgentScape 1.31 在 articulated blocker recovery 的 pairwise counterfactual 之外，再检查 selected blocker action 是否会把自己撞向 Environment 或第三个 Object。

核心边界：

```text
original Part ↔ blocker Part
= pairwise counterfactual owner

blocker hypothetical action
↔ other live world colliders
= world counterfactual owner
```

## 1. `articulationWorldCounterfactual`

`PhysicsSystem.articulationWorldCounterfactual()` 复用 live Rapier collider shape 与 provenance，通过 `World.intersectionsWithShape()` 查询 hypothetical blocker poses；不移动 live rigid body，不执行 motor。

返回：

```text
geometry = rapier-world-shape-query
causal = false
frameAssumption = other-world-colliders-static-during-hypothesis
```

## 2. Baseline vs Introduced Collision

Runtime 分别读取：

```text
current blockers
target-pose blockers
action-envelope blockers
```

真正用于 veto 的是：

```text
introducedTarget = targetHits - currentHits
introducedAction = actionHits - currentHits
```

这样已有 baseline contact 不会自动被误判为 recovery 新问题。

## 3. Provenance

查询复用现有 `colliderProvenance`，可以机器可读地区分：

```text
object:<objectId>:<partName>:<colliderIndex>
environment:<environmentId>:<colliderIndex>
```

没有新增第二套 collider ownership map。

## 4. Exclusion

World query 默认排除 blocker self。

Recovery proposal 另外排除：

```text
Agent 整个 object
original failed pair 对应的 Part
```

不会排除 original object 的其它 Parts/root，因此这些其它碰撞仍能被发现。

## 5. Hard Veto

如果 world query 已知 selected action：

```text
targetIntroducesNoCollision = false
```

或：

```text
actionIntroducesNoCollision = false
```

该 action：

```text
executable = true
recoveryEligible = false
worldReason = THIRD_OBJECT_COUNTERFACTUAL_BLOCKED
rank = none
```

Pairwise Physics rank 与 Three fallback 都不能 resurrect 它。

## 6. Unique Action 也覆盖

即使只有一个 alternate articulated action，1.31 也必须通过 world counterfactual preflight；不能绕过新安全边界。

## 7. Multi-action Coverage

多 action 时，每个 alternate 都独立得到 world evidence。只有：

```text
interaction executable
+ world query checked
+ no introduced target collision
+ no introduced action-envelope collision
```

才进入 recovery ranking。

如果全部 alternate 都被 world veto：

```text
recovery-unavailable
reason = THIRD_OBJECT_COUNTERFACTUAL_BLOCKED
```

## 8. Execution-time Revalidation

`recoverArticulatedBlocker` 执行前仍重新 `buildRecoveryProposals()`。

因此 proposal 时安全、执行前第三个物体进入轨迹，会得到：

```text
recovery-stale
reason = THIRD_OBJECT_COUNTERFACTUAL_BLOCKED
```

并且 blocker motor 不执行。

## 9. Real World-query Regression

真实 prismatic fixture 中 hypothetical Slider action 同时发现：

```text
third Object
Environment wall
```

指定 original evidence pair 被排除，query 前后 live slider coordinate 不变。

## 10. Agent Contract

Agent 看到 `worldCounterfactual / rapier-world-shape-query` 时，selected recovery 必须同时满足：

```text
checked = true
targetIntroducesNoCollision = true
actionIntroducesNoCollision = true
```

Known third-object/environment collision 是 hard veto，模型不得用 pairwise Physics rank 或 Three fallback 覆盖。

## 11. 当前 Claim

AgentScape 现在可以说：

> articulated blocker recovery 的 hypothetical evidence 不再只比较 original Part 与 blocker Part；selected blocker target/action sampled geometry 还会对 live Environment / third-object Rapier colliders 做非修改式 world query，并只允许没有新增 world collision 的 action进入 recovery ranking。Execution-time 会重新查询，world 变化会使旧 recovery stale。

不能说：

> 1.31 已模拟其它 dynamic bodies 在 recovery 过程中的未来运动。

其它 world colliders 当前仍按 query 时 live pose 作为静态 hypothetical background。
