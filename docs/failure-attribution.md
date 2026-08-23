# Failure Attribution / Contact Provenance

AgentScape 1.22 把 live articulation failure 从：

```text
Door open
→ STALL
```

推进到：

```text
Door open
→ STALL
→ current Rapier contact evidence
→ collider owner provenance
→ blocker candidates
```

但它仍然严格区分：

```text
current contact evidence
!=
uniquely proven root cause
```

---

## 1. 为什么 STALL 本身不够

1.19 已经能确定：

```text
target not reached
+
joint coordinate stopped changing
→ STALL
```

1.21 又把 live coordinate/error/verified state 压进 compact task observation。

但模型仍然只知道：

> “门卡住了。”

它不知道当前世界里：

```text
谁正在碰 Door？
是另一个 Object？
是 Environment？
是自身别的 Part？
```

这使 recovery planner 只能继续盲查。

---

## 2. 1.22 的目标不是自动修复

本阶段只回答：

```text
失败时当前有哪些 active physical contacts？
这些 collider 属于谁？
```

不会自动：

```text
move blocker
remove blocker
retry open
change scene
```

任何 recovery mutation 后仍必须重新运行真实 action / path verification。

---

## 3. Collider Provenance 的 owner 在 PhysicsSystem

碰撞 owner 不能由 InteractionSystem 根据 Three hierarchy 临时猜。

所以创建 Rapier Collider 时，PhysicsSystem 同时登记：

```text
collider.handle
→ provenance
```

Object collider：

```json
{
  "kind": "object",
  "objectId": "cabinet_01",
  "partName": "door",
  "colliderIndex": 0
}
```

Environment collider：

```json
{
  "kind": "environment",
  "environmentId": "monument-hall",
  "colliderIndex": 12
}
```

---

## 4. 为什么是 Collider-level，不只是 Body-level

同一个 RigidBody 可以拥有多个 colliders。

只记录：

```text
body → cabinet_01
```

无法回答：

```text
Door 的哪一个 collider？
Environment 的哪一块 wall/plinth？
```

所以 provenance key 是 Rapier collider handle，值里保留原 Manifest/environment collider index。

Handle 本身绝不暴露给 Agent。

---

## 5. `ownerOfBodyHandle()` 保持旧语义

现有 carry/raycast/character-controller 使用：

```text
ownerOfBodyHandle()
```

它继续只回答 Object body ownership。

Environment 在这些旧 API 中仍按：

```text
$environment
```

处理。

1.22 没有为了 provenance 改坏已有 blockedBy / raycast compatibility。

---

## 6. 新增 `provenanceOfCollider()`

只读：

```text
PhysicsSystem.provenanceOfCollider(collider)
```

返回 plain cloned data。

不会返回：

```text
Rapier Collider object
internal handle
WASM pointer
```

因此报告可安全进入 Trace / Tool result / compact observation。

---

## 7. Environment 也必须有稳定身份

1.11+ Environment Pack 已经有：

```text
monument-hall
ruined-courtyard
grand-urban-block
```

1.22 `WorldRuntime.addEnvironment()` 会把当前 pack id 一起传给 Physics：

```text
physics.addEnvironment(
  colliders,
  { id: environment.id }
)
```

所以环境 contact 不再只能写：

```text
$environment
```

而能提供当前 world pack provenance。

测试 fixture 也可以使用：

```text
door-stall-blocker
sequence-stall-environment
```

这样的 deterministic id。

---

## 8. Collider provenance 生命周期

创建：

```text
addColliders
→ createCollider
→ colliderProvenance.set(handle,...)
```

Object remove：

```text
unregisterBodyColliders
→ removeRigidBody
```

Attach rollback：

```text
unregister temporary collider provenance
→ remove temporary bodies
```

Runtime dispose：

```text
colliderProvenance.clear()
→ world.free()
```

不会留下已销毁 body/collider 的 stale owner。

---

## 9. 为什么 Environment 当前不需要独立 remove API

当前一个 WorldRuntime 生命周期只拥有一个 Environment Pack。

Environment collider 与 Physics World 同寿命。

所以 1.22 没有为了 provenance 提前新增：

```text
EnvironmentManager
removeEnvironment
ColliderRegistry service
```

以后真实 hot world switching 若需要单独销毁 environment body，再让实际需求推动该生命周期 API。

---

## 10. `articulationContacts()` 使用 Rapier Narrow Phase

新增：

```text
PhysicsSystem.articulationContacts(id, partName)
```

对该 Part 每个 collider 调用：

```text
world.contactPairsWith(sourceCollider)
```

再用：

```text
world.contactPair(source, target, manifoldCallback)
```

读取当前 contact manifold。

不是：

```text
Three AABB overlap
visual bounds
ray guess
```

---

## 11. Contact Evidence 读取哪些字段

当前报告：

```text
source provenance
target provenance
external
manifoldCount
contactCount
activeContactCount
minDistance
totalImpulse
normal
```

不输出 solver/WASM 内部对象。

---

## 12. 为什么需要 `activeContactCount`

Rapier narrow phase 可能维护 prediction-distance 内的 contact candidate。

如果只看到：

```text
contact pair exists
```

就声称“正在接触”，可能过度解释。

1.22 只把 contact point 满足以下至少一项视为 active：

```text
contactDist <= 1e-6
OR
contactImpulse > 1e-8
```

只有：

```text
activeContactCount > 0
```

该 pair 才进入 `articulationContacts()` 结果。

---

## 13. `minDistance`

Rapier contact distance：

```text
< 0  penetration
≈ 0  touching
> 0  separation / prediction range
```

因此 negative `minDistance` 是直接的 geometric contact evidence。

它不是“碰撞严重程度评分”。

---

## 14. `totalImpulse`

把当前 manifold contact impulses 的绝对值累加。

用途是说明：

```text
该 contact 不只是几何 candidate，solver 也可能正在施加 impulse
```

但 1.22 不基于 impulse 做 root-cause ranking。

---

## 15. Contact normal

报告 source-oriented world normal。

如果 Rapier manifold callback 标记 flipped：

```text
normal *= -1
```

保持报告方向相对于 source Part 一致。

---

## 16. Source collider index 也来自 provenance

不能简单写：

```text
body.collider(i) 的 i
```

因为 Manifest 未来可能包含被跳过的 unsupported spec。

所以 source index 同样优先使用创建时 collider provenance，保持对原始 spec 的稳定引用。

---

## 17. Object blocker evidence

真实 Physics test：

```text
cabinet door
↔ blocker_01 fixed object
```

要求结果包含：

```json
{
  "target": {
    "kind": "object",
    "objectId": "blocker_01",
    "partName": "$root",
    "colliderIndex": 0
  },
  "external": true
}
```

---

## 18. Environment blocker evidence

真实 Physics test：

```text
cabinet door
↔ named environment blocker
```

要求：

```json
{
  "target": {
    "kind": "environment",
    "environmentId": "stall-fixture",
    "colliderIndex": 0
  }
}
```

---

## 19. Internal vs external

`articulationContacts()` 本身标记：

```text
external = true | false
```

同 object 内部 Part contact 可以被观察，但 blocker attribution 默认只消费 external contact。

原因是 1.22 当前目标是 live world obstacle provenance，而不是重新实现离线 self-collision verifier。

---

## 20. Asset Motion Sweep 仍负责结构级 self-collision

1.8 `ArticulationVerifier` 已经有：

```text
baseline penetration
collision regression
```

它继续回答：

> “这个资产自己的 articulation geometry 是否可信？”

1.22 live contact attribution 回答：

> “这一次当前世界中的失败 Part 正在和谁接触？”

两个职责不合并。

---

## 21. `articulationFailureAttribution()`

InteractionSystem 在 STALL 终态调用一次：

```text
physics.articulationContacts(id, partName)
→ filter external
→ attribution report
```

不会每帧对每个 moving joint 做 contact aggregation。

---

## 22. 为什么只在 STALL 时采样

普通 moving/opening：

```text
不需要 failure attribution
```

Action completed：

```text
没有 failure
```

只有 observer 已经确定：

```text
reason = STALL
```

才采样 failure-time contact。

避免把 provenance 查询放到 hot path。

---

## 23. Attribution status

有 external active contact：

```text
status = contact-evidence
```

没有：

```text
status = unattributed
```

`unattributed` 不是“没有 blocker”。

它只表示：

> 当前 STALL snapshot 没有得到可归属的 external active contact evidence。

---

## 24. `evidence = current-contact-at-failure`

这个字符串很重要。

它明确 evidence 的时间与语义：

```text
current
contact
at failure
```

不是：

```text
historical contact
predicted contact
unique cause
```

---

## 25. `blockerCandidates`

从 external active contacts 的 target provenance 去重得到。

Object candidate：

```text
kind
objectId
partName
colliderIndex
```

Environment candidate：

```text
kind
environmentId
colliderIndex
```

---

## 26. 为什么叫 Candidate

即使 Door STALL 时正碰 `obstacle_03`：

```text
contact(Door, obstacle_03) = true
```

仍然可能同时存在：

```text
motor limit problem
另一个 contact
joint frame defect
friction/solver condition
```

所以：

```text
blocker candidate
```

比：

```text
rootCause
```

更准确。

---

## 27. STALL result 现在包含 attribution

例如：

```json
{
  "status": "action-failed",
  "reason": "STALL",
  "targetReached": false,
  "settled": false,
  "attribution": {
    "status": "contact-evidence",
    "evidence": "current-contact-at-failure",
    "blockerCandidates": [
      {
        "kind": "object",
        "objectId": "obstacle_03",
        "partName": "$root",
        "colliderIndex": 0
      }
    ]
  }
}
```

---

## 28. `getArticulationStatus` 自然保留 evidence

1.19 已经把最近 completion/failure report 保存在：

```text
InteractionSystem.articulationResults
```

1.22 不新增 FailureStore。

`articulationStatus().last` 直接携带 attribution。

---

## 29. Compact Task Observation

1.21 `buildTaskObservation()` 会压缩 attribution：

```text
status
evidence
blockerCandidates
最多 4 条 contactEvidence
```

每条只保留：

```text
source
target
contactCount
activeContactCount
minDistance
totalImpulse
normal
```

---

## 30. 为什么最多 4 条

完整 Physics report 可以有多个 collider pair。

Agent planning context 不需要无限扩张。

所以 compact observation：

```text
slice(0,4)
```

原始 Runtime result / `getArticulationStatus` 仍保留全部当前 evidence。

---

## 31. Tool prompt 明确证据边界

Agent-facing Prompt：

```text
current-contact-at-failure
= colliders physically touching failed Part at observed failure
```

并明确：

```text
not proof of the unique root cause
```

这不是免责声明，而是 Runtime contract 的一部分。

---

## 32. Skill 描述也保持同一语义

`getArticulationStatus` 描述明确：

```text
STALL may include contact-evidence blockerCandidates
```

同时明确：

```text
contact evidence != unique causality
```

Tool schema 与 system prompt 不冲突。

---

## 33. Real high-level STALL

`approachAndInteract` 的真实 E2E：

```text
Agent real locomotion
→ legal interaction pose
→ Door motor
→ external Rapier blocker
→ joint stalls
→ action-failed / STALL
→ attribution.contact-evidence
```

不是直接调用一个 mock observer。

---

## 34. Real compact failure context

Multi-step E2E 中环境 blocker id：

```text
sequence-stall-environment
```

第二 planning round 的 compact task observation 必须含：

```text
Door last.reason = STALL
attribution.status = contact-evidence
blockerCandidates[0].environmentId
= sequence-stall-environment
```

---

## 35. Environment collider index 也可追踪

同一个 Environment Pack 通常包含：

```text
floor
walls
columns
plinths
...
```

所以 `environmentId` 不够。

`colliderIndex` 可以回到该 pack 的 collider list，进一步映射具体几何来源。

1.22 暂不新增 human-readable collider labels；需要真实需求再扩 Manifest/environment metadata。

---

## 36. 不暴露 Rapier Handle

Test 明确要求 serialized evidence 不包含：

```text
handle
```

原因：

- handle 是 runtime-internal。
- remove/recreate 后不稳定。
- 对 Agent 没有业务含义。

稳定引用是：

```text
object/environment identity + part + colliderIndex
```

---

## 37. Remove cleanup test

Object blocker remove 前：

```text
colliderProvenance.has(handle) = true
```

执行：

```text
physics.remove(blocker_01)
```

后：

```text
false
```

不会 stale-attribution 到已经不存在的 object。

---

## 38. Direct unregister test

`unregisterBodyColliders(body)` 还有直接测试：

```text
provenance removed
body collider still exists
```

证明 helper 只负责 provenance lifecycle，不偷偷修改 Physics body。

---

## 39. Dispose cleanup

Physics dispose：

```text
entries.clear()
colliderProvenance.clear()
world.free()
```

专项 test 要求 provenance size 为 0。

---

## 40. Attach rollback

如果多 Part attach 中途失败：

```text
created rigid bodies
+
created collider provenance
```

都在 rollback 中清理。

不允许“body 回滚了但 provenance index 残留”。

---

## 41. Real model attribution probe

新增：

```bash
npm run agent:probe -- attribution
```

Probe world：

```text
agent_01
cabinet_01
obstacle_03
```

`approachAndInteract` 返回：

```text
STALL
+
current-contact-at-failure
+
blockerCandidates = obstacle_03
```

---

## 42. Probe 禁止手工分解

Attribution probe 明确禁止：

```text
navigateTo
findInteractionPose first
low-level open
moveObject blocker
pickup/place
```

要求直接：

```text
approachAndInteract
```

这样 smoke 仍验证高层具身 contract。

---

## 43. Nemotron attribution smoke

严格版当前样本：

```text
first mutation = approachAndInteract
→ STALL
→ obstacle_03 contact evidence
→ stop
```

最终明确说：

```text
not uniquely proven root cause
```

---

## 44. Muse attribution smoke

Muse 当前样本同样：

```text
approachAndInteract
→ STALL
→ obstacle_03
```

并主动列出：

```text
contactCount
activeContactCount
minDistance
totalImpulse
normal
```

随后停止，没有移动 blocker。

---

## 45. Planning steps 仍不是稳定能力指标

真实模型 sampling 会变化。

所以能力标准不是：

```text
必须 2 steps
```

而是：

```text
使用正确高层 mutation
尊重 failure outcome
正确理解 evidence boundary
不执行禁止 recovery
```

---

## 46. 为什么不自动推荐 `moveObject(obstacle_03)`

Object 是 blocker candidate，不代表：

- 允许 Agent 移动它。
- 它可搬动。
- 移走不会造成新碰撞。
- 它是任务中唯一应该改变的对象。

Policy/permissions 也可能禁止。

所以 1.22 只给 evidence。

---

## 47. Environment blocker 更不能自动移动

如果 candidate：

```text
kind = environment
```

它可能是：

```text
wall
column
floor
fixed architectural element
```

自动 move 完全错误。

Agent 应该考虑：

```text
换任务策略
报告 blocked
寻找其它可交互 Part/route
```

而不是编辑环境。

---

## 48. Contact evidence 与 Action-aware Navigation 的区别

1.14 `suggestNavigationActions`：

```text
counterfactual single-action diagnosis
```

是 provisional inference。

1.22 contact provenance：

```text
current Rapier contact at failure
```

是直接物理 observation。

两者不能混称 verified blocker cause。

---

## 49. Contact evidence 与 SceneGraph 的区别

SceneGraph：

```text
ON / SUPPORTS / NEAR / INSIDE
```

由 Spatial 几何关系派生。

Contact provenance：

```text
Rapier narrow-phase current contact
```

来自 Physics。

没有把 CONTACT edge 持久化进 SceneGraph，避免两个更新频率/语义层混在一起。

---

## 50. 为什么没有新增 CONTACT relation

Contact 是高频、瞬态、solver-level evidence。

SceneGraph 是较低频的 semantic spatial graph。

将每帧 contact 写成 SceneGraph edge 会：

- 放大重建开销。
- 产生大量瞬态关系。
- 模糊 Physics vs semantics owner。

1.22 因此只在 failure observation 中按需采样。

---

## 51. 当前 claim

AgentScape 现在可以说：

> 当 live articulated action 因 STALL 失败时，Runtime 可以采样失败瞬间该 Part 的 active Rapier contacts，并把接触 collider 还原成稳定的 Object/Part/Environment provenance，作为 blocker candidates 提供给 Agent。

不能说：

> Runtime 已经证明这些 candidates 是 STALL 的唯一因果根源。

---

## 52. 当前不做

1.22 没有：

```text
causal graph
force/torque root-cause solver
contact history buffer
impulse ranking policy
blocker automatic removal
multi-contact counterfactual simulation
automatic recovery executor
```

---

## 53. 下一阶段：Verified Recovery Action

现在已有：

```text
STALL
→ current contact blocker candidate
```

下一阶段真正值得做的是：

```text
candidate
→ policy / capability check
→ legal recovery proposal
→ explicit recovery mutation
→ fresh world re-observation
→ retry original action
→ require verified completion
```

重点仍然是：

```text
recovery proposal != success
```

只有 recovery 后原始任务真正重新验证成功，才能解除 unresolved failure。

---

## 54. 1.23：Blocker Candidate 开始进入受约束 Recovery

1.23 没有把 `blockerCandidates` 自动映射成 `moveObject`。`suggestRecoveryActions` 会先重新验证 current contact，再通过同一 Skill Policy、已有 carry capability 与 `findPickupPlan` 几何 preflight 决定是否存在 provisional pickup-blocker recovery。Failure-time contact 若已经 stale，proposal 会直接拒绝；Environment 永远 ineligible。Recovery 后仍必须重新验证原始 articulation post-condition。详见 [`verified-recovery.md`](./verified-recovery.md)。
