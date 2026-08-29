# World Viability Gate

`npm run world:viability` 是 AgentScape 的产品级世界可用性门禁。它不是单元测试集合，而是把当前 Runtime 能力串成一条可重复执行的 embodied benchmark。

## Gate 覆盖

```text
Grand Urban Block
  → Recast city-scale navigation

Ruined Courtyard
  → Rapier character controller
  → elevated traversal

Monument Hall
  → canonical WorldIR
  → INSIDE receptacle placement
  → real cabinet.glb shell + articulated door
  → Agent navigation
  → OPEN
  → PICKUP from cabinet interior
  → long-distance CARRY
  → PLACE on table.top
  → dynamic settle
  → ON support verification
  → World Acceptance
  → transactional history
  → deliberate world drift
  → acceptance replay detects drift
  → scene serialize/restore
  → Physics World rebuild
  → persistent-state revalidation
```

## 当前判定

当前离线 deterministic Gate 返回：

```text
status  = passed
verdict = runtime-world-usable
```

它证明 Runtime World 已经可以执行真实 embodied task，而不仅是渲染或 mock interaction。

需要区分两个层级：

```text
Runtime execution verdict     runtime-world-usable
Canonical world admission     provisional
```

当前 flagship world admission 仍会报告 `ASSET_PROVISIONAL / LAYOUT_PROVISIONAL`。这意味着“世界能真实运行并通过任务验收”已经成立，但部分 Asset/Layout evidence 还没有达到 `ready` 级别，不能把两个结论混写。

## Canonical INSIDE

`INSIDE` 现在是 WorldIR / WorldSpec 的正式 placement predicate：

```json
{
  "subject": "cup_01",
  "predicate": "INSIDE",
  "object": "cabinet_01",
  "receptacleId": "interior"
}
```

Container Asset 通过 Manifest 声明可执行 receptacle：

```json
{
  "receptacles": [
    {
      "id": "interior",
      "localPosition": [0, 0.975, -0.01],
      "size": [1.4, 1.65, 0.46]
    }
  ]
}
```

Runtime 不伪造 SceneGraph edge。World Pipeline 必须先找到真实可放置空间、通过 Physics pose preflight、移动对象，再由 Spatial/SceneGraph 从实际几何重新验证 `INSIDE / CONTAINS`。

## Cabinet physics

内置 cabinet 不再使用覆盖整个柜体的实心 Root box collider，而使用 shell colliders + articulated Door。这样内部 receptacle 可以真实容纳动态物体，同时柜壁/柜门仍保留 Physics collision。

Validator 对 `INSIDE` 也不是简单忽略 AABB overlap：如果 Physics preflight 证明 contained object 实际穿入 container collider，仍然产生 `P_OVERLAP` hard finding。

## Carry / Place 修正

本 Gate 同时固定了两个复杂场景语义：

- Agent 与当前 held object 的预期重叠不再被 `WorldValidator` 当成普通穿模；其他 overlap 不豁免。
- PLACE 的 LOS 以真实 release point 为目标。射线安全到达 release point 且没有被其它 collider 截断时可以通过，不再要求必须命中 support collider 本体；墙体/障碍命中仍然阻断。

## Restore physics transaction

完整 Scene restore 不再在同一个 Rapier World 中逐个删除并原地重建 articulated bodies。`PhysicsSystem.resetWorld()` 会建立新的 Physics World 与 CharacterController，重新挂 Environment，再恢复对象。

这避免旧 joint/collider/query 生命周期污染恢复后的世界，也使 restore 成为明确的 physics transaction boundary。

## 在线能力边界

本 Gate 是离线 deterministic。它当前不证明：

- live `modal-provider` 2D/3D generation；
- live external LLM/VLM planning。

这两条应由有对应 credential / Provider runtime 的 live probe 单独证明，不能用离线 Gate 冒充在线证据。
