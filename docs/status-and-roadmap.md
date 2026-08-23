# 当前完成度与路线图

本文描述 **1.25.0** 当前状态。

总体完成度只能作为粗略参考。按“从普通 GLB 到可信 Agent World”的完整目标估计，目前约：

```text
0%        20%       40%       60%       80%      100%
│----------│----------│----------│----------│----------│
██████████████████████████████░░░░░░░░░░░░░░░░░░░░
                              ▲
                           当前 ≈ 98%
```

98% 不是“代码写完 98%”，而是：基础 Runtime 和 Asset→Executable 纵向链已经成熟，剩余主要是更困难的验证、导航、自动语义与世界级能力。

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
| Runtime Verification | 99% | 单步、多步、STALL attribution、verified recovery 与 1.24 multi-candidate ranking 已闭环；剩余是 cleanup / articulated recovery 与更强 causal evidence |
| 自动 Part Segmentation 接入 | 50% | 协议/物化已通，默认模型未绑定 |
| 自动 Semantics | 35% | 仍以 evidence/provider 为主 |
| 自动 Joint / Target 推断 | 30% | 保守，不愿用猜测换 coverage |
| Grasp / Manipulation Geometry | 52% | hold/pickup/carry/place + deterministic pickup + 1.25 world-space recovery cleanup 已通；仍无 IK / grasp force / payload limit |
| Navigation / Reachability | 90% | 1.15 已有 Detour path + Rapier physical locomotion；自动动态 replan / off-mesh / multi-agent avoidance 仍缺 |
| 大型 World Runtime | 58% | 1.13 已有 96×72m 城市基线；19 Recast meshes / 38 renderables / 330–489ms build，当前暂无 streaming 证据 |
| Multi-Agent | 10% | 不是当前优先级 |
| 完整生成式 World Pipeline | 30% | provider 边界在，task-driven generation 仍需发展 |
| Pages / Art Direction | 78% | Monument Hall + Ruined Courtyard + Grand Urban Block；world pack JS 已按当前选择 lazy load |

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

## 18. 当前 P0：Articulated Blocker Recovery

当前 recovery 已经覆盖：

```text
Dynamic root Object blocker
→ pickup recovery
→ verified cleanup
```

下一类真正不同的 blocker 是：

```text
kind = object
partName != $root
```

它不能被整体 pickup。下一阶段应建立 typed articulated recovery：

```text
blocking Part
→ open/close capability + Policy
→ action-aware sweep / current joint truth
→ provisional articulated recovery
→ explicit approachAndInteract on blocker Part
→ fresh original retry
```

仍然禁止把 blocker action 成功当成 original task success。

---

## 19. 1.11–1.12 已完成：Curated Multi-World Layer

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

## 20. P1：完整 Joint Frame

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

## 21. P2：Compact Agent Observation

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

## 22. 自动语义：宁可慢一点，也不虚构能力

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

## 23. 目前不应该成为优先级的方向

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

## 24. 产品差异化应该是什么

不应该是：

```text
AI + Three.js Editor
```

因为 Feather、Aedifex、Trigen、Gizmo 等已经覆盖很多。

更值得守的是：

```text
Unknown GLB
   ↓
Evidence
   ↓
Executable Asset
   ↓
Physical Runtime
   ↓
Verification
   ↓
Machine-readable failure
   ↓
Spatial / Navigation Truth
   ↓
Agent World
```

---

## 25. 未来完成态

可以把 100% 理解为：

```text
Generator-neutral assets/worlds
          │
          ▼
Agent-Ready Compiler
          │
          ▼
Verified executable objects
          │
          ▼
Navigation / reachability
          │
          ▼
Manipulation / grasp
          │
          ▼
Task planning
          │
          ▼
Persistent large worlds
          │
          ▼
Multi-agent / long-running world state
```

AgentScape 当前已经站在：

```text
Verified executable objects
```

之前的最后一段和之后的第一段之间。

所以接下来最重要的不是“再多一个 feature”，而是把：

```text
可动
```

升级成：

```text
可信可执行
```

再把：

```text
有空位
```

升级成：

```text
真的可到达
```

---

## 当前验证基线

1.25.0 文档快照对应的仓库验证基线：

```text
103 Test Files PASS
320 Tests PASS
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
```

这些数字不是架构目标，只是帮助读者知道文档描述的能力已经有怎样的验证覆盖。未来测试数量变化时，应以当前 CI 为准。
