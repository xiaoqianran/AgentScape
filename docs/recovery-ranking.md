# Multi-candidate Recovery Ranking

AgentScape 1.24 扩展 1.23 Verified Recovery，使一次 articulated STALL 中的多个 blocker candidates 可以得到稳定、可解释的 typed eligibility 与执行成本排序。

它仍然不做 causal root-cause ranking，也不执行多步 recovery tree。

---

## 1. 一次 Failure 可能有多个 Contact Candidates

1.22 的 STALL attribution 可能得到：

```text
blockerCandidates:
  obstacle_01
  obstacle_02
  environment wall #7
```

这些只说明失败瞬间存在 active Rapier contact。

1.24 的问题是：

```text
哪些 candidate 当前仍有效？
哪些当前具备合法 recovery？
如果有多个合法 recovery，先尝试哪一个？
```

---

## 2. Object Identity 不再绑定单个 Collider Index

同一个 Object 可能拥有多个 colliders。

如果历史 failure contact 是：

```text
crate_01 collider #0
```

下一 planning round 当前 contact 变成：

```text
crate_01 collider #1
```

语义 blocker 仍然是：

```text
crate_01 / $root
```

因此 Object blocker key 现在是：

```text
objectId + partName
```

而不是：

```text
objectId + partName + colliderIndex
```

当前接触报告仍保留全部 `colliderIndices` 作为物理证据。

---

## 3. Environment 仍保留 Collider Identity

Environment 没有可恢复 Object ownership。

不同：

```text
wall collider #3
column collider #7
```

不应该被合并成一个抽象 `$environment` blocker。

所以 Environment candidate key 使用：

```text
environmentId + colliderIndex
```

1.24 的 failure attribution 也会保留同一 Environment Pack 下的多个 collider candidates。

---

## 4. Current Contact Evidence 会按 Candidate 聚合

`suggestRecoveryActions` 重新读取当前：

```text
PhysicsSystem.articulationContacts()
```

并为 semantic candidate 聚合：

```text
pairCount
contactCount
activeContactCount
minDistance
totalImpulse
colliderIndices[]
```

这是 factual Physics evidence。

---

## 5. Contact Strength 不用于 Causal Ranking

即使：

```text
obstacle_01 impulse = 100
obstacle_02 impulse = 1
```

Runtime 仍不能证明：

```text
obstacle_01 是更主要的 root cause
```

因此 1.24 不根据：

```text
impulse
penetration depth
activeContactCount
```

给 causal score。

这些字段只进入 `currentContact` evidence。

---

## 6. Typed Eligibility

每个 proposal 现在带：

```text
candidateType
```

当前类型：

```text
object-root
articulated-part
environment-collider
unknown
```

其中 `articulated-part` 当前仍明确：

```text
ARTICULATED_PART_RECOVERY_UNSUPPORTED
```

不会被当成可搬 Object root。

---

## 7. 当前 Ranking 只表示执行成本

有多个 eligible pickup recovery 时：

```text
ranking.strategy
= eligible-pickup-route-cost-v1
```

排序规则：

```text
1. eligible first
2. pickupRouteCost ascending
3. stableBlockerKey ascending tie-break
```

并明确：

```text
ranking.causal = false
```

---

## 8. 为什么用 Pickup Route Cost

所有进入 eligible 集合的 candidate 已经通过：

```text
current contact
Policy
carry capability
pickup geometry preflight
```

因此 route cost 是一个确定性的、与 recovery 执行成本直接相关的比较量。

它不试图回答“谁最可能造成 STALL”。

---

## 9. Stable Tie-break

两个候选 route cost 完全相同时，用 stable semantic blocker key 排序。

这保证：

```text
同一 world state
→ 同一 proposal order
```

而不是依赖 Map / contact enumeration 的偶然顺序。

---

## 10. `rank`

Eligible proposal 会得到：

```text
rank = 1, 2, ...
```

Ineligible / denied / stale candidate 不获得 executable rank。

---

## 11. `recommended`

Root result 现在直接包含：

```text
recommended:
  rank
  blocker
  tool
  args
```

它永远只指向 rank-1 eligible proposal。

没有 eligible proposal 时：

```text
recommended = null
```

---

## 12. `rankingEvidence`

每个 eligible proposal 当前记录：

```text
rankingEvidence:
  causal = false
  pickupRouteCost
```

再次避免把排序误读成因果判断。

---

## 13. 一次 Evidence Epoch 最多执行一个 Recovery

1.23 duplicate gate 已经规定：

```text
一个 original failure evidence epoch
→ 同一 recovery 只真正执行一次
```

1.24 进一步把 multi-candidate policy 明确成：

```text
选择一个 ranked recovery
→ 执行
→ 立即 retry original action
```

而不是：

```text
先把所有 candidates 都处理掉
```

---

## 14. 为什么不能连续 Pickup 多个 Blocker

1.23 的 recovery success 会让 blocker：

```text
heldBy = agent
```

这会占用唯一 Hold Anchor。

因此：

```text
recover blocker A
→ recover blocker B
```

在没有 verified cleanup/drop/place contract 前会违反 hands-full 约束。

这也是 1.24 下一阶段边界的直接来源。

---

## 15. Original Retry 仍是唯一成功判据

即使 rank-1 recovery verified：

```text
unresolved original failure
仍然保留
```

必须：

```text
fresh replan
→ retry original mutation
```

只有原始 post-condition verified 才清 ledger。

---

## 16. 如果 Rank-1 Recovery 没解决问题

如果原始 retry 再次 STALL：

```text
这是新的 failure evidence epoch
```

Runtime 会重新：

```text
采样 contacts
生成 candidates
计算 eligibility
重新 ranking
```

旧 rank 不跨 evidence epoch 复用。

---

## 17. Multi-candidate Unit Regression

测试场景故意让：

```text
blocker_01:
  impulse = 100
  minDistance = -0.02
  pickupRouteCost = 5

blocker_02:
  impulse = 1
  minDistance = -0.001
  pickupRouteCost = 2
```

期望：

```text
recommended = blocker_02
```

证明 contact strength 没有偷渡成 causal priority。

---

## 18. Collider-switch Regression

Failure-time candidate：

```text
blocker_01 collider #0
```

Current contact：

```text
blocker_01 collider #1
```

仍然要求：

```text
CONTACT_EVIDENCE_STALE = false
currentContact.colliderIndices = [1]
```

因为 semantic blocker 没变。

---

## 19. Environment Dedup Regression

同一 world pack：

```text
monument-hall collider #3
monument-hall collider #7
```

必须成为两个 distinct Environment candidates。

Object 多 collider 则按 Object/Part 合并。

---

## 20. Articulated Part Regression

Candidate：

```text
objectId = articulated_01
partName = door
```

要求：

```text
candidateType = articulated-part
eligible = false
reason = ARTICULATED_PART_RECOVERY_UNSUPPORTED
```

不会调用 `findPickupPlan()`。

---

## 21. Real Model Multi-candidate Probe

新增：

```bash
npm run agent:probe -- recovery-multi
```

模拟 STALL 同时给：

```text
obstacle_01 routeCost 5
obstacle_02 routeCost 2
```

并故意让 obstacle_01 的 contact impulse 更大。

---

## 22. Nemotron Probe

当前严格样本：

```text
open → STALL
suggestRecoveryActions
→ rank-1 obstacle_02
recoverPickupBlocker(obstacle_02)
retry original open
→ action-completed
```

没有尝试先处理 obstacle_01。

---

## 23. Muse Probe

Muse 当前样本执行相同顺序，并在 final 中明确说明：

```text
obstacle_02 是因为 lower pickup-route cost 排 rank-1
```

而不是因为它被证明是更强 causal blocker。

---

## 24. 当前 Claim

AgentScape 现在可以说：

> 对一次具有多个 current-contact blocker candidates 的 articulated STALL，Runtime 能对每个 candidate 独立执行 typed eligibility，聚合当前 Physics contact evidence，并在多个 executable pickup recovery 之间以确定性的 pickup route cost 进行 non-causal ranking，提供 rank-1 recommended proposal；Agent 每个 failure evidence epoch 最多执行一个 recovery，随后必须重新验证原始 action。

不能说：

> AgentScape 已经证明 rank-1 candidate 是最主要物理根因。

---

## 25. 下一阶段：Recovery Cleanup

当前 rank-1 pickup recovery 成功后：

```text
blocker held by Agent
```

因此下一瓶颈不是更多 ranking，而是：

```text
如何把 held blocker 安全放到不会重新阻挡原任务的位置？
```

下一阶段应建立：

```text
held recovery blocker
→ free-space candidate
→ policy / reach / collision checks
→ verified cleanup placement
→ fresh re-observation
```

仍然不能把 cleanup 成功冒充原始任务成功。

---

## 26. 1.25：Rank-1 Recovery 后的 Hands-full 已闭环

1.24 一次 evidence epoch 只执行一个 ranked recovery。若 original retry 后新的 evidence 仍需要另一个 pickup blocker，而 rank-1 blocker 仍在 Hold Anchor，1.25 不连续 pickup；`suggestRecoveryActions` 会识别 `HANDS_FULL + recoveryHeld provenance` 并给 `cleanupRecommended`。Verified cleanup 后 fresh replan，再重新计算候选/rank。详见 [`recovery-cleanup.md`](./recovery-cleanup.md)。

---

## 26. 1.26：Ranking 开始比较不同 Recovery Primitive

1.26 的 eligible set 不再只有 pickup recovery，也可能包含 `articulated-blocker`。因此 strategy 名称升级为 `eligible-recovery-route-cost-v2`。排序仍只表达当前 executable recovery 的 approach/interaction route cost，`causal=false` 不变；contact force 不进入 root-cause score。详见 [`articulated-recovery.md`](./articulated-recovery.md)。
