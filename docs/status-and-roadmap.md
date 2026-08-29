# 当前完成度与路线图

本文描述 **1.34.2** 当前状态。

总体完成度只能作为粗略参考。按“从普通 GLB 到可信 Agent World”的完整目标估计，目前约：

```text
0%        20%       40%       60%       80%      100%
│----------│----------│----------│----------│----------│
██████████████████████████████░░░░░░░░░░░░░░░░░░░░
                              ▲
                           当前 ≈ 91%
```

91% 不是“代码写完 91%”，也不表示 AgentScape 的最终使命已经完成 91%。这个数字只粗略衡量当前定义下 **“普通 GLB → 可信 Agent World + 当前 generated-world vertical slice”** 的成熟度。1.34 已闭合 Prompt→WorldSpec→deterministic composition→canonical admission→missing-asset bounded regeneration；基础 Runtime / Asset→Executable 纵向链已经成熟，当前 generated-world 主线剩余主要是 non-retriable finding 的受约束 WorldSpec revision 与更复杂的全局空间约束。

最终使命、World IR、五大核心系统和多 AI 分工，统一见 [`mission-and-system-plan.md`](./mission-and-system-plan.md)。

---

## 1. 模块成熟度

| 模块 | 当前估计 | 说明 |
|---|---:|---|
| Web Runtime | 90% | Three / Rapier / lifecycle / persistence + kinematic Agent Body 已形成稳定运行时 |
| Human Editor | 75% | 可用，但不是当前差异化主线 |
| Skill / Policy / Trace | 98% | outcome / mutation barrier / unresolved ledger + compact context + 1.23 auxiliary recovery / shared authorization 已形成统一执行边界 |
| Spatial API | 95% | placement / Recast / interaction pose / support truth 稳定；1.22 又把 live Physics contact provenance 作为按需失败证据暴露 |
| Scene Persistence / History | 88% | schema / autosave / undo-redo + heldBy persistence + 跨帧 embodied transaction 已稳定 |
| Asset Compiler 基础 | 90% | inspect / normalize / budget / quality 很完整 |
| Part / Articulation Compiler | 80% | proposal / hierarchy / joint / materialization 已通 |
| Part Geometry / Collider | 85% | local AABB + per-part CoACD 已通 |
| Runtime Articulation | 97% | 多级 Part + Rapier motor + action sweep + 1.19 live joint completion / STALL / TIMEOUT / verified promotion 已通 |
| Runtime Verification | 99% | Recovery、Physics-first hypothetical geometry、adaptive sampling/calibration 与 1.30 convergence/nested-frame gate 已闭环；剩余是 third-object/environment hypothetical coverage 与 broader calibration |
| 自动 Part Segmentation 接入 | 50% | 协议/物化已通，默认模型未绑定 |
| 自动 Semantics | 35% | 仍以 evidence/provider 为主 |
| 自动 Joint / Target 推断 | 30% | 保守，不愿用猜测换 coverage |
| Grasp / Manipulation Geometry | 52% | hold/pickup/carry/place + deterministic pickup + 1.25 world-space recovery cleanup 已通；仍无 IK / grasp force / payload limit |
| Navigation / Reachability | 90% | 1.15 已有 Detour path + Rapier physical locomotion；自动动态 replan / off-mesh / multi-agent avoidance 仍缺 |
| 大型 World Runtime | 58% | 1.13 已有 96×72m 城市基线；19 Recast meshes / 38 renderables / 330–489ms build，当前暂无 streaming 证据 |
| Multi-Agent | 10% | 不是当前优先级 |
| 完整生成式 World Pipeline | 76% | 1.34 已有 missing-asset-only bounded regeneration、fixed attempt budget 与 exact-plan duplicate gate；下一步按新架构先收敛 World IR revision/acceptance contract，再实现 non-retriable finding→受约束修订 |
| Pages / Art Direction | 78% | Monument Hall + Ruined Courtyard + Grand Urban Block；world pack JS 已按当前选择 lazy load |
| Developer Observatory | 72% | 独立 Vite 入口；Physics + Spatial Lab、fixed-step replay、Rapier/Jolt normalized comparison、production debug contracts 已通；Navigation/Interaction/Agent Lab 尚未实现 |

---

## 2. 当前最成熟的纵向链

```text
普通 GLB
  ↓
Inspect / Structure
  ↓
Conservative Normalize
  ↓
Resource Admission
  ↓
Segmentation Evidence
  ↓
Face Materialization
  ↓
Stable GLB Part Nodes
  ↓
Part Proposal
  ↓
Joint Frame
  ↓
Browser Part AABB fallback
  ↓
Executable Promotion
  ↓
Per-Part Heavy Geometry
  ↓
CoACD convexHull
  ↓
Collision Ownership
  ↓
Manifest
  ↓
AssetManager
  ↓
Rapier
  ↓
open / close
  ↓
ArticulationVerifier
```

这条链已经有真实 cabinet E2E，不只是 mock。

---

## 1.35 World Viability Gate — Runtime World 已可执行

2026-08-29，新增 `npm run world:viability`，把此前分散的 World/Physics/Navigation/Interaction/Agent/Acceptance 能力串成单一产品 Gate。

旗舰链：

```text
WorldIR INSIDE cup→cabinet.interior
→ real cabinet.glb shell + articulated Door
→ Recast approach
→ OPEN verified
→ PICKUP from cabinet interior verified
→ long-distance CARRY
→ PLACE table.top verified
→ Rapier settle + ON
→ World Acceptance 7/7
→ inject drift
→ acceptance replay detects cup-on-table regression
→ Scene restore with fresh Physics World
→ persistent-state acceptance 7/7
```

当前 verdict：

```text
runtime-world-usable
```

但 canonical world admission 仍为 `provisional`，原因是当前 Asset/Layout evidence 仍带 `ASSET_PROVISIONAL / LAYOUT_PROVISIONAL`。因此“Runtime 可用”和“所有 admission evidence 已 ready”必须继续区分。

本阶段同时补齐：canonical `INSIDE`、Manifest `receptacles`、cabinet shell collider、carry-aware overlap validation、placement clear-endpoint LOS，以及 restore-time Physics World rebuild。详见 [`world-viability.md`](./world-viability.md)。

---


## 1.36 Developer Observatory — Production Runtime 可观测面

2026-08-29，`observatory/` 正式成为与 Studio 平级的 Developer Product Surface，但不拥有第二套业务 Runtime：

```text
Production Runtime
      │
      ├──► Studio       完整产品组合
      ├──► Observatory  人工单步 / 可视化 / 对照
      └──► Tests        自动验证
```

当前已经落地：

```text
Physics Lab
├─ Rapier
├─ Jolt
├─ Rapier ↔ Jolt normalized comparison
├─ Gravity / Collision / Stack / Hinge
├─ production Cup / Cabinet truth comparison
├─ fixed 60 Hz step / checkpoint / replay
├─ normalized body/collider/joint/contact snapshot
└─ Rapier native debug geometry

Spatial Lab
├─ three-mesh-bvh Runtime contract
├─ Raycast nearest-instance truth
├─ Bounds / overlap
├─ Support / free-space
└─ deterministic query replay
```

架构约束：

- Observatory 可以 import 生产 Runtime/domain；生产代码禁止反向依赖 Observatory。
- Debug UI 只消费 `PhysicsSystem.debugSnapshot()` / `SpatialSystem.debugSnapshot()` 等正式 observation contract，不穿透 solver-private world。
- Synthetic geometry 可以自建，但 production Manifest / Schema / Runtime contract 必须直接复用；synthetic hinge 已改为复用真实 cabinet manifest。
- BVH ownership 归 World/Spatial；AssetManager 不再依赖 prototype patch 的隐式初始化顺序。

下一阶段顺序：

```text
Navigation / Recast Lab
→ Interaction Lab
→ AgentTools / Run Lab
```

详见 [`observatory.md`](./observatory.md)。

---

## 3. 1.8 已完成：Motion Sweep Validator

当前 verifier 已经从：

```text
target accepted?
finite?
moved?
```

升级到：

```text
PRE_CONDITION
     │
     ▼
EXECUTION
     │
     ├─ progress
     ├─ stall
     ├─ penetration regression
     ├─ finite
     └─ joint limit
     │
     ▼
POST_CONDITION
     │
     └─ target reached
     │
     ▼
RETURN / REVERSIBILITY
```

已覆盖 prismatic、revolute、初始 overlap baseline、新碰撞、同 pair penetration 加深、motor stall、越界 target、open→close return，以及真实 `cabinet.glb` Compiler→Runtime E2E。

没有新增 `MotionValidatorManager`，仍然由 `ArticulationVerifier` 作为唯一 verification truth。

---

## 4. 1.9 已完成：Static Navigation Truth

1.9 已把：

```text
findFreeSpace
```

与：

```text
canReach / findPath
```

分成两种真实能力。当前 `NavigationSystem` 使用 lazy Recast/Detour，支持端点吸附、静态连通性、路径 waypoint 与 path cost；真实 cabinet GLB 已进入 E2E。

1.9 当时的边界是：dynamic object / executable Part 不进入 static base，查询只承诺 `scope=static`。这个边界在 1.10 **没有被删除**，而是保留为 Recast base，再由 TileCache + Rapier collider 形成 current-world overlay；因此不要把 1.9 的 static base 与 1.10 的最终查询 scope 混为一谈。详细契约见 [`navigation.md`](./navigation.md)。

---

## 5. 1.10 已完成：Dynamic Obstacle Truth

1.10 沿 Recast/Detour 官方 TileCache 补齐动态障碍，但没有把 Physics 高频帧直接灌进导航：

```text
Static Recast NavMesh
        +
query-time Rapier collider snapshot
        ↓
TileCache obstacle diff
        ↓
current-world Detour query
```

当前覆盖：

```text
dynamic Root box/cylinder
articulated Part box/cylinder
tiltted box/cylinder → physics-derived conservative AABB
convexHull           → physics-derived conservative AABB
unsupported shape    → skipped + coverage=partial
```

查询报告：

```text
scope = current
dynamicObstacles.coverage = complete | partial
tracked / changed / operations / updates / syncVersion
```

已验证：dynamic barrier 移动前后可达性改变而 static `buildVersion` 不变；70 个 obstacle 不触发 TileCache 64-request queue overflow；真实 Rapier articulated Door collider pose 会随 open 轨迹更新。

---

## 6. 1.14 已完成：Single-action Action-aware Reachability

`suggestNavigationActions(start,end)` 现在可以利用 dynamic obstacle provenance 找到可开 Part，并通过临时 TileCache suppression 判断“如果这个单一 obstacle 不再阻挡，路径是否出现”。结果严格标 provisional；compiled articulation 必须 runtime verified 才能成为 recommendation。真实 Rapier Door 已验证 `recommend open → open → physics step → current findPath reachable`。

当前仍不做多动作搜索：两扇门串联、需要先移动箱子再开门、RRT/TAMP 等组合问题不在 1.14 范围。

---

## 7. 1.15 已完成：Embodied Locomotion

现在已有：

```text
builtin Agent Body
      ↓
Detour current path
      ↓
LocomotionSystem waypoint state
      ↓
Rapier CharacterController
      ↓
physical stairs / walls
      ↓
arrived | blocked
```

真实 Ruined Courtyard E2E 已从 `[0,0,12]` 走上 `[12,1.2,4.8]` 高台；physical-only wall E2E 会返回 `PHYSICS_BLOCKED`，不会 teleport。跨帧 `navigateTo` 仍只有一个 History transaction，并发 world-write 使用 `WORLD_MUTATION_BUSY` 拒绝。

---

## 8. 1.16 已完成：Interaction-range Open / Close

`approachAndInteract` 现在把：

```text
Detour reachable
+ fixed 1.5m range
+ Rapier line-of-sight
+ Agent clear of articulation sweep
+ real locomotion
+ arrival recheck
```

合成一个具身 open/close transaction。真实 Cabinet E2E 曾证明“只满足 range+LOS”仍会让 Agent 自己挡住 Door，因此加入基于 joint contract 的 swept AABB；Prismatic drawer 也有独立回归。

---

## 9. 1.17 已完成：Agent Hold Anchor / Carry Ownership

`approachAndPickup` 现在会先完成 interaction pose / locomotion / range / Rapier LOS，再对对象到 hold anchor 做 shape cast。成功后唯一 durable ownership 写在对象 `state.heldBy`；对象切为 kinematic 并随 Agent anchor 移动。Locomotion 会忽略 holder-self collider，但独立验证 carried object 下一 anchor pose；杯子先撞墙时返回 `CARRIED_OBJECT_BLOCKED`。

`graspVerified` 明确为 false：这是 carry attachment，不是假装机器人夹爪力学已经完成。

---

## 10. 1.18 已完成：Agent-held Place / Release Truth

`approachAndPlace(actorId, supportId)` 现在从当前 `heldByAgent(actorId)` 自动推导被放置对象，先在目标 surface 上寻找 free space，再用 carry-aware stand-off 找可达交互位。Release 不是 teleport：held object 以 `lift → traverse → lower` 三段 Rapier shape cast 移到 release pose；随后 detach 为 Dynamic，等待 sleeping / 低速度稳定窗口，并用与 SceneGraph `ON / SUPPORTS` 同源的 `supportStatus` 做最终 post-condition。

真实 E2E 同时覆盖：

```text
normal Table
→ placed + supportVerified=true + settled=true

release trajectory blocker
→ PLACE_TRANSFER_BLOCKED + stillHeld=true

manifest surface 与真实 Physics support 不一致
→ Dynamic 掉落后 place-failed / SUPPORT_NOT_REACHED

settle timeout
→ place-unverified
```

这轮也修正两个具身 reference bug：interaction candidate 的 Y 应来自 target root placement reference，而不是 visual `bounds.min.y`；Place stand-off 必须考虑 held-object envelope，而不仅是 Agent capsule。

---

## 11. 1.19 已完成：Live Articulation Completion / Verified Action Sequencing

`approachAndInteract` 现在在 motor request 后持续观察 live joint coordinate；只有 target error 在 revolute/prismatic tolerance 内持续稳定窗口，并且窗口内 coordinate movement 足够小，才返回 `action-completed + targetReached + settled`。真实 external blocker 会得到 `action-failed / STALL`；持续有进展但无法证明终态得到 `action-unverified / TIMEOUT`。

Durable state 同时拆成 `partTargets=requested` 与 `parts=verified`。Observer 本身不越权写 durable Scene；成功只能由仍在运行的高层 mutation promote。失败时同一 transaction 会把 motor target hold 在当前 coordinate 并清理 active request。

---

## 12. 1.20 已完成：Verified Multi-step Task Sequencing

ToolCallingAgent 现在把 SkillRegistry `mutates=true` 当成确定性 replan barrier：一个 planning response 中第一个 world mutation 执行后，剩余 tool calls 不执行但仍回填协议完整的 `not-executed / REPLAN_REQUIRED_AFTER_WORLD_CHANGE`；下一轮重新读取 world 再规划。

`SkillRegistry.executionPolicy` 统一分类 `verified / blocked / failed / unverified / requested / noop / accepted / error`，因此 `executeBatch` 也不会再把 structured failure 当成功 commit；跨帧 embodied/navigation/request-only Skill 在 batch preflight 就被拒绝。ToolCallingAgent 维护 runtime-only `unresolvedMutations`，早期 STALL 等 adverse step 不会被后续某个成功 mutation 洗白。Pages 直接显示 deterministic `taskStatus`。

真实 LocalPlanner→SkillRegistry→Navigation/Locomotion→Rapier 三步 E2E 已通过 `open → pickup → place`；真实 Door blocker 则只执行 open 并以 STALL/incomplete 终止。完整任务还暴露并修正了 carried-object arrival yaw：Place candidate 预检朝 release 后的 HoldAnchor reach，到达后用分段 Rapier clearance 原地 reorientation。

---

## 13. 1.21 已完成：Compact Task Observation / Recovery Context

`agentscape.task-observation.v1` 现在把 actor pose/navigation/carry、last/unresolved mutation、相关对象、少量 SceneGraph relations 与 live articulation 压成 provider-neutral read model。首轮 planning 仍发送完整对象索引；发生 mutation 后只发送 compact `id/asset` entity index + relevant task evidence，不再重复整个 world list。

Recovery Hint 明确 `status=provisional`，并且不再推荐重复读取已经嵌入 context 的事实。真实 Muse STALL probe 证明 prompt 本身不足以防止 read-loop，因此 ToolCallingAgent 增加默认 4 个 bounded read-only recovery rounds；继续只读会以 `recovery-observation-limit` 保留 unresolved ledger 结束。真实模型还暴露 implicit Door / explicit `partName=door` retry identity 漂移，现已用 Runtime result 中实际执行 Part 做 canonicalization。

---

## 14. 1.22 已完成：Failure Attribution / Contact Provenance

PhysicsSystem 现在在 collider 创建时登记稳定 provenance：Object collider 带 `objectId / partName / colliderIndex`，Environment collider 带 `environmentId / colliderIndex`。Object remove、attach rollback、dispose 都清理该索引。Live articulation 只有在 STALL 已确定后才用 Rapier narrow-phase `contactPairsWith/contactPair` 采样 current active contacts。

为避免把 prediction-distance proximity 误叫接触，只有 `contactDist<=1e-6` 或存在 solver impulse 的 point 计入 `activeContactCount`。Failure result 输出 `attribution.status=contact-evidence`、`evidence=current-contact-at-failure` 与去重的 `blockerCandidates`；没有 external active contact 则为 `unattributed`。这些 candidate 明确不是唯一 root-cause 证明。`getArticulationStatus` 与 compact task observation 都保留该证据。Nemotron/Muse strict attribution probe 已能指出 `obstacle_03` 并正确描述 evidence boundary。

---

## 15. 1.23 已完成：Verified Recovery Action / Blocker-aware Replan

Attributed STALL 现在可以进入一条严格受限的 pickup-blocker recovery：`suggestRecoveryActions` 先重验 current contact，再通过 `SkillRegistry.authorization`、现有 carry capability 与 `findPickupPlan` geometry preflight 判断 eligibility。Environment、non-root articulated Part、Policy denied、stale contact、不可 carry 或没有 transfer-clear pose 都不会产生 executable proposal。

真正 mutation 使用专用 `recoverPickupBlocker`，执行前再次生成 proposal；它是 `mutates=true / barrier=true / batchable=false / auxiliary=true`。Auxiliary 只表示“不把恢复动作本身变成新的用户 unresolved 子目标”，不会绕过 History/Policy/Trace，也不会清除原始 open failure。真实 Rapier/Recast E2E 已验证 Dynamic blocker `STALL → suggestion → pickup recovery held → fresh replan → retry open → action-completed`；另一条 Environment blocker E2E 要求 `ENVIRONMENT_IMMOVABLE`、零 recovery mutation、任务继续 incomplete。Nemotron/Muse recovery probe 同样要求 recovery 后原 unresolved 保持 1，直到原 action verified 才归零。

---

## 16. 1.24 已完成：Recovery Generalization / Multi-candidate Ranking

一次 STALL 的多个 candidates 现在会逐个做 typed eligibility，并聚合当前 Physics contact evidence。Object blocker 使用 `objectId + partName` semantic identity，因此当前 contact 从 collider #0 切到 #1 不会误判 stale；Environment 则保持 `environmentId + colliderIndex`，同一 world pack 的不同固定几何可以独立列出。`candidateType` 当前区分 `object-root / articulated-part / environment-collider / unknown`，其中 articulated Part 仍明确 unsupported，不会被当成 root pickup。

多个 eligible pickup recovery 会按 `eligible-pickup-route-cost-v1` 排序：只比较 pickup route cost，再用 stable blocker key tie-break；`ranking.causal=false`，contact impulse/penetration/activeContactCount 仅作为 `currentContact` evidence 展示。Root result 直接给 `recommended` rank-1。真实 Nemotron/Muse `recovery-multi` probe 故意让 obstacle_01 接触更强但 routeCost 更高，两模型都选择 routeCost 更低的 obstacle_02，只执行一次 recovery 后立即 retry original open 并 verified。

---

## 17. 1.25 已完成：Verified Recovery Cleanup / Held Blocker Placement

`recoverPickupBlocker` 成功后会记录 transient `recoveryHeld` provenance，但 durable ownership 仍只有 `state.heldBy`，Scene restore 不恢复 recovery intent。新的 `findRecoveryCleanupPlan` 不复用 support-surface `findFreeSpace`：它围绕 original articulation sweep 生成 world-space perimeter candidates，Rapier downward ray 找 Environment 支撑，Detour 验证 Agent stance，并以 `bodyPoseClear` 检查最终 held-body endpoint。真正 `cleanupRecoveryBlocker` 到达后重新规划、reorient held body，并与普通 Place 共用 `transferHeldToRelease` 三段 `bodyMotionClear`；释放 Dynamic 后仍进入同一个 `settleTasks` owner。 Cleanup proposal 同样复用 `SkillRegistry.authorization(cleanupRecoveryBlocker)`；Policy denied 时只返回 denied evidence，不暴露 executable cleanup tool，也不继续做 cleanup geometry search。

只有 `released + settled + sweepClear + contactClear` 全部成立，SkillRegistry 才把 `recovery-cleaned` 判为 verified。Cleanup 是 auxiliary housekeeping，不会清 original unresolved。`suggestRecoveryActions` 只在新的 blocker 因 `HANDS_FULL` 不可 pickup、且手里确实是上一轮 recovery blocker 时提供 `cleanupRecommended`；普通任务 held object 不会被擅自清理。真实 Rapier/Recast cleanup E2E 已验证 blocker settle 后离开 Door sweep 且 contact clear；Nemotron/Muse `recovery-cleanup` probe 已跑通双 blocker：recover #1 → retry still STALL → cleanup #1 → recover #2 → final original retry verified。CodeGraph 审计还推动 `beforeRemove` 同时取消 `settle.objectId/targetId`，避免 target 删除留下 pending settle。

---

## 18. 1.26 已完成：Articulated Blocker Recovery

`candidateType=articulated-part` 现在可以进入窄范围 recovery，但只在 blocker Part 当前 `verifiedAction` 明确、`requestedAction=null`、不在 moving、Manifest 中恰好一个 alternate executable `open/close`、current contact 仍存在、Policy 允许且 `findInteractionPose(action,partName)` 成功时。Unverified / pending / ambiguous 都明确 ineligible。Eligible proposal 使用 `recoverArticulatedBlocker`；该 Skill execution-time 会重新生成 recovery proposal，再真实调用 `approachAndInteract` blocker Part。它是 auxiliary mutation，成功只验证 blocker 改态，original unresolved 仍保留到 original action fresh retry verified。

真实 Rapier/Recast 两柜 E2E 已验证：B.door 真实 open 后阻挡 A.door，A.open 发生 STALL/contact attribution；Agent 真实 approach B 并 close verified，随后 A.open retry verified。该 E2E 还推动 `approachAndInteract` 增加一次 0.05m arrival correction fallback：只在默认 arrival 后 exact action sweep 发现 Agent 因停车误差挡住动作时触发，重新检查 range/LOS/sweep；planner stance selection 与最终 sweep 都没有放宽。Nemotron/Muse `recovery-articulated` probe 均通过。

---

## 19. 1.27 已完成：Counterfactual Articulated Recovery / Multi-action Choice

同一个 articulated blocker Part 若有多个 alternate executable open/close，Runtime 不再让 LLM 猜。只有 current Rapier contact 仍存在、blocker verified state 明确且不 moving 时，才复用 `actionSweepBounds` 构造 original failed sweep、current blocker target pose、每个 alternate target pose / action sweep，并结合 `findInteractionPose` 形成 `articulated-target-sweep-counterfactual-v1`。Evidence 明确 `causal=false / geometry=three-aabb`；只有 `overlapReduction>0` 的 executable action 才进入 rank，优先 target 完全离开 original sweep，再比较 reduction / remaining overlap / action-sweep overlap / route cost。完全 tie 不产生 rank。

真实两柜 E2E 将 B.door settle 到 `ajar=-0.8`，A.open 随后真实 STALL/contact B.door；current Three AABB overlap 约 .664，B.open target 仍约 .622，B.close target 为 0，因此 close rank-1。Agent 真实 close B 后 fresh retry A.open verified。`recoverArticulatedBlocker` execution-time 会重新 ranking；若 selected action 改变，旧请求 `COUNTERFACTUAL_SELECTION_CHANGED` stale。Nemotron/Muse `recovery-counterfactual` probe 都通过，1.26 unique-action probe 也重新通过。

---

## 20. 1.28 已完成：Physics-backed Counterfactual Geometry

1.28 在不创建 shadow world、不移动 live body、不调用 motor 的前提下，把 1.27 multi-action choice 升级为 Physics-first evidence。`articulationColliderPoses` 复用当前真实 Rapier Part body/collider pose 与 collider shape，推导指定 hypothetical joint coordinate 的 collider world poses；`articulationPairCounterfactual` 对 original failed trajectory 与 blocker current/target/action trajectory 各采样 17 个 coordinate，用 `Shape.intersectsShape` 统计 `conflictSamples / pairIntersections / conflictSamplePairs`。所有 executable actions coverage 完整、current baseline 一致且 current conflicts>0 时，使用 `articulated-rapier-shape-counterfactual-v2 / basis=rapier-shape-pairs`；否则明确 fallback 到 v1 Three AABB。

真实 `ajar=-0.8` 两柜 Physics fixture 显示：open target conflictSamples=13，close target=0，而 current baseline 都是17；真实 Agent E2E 因此使用 Physics v2 推荐 close，并在 recovery verified 后 fresh retry A.open verified。另有专项冲突测试故意让 Three 推荐 open、Rapier 推荐 close，最终 Runtime 必须选 close；若两个 alternate 得出的 current Physics baseline 不一致，则 `PHYSICS_COUNTERFACTUAL_BASELINE_INCONSISTENT` 并降级。Revolute non-zero childAnchor 当前明确 unsupported，不使用错误 pivot 近似。Nemotron/Muse Physics-first probe、1.26 articulated、1.25 cleanup live regression 均通过。

---

## 21. 1.29 已完成：Counterfactual Calibration / Adaptive Sampling / Joint-frame Generalization

Revolute hypothetical pose 现在支持 non-zero `childAnchor`：先保持 child anchor world pivot 固定，再围绕 world joint axis 旋转 body 并修正 body origin；专项 fixture 将 hypothetical target collider pose 与真实 Rapier motor target pose 对拍，position/rotation 均在 articulation tolerance 内，真实 Compiler→Runtime non-zero childAnchor fixture 继续通过。Sampling 也从固定17升级为 `articulationCounterfactualSampleCount`：读取 live Rapier shape extent，revolute 用 joint delta×max lever、prismatic 用线性 delta，resolution 按 collider characteristic radius clamp 到2–8cm，最终5–33 samples；original/blocker trajectory 独立取样，fixed override保留。真实 ajar Door 自动使用 original=12 / open=16 / close=22，真实 prismatic blocker fixture也通过 hypothetical-vs-motor pose验证。

`recoverArticulatedBlocker` verified 后还会做一次只读 `post-recovery-current-contact` observation。若 selected Physics prediction `targetSweepClear=true` 且 current contact 消失，记录 `counterfactualCalibration.consistency=consistent`；若 contact 仍存在则 `contradicted`。该 calibration 只存在于 tool result，明确 `causal=false / originalRetryRequired=true`，不会清 original unresolved。专项反例锁住 prediction clear + live contact remains 时不能隐藏矛盾。Nemotron/Muse strict probe 已升级到 adaptive sampling + calibration contract。

---

## 22. 1.30 已完成：Counterfactual Convergence / Nested-frame Coverage

Selected Physics rank-1 action 现在会经过 `articulationPairCounterfactualConvergence`：先运行 adaptive base，再用更密的 original/blocker independent sample counts（单边 cap 33）重跑。只有 `targetSweepClear` 与 `conflictReduction>0` 两个定性结论都保持一致，Physics v2 才继续；否则 `PHYSICS_COUNTERFACTUAL_UNSTABLE` 并显式降级 Three fallback。Report 同时记录 normalized current/target/action conflict ratios 与 drift，但目前只作 evidence，不变成成功阈值。真实两柜 fixture adaptive→dense 保持 stable；专项反例故意让 dense 翻转 target clear，Runtime 正确撤销 Physics-first。

Nested Door→Slider fixture 也进入真实 motor 对拍：先用 motor 将 free child prismatic 保持在 close，再让 parent Door 真实转到 -0.5rad；此时 child hypothetical +0.35m 的 world axis 跟随 parent rotation，执行真实 child motor 后 predicted/actual local-to-parent pose 在 tolerance 内。测试同时证明 child motor 会让 dynamic parent world pose产生非零 drift，因此 evidence 显式标记 `parent-pose-at-query / parent-poses-static-during-hypothesis`，不 claim parent-child reaction dynamics。Nemotron/Muse convergence strict probe 与 1.26 articulated regression 均通过。

---

## 23. 1.31 已完成：Third-object Hypothetical Collision Coverage

`PhysicsSystem.articulationWorldCounterfactual` 现在对 blocker current/target/action sampled poses 做 Rapier world shape query，并复用现有 collider provenance 区分 Environment / Object / Part。恢复 proposal 只排除 blocker self、Agent 以及 original failed Part pair；original object 其它 Parts/root 仍接受检查。World evidence 采用 introduced-collision 语义：已有 baseline contact不自动 veto，但 target/action 新增 third-object/environment collision 会令该 action `recoveryEligible=false / THIRD_OBJECT_COUNTERFACTUAL_BLOCKED`，且 Physics rank 与 Three fallback 都不能重新选它。Unique alternate 同样执行 world preflight。

Execution wrapper 继续 rebuild proposal，因此 proposal-time safe、执行前第三对象进入轨迹会直接 `recovery-stale / THIRD_OBJECT_COUNTERFACTUAL_BLOCKED`，不会调用 blocker motor。真实 prismatic world-query fixture 能同时发现 third Object 与 Environment wall，且不修改 live articulation coordinate。

---

## 24. 1.32 已完成：Generated World Admission

1.32 把原本分散的 Generator / `EmbodiedGenAdapter` / WorldPipeline 真正接成 canonical generated-world chain。`WorldSpec` 在 mutation 前确定 provider、generate intent、instance id、position 与 ON/NEAR relations；`AssetLibrary` 可以消费 raw `provider=embodiedgen` payload，经 Adapter→Schema→AssetManager 注册。Adapter fallback collider / provider semantics 明确 `provisional`，外部 Generator 即使返回 schema-valid Manifest，没有 Compiler-ready evidence 也默认 `UNVERIFIED_GENERATOR_MANIFEST`。Compiler rejected manifest 不注册。

Pipeline 新增 `normalize_spec / asset_admission`；任何 unresolved/rejected asset 会在 instantiate 前 fail closed，因此 mixed plan 不会留下半个世界。Agent tool 不再暴露 stage selection，不能跳过 validation/finalize。最终 `world-ready / world-provisional / world-rejected` 进入 Skill outcome；rejected world restore 调用前 scene。低层 generate/import/spawn 也暴露 asset-level admission，provisional spawn 不再被当成 verified mutation。

---

## 25. 1.33 已完成：Prompt → Strong WorldSpec / Deterministic World Composer

`runWorldPipeline.plan` 现在暴露 strong WorldSpec schema，明确 `id=world instance / assetId=catalog asset`，position 只有用户明确约束时才应填写。现有 ToolCallingAgent 继续作为唯一 Planner：strict live probe 要求先 search table/chair/cup，再提交单次 WorldSpec，禁止 generate/import/spawn bypass；Nemotron 与 Muse 都能正确表达 `cup ON table / chair NEAR table` 且不提供坐标。

Runtime 新增纯 `WorldComposer`：从 Manifest root colliders 推导 footprint，三个 curated Environment Pack 暴露 deterministic search bounds；同批资产先做 conservative footprint reservation，再用 `PhysicsSystem.manifestPoseClear` 在 spawn 前查询 live Rapier Environment / existing objects。Articulated asset 若只覆盖 root collider，layout 明确 provisional。`NEAR` 省略 distance 时由两侧 footprint + clearance 推导，并按 ±X/±Z 固定顺序做 Physics preflight；显式距离小于安全 spacing 则拒绝。`layoutAdmission / relationAdmission` 最终都进入 world admission。

---

## 26. 1.34 已完成：Bounded World Regeneration

`buildWorldRetryPlan` 现在把 rejected pipeline reports 压成 `agentscape.world-retry.v1` findings/actions。唯一自动 retry 条件是：request 尚未 `generate=true`、AssetLibrary search miss、且 Generator 已配置。Runtime 只为该缺失 request 打开 generation，restore 调用前 scene，并完整重跑 canonical pipeline；固定 budget=2，第二次失败直接 `exhausted`。Layout / relation / post-repair hard validation 均 `not-retriable`，不会自动改 position、NEAR 或其它用户约束。

真实 Generator E2E 已验证：attempt1 missing→retry-proposed→attempt2 真正 `AssetLibrary.generate`→Compiler-ready Manifest→layout→spawn→world-ready。ToolCallingAgent 还用 run-local exact WorldSpec identity 阻止同 plan 重复执行来绕过 budget；真正修订后的 WorldSpec 仍允许执行，并继续用 `runWorldPipeline:{}` 作为同一个 world-build unresolved semantic identity。Nemotron/Muse `generated-world-retry` strict probe 均通过，且 `world-ready` 后不再冗余 `validateWorld`。

---

## 27. 当前 P0：G0 Runtime Atomicity + G1 World IR Foundation

在最终使命重新梳理后，当前 P0 不再直接“恢复一个 WorldRevision 原型”。首先需要把两个基础 contract 稳定下来：

```text
Track A / 轨道 A
WorldRuntime mutation
        ↓
partial mutation + throw
        ↓
restore(before)
        ↓
exception-atomic transaction
异常原子事务

Track B / 轨道 B
Current WorldSpec / 当前 WorldSpec
        ↓
World IR vNext contract
        ↓
revision + provenance
physics requirement
capability/state
interaction/rule intent
acceptance
        ↓
compatibility normalizer
兼容归一化
```

两条基础线稳定后，1.34 已知 non-retriable finding 才进入正式闭环：

```text
layout / relation / validation finding
布局 / 关系 / 验证问题
        ↓
compact evidence / 压缩证据
        ↓
constrained IR revision proposal
受约束 IR 修订提议
        ↓
changed-plan gate / 变更计划门
        ↓
canonical recompile / 标准重编译
        ↓
Runtime + Verification / 运行时重新验证
```

优先研究可机器表达、可归因、可回滚的 revision，不引入无界 search tree，也不允许 finding handler 直接 patch live world 作为永久真值。

Physics 同时进入接口化准备：当前 Rapier 仍是默认实时后端，但长期由 PhysicsBackend contract + capability routing 承担，不把具体 solver 名写进 World IR 语义。

---
## 28. P1：Dynamic Third-body / Environment Counterfactual Fidelity

1.31 将其它 world collider 视为 query-time static background。后续继续研究 dynamic third-body motion envelope / environment moving parts 的保守 coverage，但当前主线优先转向 generated-world orchestration。

---

## 29. 1.11–1.12 已完成：Curated Multi-World Layer

Pages 默认世界从 10 × 8m 测试地面升级为约 32 × 24m 的 `Monument Hall`。这不是纯视觉主题：

```text
Three.js architecture
      │
      ├─ same pack → Rapier fixed colliders
      └─ same root → Recast static geometry
```

真实测试要求 Detour 从大厅前部走到后殿时绕开中央 Monument；Rapier 专项测试要求 Environment collider 真正阻挡 dynamic probe。素材只引入约 2.1MB CC0 HDRI/PBR，并增加 Cinematic Mode；没有引入第二套 Scene state。

1.12 已完成第二个 Environment Pack：`Ruined Courtyard`。它证明第二种视觉/空间语言无需复制 Runtime，并新增 split-level Recast、旋转 fixed collider、world-id autosave 与 Scene environment identity。

1.13 已完成 `Grand Urban Block` 城市级基线：96 × 72m、12 栋模块建筑、426 instanced details，Recast build 约 330–489ms。当前数据不支持提前做 streaming。

下一步内容/规模优先级：

1. 继续做更长时、更多动态物体的 Agent 行为演示，而不是再单纯扩大地面。
2. 记录真实移动端 GPU / texture upload / draw-call 数据；只有出现瓶颈才选择 KTX2 / LOD。
3. 如果未来静态 world 超过当前 96 × 72m 基线并出现 Recast 秒级构建，再研究 region streaming / partial rebuild。

---

## 30. P1：完整 Joint Frame

当前 Joint：

```text
axis
limits
parentAnchor
childAnchor
```

这是有意保守的可执行子集。

SAPIEN 等成熟系统说明更完整的表示是：

```text
parentFrame
  position
  rotation

childFrame
  position
  rotation
```

但只有在 Rapier JS Runtime 能稳定消费时才应该升级 Schema。

原则：

```text
Runtime support first
Schema claim second
```

---

## 31. P2：Compact Agent Observation

随着世界变大，Agent 不可能每轮看到整个 Scene Tree。

未来方向：

```text
compact defaults
omit unchanged/default fields
bounded depth
stable ids
query-to-expand
```

参考 threejs-devtools-mcp / Chisel 的 compact observation 思路。

但要先测真实：

```text
token cost
latency
world size
```

成为瓶颈后再改接口。

---

## 32. 自动语义：宁可慢一点，也不虚构能力

长期目标：

```text
unknown GLB
  ↓
auto segmentation
  ↓
auto semantics
  ↓
joint proposal
  ↓
target proposal
  ↓
physics verification
  ↓
repair
```

当前还没有把这条链自动化到底。

这是有意的。

AgentScape 优先保证：

```text
low coverage + true capability
```

而不是：

```text
high coverage + fake capability
```

---

## 33. 目前不应该成为优先级的方向

竞争者审计后明确：

```text
更多 Editor Panel
Visual Scripting / Blueprint
复杂 ECS 迁移
Isaac-style Manager 体系
第二套 MCP Runtime API
为了文件长度拆 main.js
```

这些并非永远不做，而是当前没有足够证据证明它们比 Motion Truth / Navigation Truth 更重要。

---

## 34. 产品差异化应该是什么

不应该只是：

```text
AI + Three.js Editor
```

AgentScape 更值得守的产品边界是 **World Compilation Authority / 世界编译权**：

```text
Natural-language World Intent / 自然语言世界意图
                 ↓
World IR / 世界中间表示
                 ↓
┌──────────────────────────────────┐
│ Asset Compiler / 资产编译器      │
│ Interaction & Rule Compiler      │
│ 交互与规则编译器                 │
└────────────────┬─────────────────┘
                 ↓
World Runtime / 世界运行时
                 ↓
Physics Capability / 可替换物理能力
Navigation / 导航
Interaction / 交互
                 ↓
Verification / 验证
                 ↓
Machine-readable Finding / 机器可读问题
                 ↓
Bounded Repair + IR Revision / 有界修复与 IR 修订
                 ↓
Verified World / 已验证世界
```

关键差异不是“用了 Rapier”或“接了哪个 3D Generator”，而是任何 Provider、Planner、Physics Backend 都必须进入同一编译与验证真值链。

---

## 35. 未来完成态

最终 100% 不再定义成“把已有 Runtime feature list 全做完”，而是五大核心能够形成稳定的闭环：

```text
① World Planner / 世界规划器
Natural language → World IR
自然语言 → 世界 IR
          │
          ▼
② Physical-Semantic Asset Compiler / 物理语义资产编译器
Raw 3D → Executable Entity
原始 3D → 可执行实体
          │
          ▼
③ Interaction & Rule Compiler / 交互与规则编译器
Semantics → Executable Behavior
语义 → 可执行行为
          │
          ▼
④ World Runtime / 世界运行时
Render + Physics + Navigation + State
渲染 + 可替换物理能力 + 导航 + 状态
          │
          ▼
⑤ Verification & Repair / 验证与修复
Execute → Verify → Attribute → Repair
执行 → 验证 → 归因 → 修复
          │
          └──────── constrained revision / 受约束修订 ───────► World IR
```

物理层的最终形态是：

```text
PhysicsRequirement / 物理需求
        ↓
Physics Capability Router / 物理能力路由
        ├─ Rapier Adapter / 当前默认实时刚体与关节
        ├─ Validation Backend / 高精度验证后端
        └─ Future Backend / Genesis、PhysX 或其他候选
```

AgentScape 不重新发明 solver；它负责选择满足 contract 的物理能力、管理 authority scope，并把真实执行结果交给 Verification。

North-star / 北极星不是“场景看起来正确”，而是用户给出完整世界任务后：

```text
Prompt
  ↓
World IR
  ↓
Asset + Behavior Compile
  ↓
World Runtime
  ↓
Agent executes
  ↓
Physics / Navigation / State evidence
  ↓
World Acceptance
  ↓
VERIFIED TASK COMPLETE
任务真实验证完成
```

当前 AgentScape 已经拥有很强的 Runtime、Asset Compiler 与 action-level Verification；主要缺口转向 World IR、Behavior Compiler、PhysicsBackend abstraction、world-level acceptance 与 bounded local repair。

因此文档顶部约 91% 的数字不能拿来表示这套最终使命的总完成度。

---
## 当前验证基线

1.34.2 文档快照对应的仓库验证基线：

```text
112 Test Files PASS
386 Tests PASS
GLB asset validation PASS
Production build PASS
Monument Hall Environment Recast/Rapier PASS
Ruined Courtyard split-level Recast PASS
Grand Urban Block 96×72m Recast benchmark PASS
Action-aware Navigation E2E PASS
Embodied Locomotion Ruined Courtyard E2E PASS
Embodied interaction range / Rapier LOS E2E PASS
Live articulation completion E2E PASS
External blocker → action-failed / STALL PASS
High-level post-approach STALL / stateFinalized PASS
Revolute / prismatic live articulationState PASS
Target tolerance + coordinate-stability settle PASS
TIMEOUT / SUPERSEDED / observer cancellation PASS
Requested partTargets / verified parts restore compatibility PASS
Articulation completion event-kind separation PASS
Nemotron live action-completed interaction probe PASS
Verified multi-step Runtime E2E PASS
Real Door STALL sequence stop PASS
Mutation barrier / protocol-complete not-executed PASS
Unresolved mutation ledger / verified retry PASS
Semantic executeBatch rollback PASS
Unbatchable embodied skill preflight PASS
Carry reorientation / release-reach guard PASS
Nemotron verified sequence success probe PASS
Muse verified sequence success probe PASS
Nemotron STALL sequence failure probe PASS
Muse STALL sequence failure probe PASS
Muse live action-completed interaction probe PASS
Strict action-completed / placed post-condition classification PASS
Numeric Physics error metric vs Tool Error classification PASS
Agent carry / hold-anchor E2E PASS
Agent-held Place / Release E2E PASS
Release trajectory blocker ownership PASS
Dynamic settle + support post-condition PASS
Settle timeout / place-unverified PASS
Physics ray ownership excludeIds PASS
Structured embodied partial-failure / History semantics PASS
Nemotron live approachAndPlace probe PASS
Muse live approachAndPlace probe PASS
Carried-object locomotion clearance PASS
Direct Physics carry shape-cast / held-target PASS
Held-object TileCache ownership transition PASS
Nemotron live approachAndPickup probe PASS
Muse live approachAndPickup probe PASS
Articulation action-sweep pose guard PASS
Arrival-pose action-sweep recheck PASS
Prismatic / revolute current-coordinate sweep PASS
Physical-only blocker locomotion E2E PASS
Kinematic CharacterController capsule/wall/yaw PASS
Long mutation ownership/history lock PASS
OpenAI-compatible local Agent adapter tests PASS
Provider-neutral tool-call history PASS
Nemotron live ToolCallingAgent→navigateTo probe PASS
Nemotron live approachAndInteract interaction probe PASS
Muse live approachAndInteract interaction probe PASS
Counterfactual restore recovery PASS
Live verification metadata sync PASS
World-pack dynamic import chunks PASS
Environment identity restore guard PASS
Chromium Pages screenshot smoke PASS
Python service tests PASS
真实 cabinet Compiler→Runtime Motion Sweep open→close E2E PASS
真实 JSON enrich / multipart per-Part CoACD E2E PASS
Planning-limit unresolved task preservation / trace PASS
Compact Task Observation relevance / entity-index PASS
Real Rapier STALL compact recovery context PASS
Implicit / explicit articulated Part identity normalization PASS
Bounded read-only recovery observation PASS
Recovery-observation-limit pre-execution stop PASS
Collider-level Object / Environment provenance PASS
Rapier active articulation contact provenance PASS
STALL current-contact failure attribution PASS
Compact blocker-candidate evidence PASS
Nemotron strict contact-attribution probe PASS
Muse strict contact-attribution probe PASS
Verified Dynamic blocker pickup recovery E2E PASS
Environment blocker recovery-ineligible E2E PASS
Recovery current-contact stale revalidation PASS
Recovery Policy / carry capability / pickup-plan preflight PASS
Auxiliary recovery unresolved-ledger isolation PASS
Duplicate auxiliary recovery evidence-epoch gate PASS
Original post-condition retry verification PASS
Deterministic pickup-plan / waypoint-margin PASS
Nemotron verified recovery probe PASS
Muse verified recovery probe PASS
Multi-candidate Object / Environment identity PASS
Current-contact evidence aggregation PASS
Non-causal pickup-route ranking PASS
Stable ranking tie-break PASS
Articulated blocker typed-ineligible PASS
Nemotron multi-candidate recovery probe PASS
Muse multi-candidate recovery probe PASS
Recovery-held transient provenance lifecycle PASS
World-space Environment-supported cleanup planning PASS
Shared Place / Cleanup three-segment transfer PASS
Recovery cleanup Dynamic settle PASS
Recovery cleanup sweep/contact post-condition PASS
Settle target-removal lifecycle PASS
HANDS_FULL cleanup recommendation provenance guard PASS
Nemotron verified recovery-cleanup probe PASS
Muse verified recovery-cleanup probe PASS
Recovery cleanup proposal Policy denial PASS
Recovery-held provenance lifecycle PASS
Recovery cleanup release-endpoint occupancy PASS
Recovery cleanup action-sweep failure PASS
Shared Place / Cleanup settle owner PASS
Carry E2E deterministic NavMesh preparation PASS
Articulated blocker verified-state eligibility PASS
Articulated blocker pending / ambiguous rejection PASS
Articulated recovery proposal Policy denial PASS
Articulated recovery execution-time stale revalidation PASS
Articulated auxiliary duplicate-recovery gate PASS
Real two-cabinet Rapier/Recast articulated recovery E2E PASS
Action interaction arrival-correction fallback PASS
Nemotron verified articulated recovery probe PASS
Muse verified articulated recovery probe PASS
Multi-action articulated counterfactual AABB evidence PASS
Counterfactual insufficient-evidence refusal PASS
Counterfactual no-gain / true-tie refusal PASS
Counterfactual tie result without fake rank PASS
Execution-time COUNTERFACTUAL_SELECTION_CHANGED revalidation PASS
Real ajar=-0.8 two-cabinet counterfactual E2E PASS
Nemotron counterfactual articulated recovery probe PASS
Muse counterfactual articulated recovery probe PASS
Physics hypothetical collider pose query PASS
Rapier shape-pair counterfactual no-live-mutation PASS
Revolute non-zero childAnchor explicit refusal PASS
Physics-first articulated action ranking PASS
Physics-over-Three conflicting-evidence priority PASS
Physics current-baseline consistency guard PASS
Explicit three-aabb-fallback coverage PASS
Real ajar=-0.8 Rapier shape-pair Agent E2E PASS
Nemotron Physics-first counterfactual probe PASS
Muse Physics-first counterfactual probe PASS
1.26 articulated recovery live regression PASS
1.25 cleanup live regression PASS
Non-zero revolute childAnchor hypothetical-vs-real motor pose PASS
Adaptive counterfactual sample density PASS
Independent original/blocker adaptive sampling PASS
Fixed counterfactual sampling override PASS
Real prismatic blocker counterfactual + motor pose PASS
Post-recovery counterfactual calibration consistent PASS
Post-recovery counterfactual calibration contradicted PASS
Nemotron adaptive/calibration counterfactual probe PASS
Muse adaptive/calibration counterfactual probe PASS
Adaptive→dense counterfactual convergence PASS
Unstable convergence → Physics fallback PASS
Nested parent-moved child local-frame hypothetical-vs-motor PASS
Explicit parent-pose-at-query frame assumption PASS
Nemotron convergence strict probe PASS
Muse convergence strict probe PASS
Rapier third-object/environment world-query PASS
Introduced world-collision hard veto PASS
Unique articulated world preflight PASS
Multi-action world veto cannot be resurrected by fallback PASS
Execution-time third-object stale revalidation PASS
Real two-cabinet safe world-counterfactual E2E PASS
Nemotron world-counterfactual strict probe PASS
Muse world-counterfactual strict probe PASS
1.26 articulated live regression PASS
Chromium 1.31 production smoke PASS
WorldSpec deterministic normalization PASS
Raw EmbodiedGen → AssetLibrary → Manifest admission PASS
Unrecognized raw provider refusal PASS
Generated Manifest trust classification PASS
Compiler-rejected generated asset non-registration PASS
Mixed unresolved WorldSpec zero-spawn fail-closed PASS
Generated EmbodiedGen world provisional admission PASS
Agent pipeline-stage bypass prevention PASS
World ready/provisional/rejected Skill outcome PASS
Rejected generated world snapshot restore PASS
Low-level provisional/rejected spawn outcome guard PASS
Strong WorldSpec tool schema PASS
Deterministic missing-position auto layout PASS
Manifest root collider footprint coverage PASS
Rapier manifestPoseClear pre-spawn Environment query PASS
Curated Environment layout contract PASS
Articulated root-only layout provisional guard PASS
Runtime-derived NEAR collider spacing PASS
NEAR explicit-too-small refusal PASS
Pipeline NEAR no-distance application PASS
Nemotron generated-world semantic WorldSpec probe PASS
Muse generated-world semantic WorldSpec probe PASS
WorldSpec unknown-field deterministic rejection PASS
Bounded missing-asset retry classification PASS
Fixed two-attempt canonical pipeline budget PASS
Non-retriable layout/relation/validation guard PASS
Pre-repair validation-noise isolation PASS
Real AssetLibrary Generator retry E2E PASS
Exact WorldSpec duplicate Agent gate PASS
Revised WorldSpec retry clears prior world-build unresolved PASS
Nemotron bounded generated-world retry strict probe PASS
Muse bounded generated-world retry strict probe PASS
Nemotron generated-world reuse regression PASS
Runtime-derived NEAR distance retry probe PASS
World-ready redundant validation stop PASS
README structured project overview + links PASS
Table-supported Cup pickup E2E PASS
Support-aware pickup stance + hold-anchor clearance PASS
Supported pickup lift-horizontal-anchor transfer PASS
Verified drop dynamic-settle post-condition PASS
Drop release-only false-positive guard PASS
Human-first Agent task hierarchy PASS
Stable task busy/success/error status surface PASS
Developer tools collapsed from primary workflow PASS
Activity log bounded and secondary PASS
Responsive command footer / panel overflow contract PASS
World autosave Reset world recovery control PASS
Vite heavy-service watch exclusion PASS
1.26 unique-action articulated recovery regression PASS
```

这些数字不是架构目标，只是帮助读者知道文档描述的能力已经有怎样的验证覆盖。未来测试数量变化时，应以当前 CI 为准。
