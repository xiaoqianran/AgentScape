# Interaction

Interaction 负责**交互编排与结果验证**，不拥有空间、路径、移动或物理真值。

```text
Interaction
├─ Spatial      // 空间语义
├─ Navigation   // 可达性 / route cost
├─ Locomotion   // 移动执行
└─ Physics      // 物理事实 / interaction execution
```

## 结构

外部只依赖 `InteractionSystem`。内部实现集中在 `runtime/interaction/`：

```text
systems/
└─ InteractionSystem.js       // public facade + workflow orchestration

interaction/
├─ InteractionContract.js     // executable interaction contract
├─ InteractionApproach.js     // reach / interaction pose / approach
├─ CarryRuntime.js            // held ownership index / anchor / transfer
├─ ArticulationRuntime.js     // joint action / sweep / completion
├─ SettleRuntime.js           // place / drop / cleanup post-condition
└─ RecoveryRuntime.js         // recovery provenance / cleanup planning

affordance/
└─ WorldAffordances.js        // environment affordances; separate boundary
```

内部模块使用显式、窄依赖，不接收 `owner=this`，也不成为新的 World System。

`InteractionSystem` 保留既有 public API，并负责跨模块 workflow，例如：

```text
approachAndInteract
approachAndPickup
approachAndPlace
cleanupRecoveryBlocker
```

其中 embodied approach 统一经过：

```text
InteractionApproach
        ↓
findInteractionPose
        ↓
navigateToPose / correctToPose
        ↓
LocomotionSystem.navigate
        ↓
Physics actual pose
```

## 对接 API

主要 Runtime 接口：

```js
interactionStatus(actorId, targetId, options)
approachAndInteract(actorId, targetId, action, options)
approachAndPickup(actorId, targetId, options)
approachAndPlace(actorId, targetId, options)
dropHeld(actorId, options)
carryStatus(actorId)
cleanupRecoveryBlocker(actorId, targetId, options)
setArticulationAction(id, action, options)
articulationStatus(id, partName?)
update(dt)
cancelPending(reason?)
debugSnapshot(options?)
```

Human / Editor compatibility：

```js
pickup(id)
drop(id?)
place(id, targetId, options)
placeInside(id, targetId, options)
move(id, position, options)
setHumanViewPose(viewPose)
```

依赖方向固定为：

```text
InteractionSystem
      ↓
InteractionApproach / CarryRuntime / ArticulationRuntime / SettleRuntime / RecoveryRuntime
      ↓
Spatial / Navigation / Locomotion / Physics
```

外部模块不要直接依赖 `interaction/*Runtime`。

## Truth 与验证

持有关系的 durable truth：

```js
record.state.heldBy
```

`humanHeldId / agentHeld` 是运行时索引，`recoveryHeld` 是 transient recovery provenance。

Interaction 不把“动作已请求”当作“动作成功”：

```text
open / close -> joint completion verified
place        -> settle + support verified
drop         -> release + settle observed
recovery     -> release + action sweep/contact clear
```

## Freeze rule

保持当前边界：

```text
一个 InteractionSystem public facade
+ 少量明确职责的 interaction 内部模块
+ 不新增 ApproachSystem / CarrySystem / Manager facade
+ 不复制 Navigation / Locomotion / Physics truth
+ 不让外部直接依赖内部 Runtime
+ 不反向让下层系统依赖 Interaction
```

只有现有 contract 无法表达真实需求时才扩展接口。
