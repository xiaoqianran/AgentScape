# Action-aware Navigation

AgentScape 1.14 在已有 Current-world Navigation 上增加**只读的单动作反事实诊断**。

它解决的问题不是：

```text
“帮我自动执行整套任务规划。”
```

而是：

```text
当前 path 不可达
        ↓
是否有一个当前可交互 obstacle
很可能就是路径瓶颈？
```

## 成熟系统给出的边界

AI2-THOR 把 `OpenObject` 作为显式环境动作，并明确指出开门可能因为碰撞而失败；对象是否已经打开是动作后的世界状态，而不是调用动作时的假设。

Habitat/HomeRobot 一类 embodied system 也强调持续更新环境表示并重新规划，而不是只在任务开始时计算一次路径。

AgentScape 因此采用：

```text
diagnose
→ explicit interaction
→ current physics changes
→ replan
```

而不是：

```text
recommend open
→ assume door is already open
→ claim reachable
```

## 新 Skill

```text
suggestNavigationActions(start, end)
```

权限：

```text
spatial.read
```

它是只读 Skill，不执行 `open`，不修改 durable world state。

典型结果：

```json
{
  "status": "action-candidate",
  "current": {
    "reachable": false,
    "reason": "PARTIAL_PATH",
    "scope": "current"
  },
  "candidates": [
    {
      "objectId": "cabinet_01",
      "partName": "door",
      "action": "open",
      "eligibility": {
        "eligible": true,
        "status": "declared-executable"
      },
      "counterfactual": {
        "provisional": true,
        "assumption": "obstacle-suppressed",
        "reachable": true
      }
    }
  ],
  "recommendation": {
    "call": {
      "name": "open",
      "args": {
        "id": "cabinet_01",
        "partName": "door"
      }
    },
    "then": {
      "name": "findPath",
      "condition": "after-world-state-changes"
    },
    "provisional": true
  }
}
```

## 为什么叫反事实，而不是预测

当前第一版没有尝试预测 Door 的最终 open collider pose。

它问的是更保守的问题：

```text
如果这个 obstacle 不再阻断 NavMesh，
路径是否出现？
```

实现：

```text
current TileCache
      ↓
临时 remove candidate obstacle
      ↓
TileCache update until upToDate
      ↓
Detour query
      ↓
立即 restore obstacle
      ↓
TileCache update until upToDate
```

因此结果必须带：

```text
provisional = true
assumption = obstacle-suppressed
```

这不是“open 后一定可达”。

例如一扇门打开 90° 后仍可能占据路径；或者它打开时可能撞到别的物体。只有真实动作执行、Rapier collider 发生变化后，再调用 `findPath` 才是 current-world truth。

## 为什么直接使用 TileCache，而不是复制一个 Planner World

NavigationSystem 已经拥有：

```text
static Recast NavMesh
TileCache
current dynamic obstacle handles
Detour query
```

反事实 remove/query/restore 都是同步 WASM 操作；在一次 JS call stack 中不会被另一个 query 插入。

因此没有新增：

```text
PlanningWorld
NavigationSandbox
CounterfactualScene
```

第二份状态。

诊断过程结束后，真实 TileCache obstacle 必须恢复。

## Blocker provenance

动态 obstacle 早在 1.10 就使用稳定身份：

```text
<objectId>:<partName>:<colliderIndex>
```

例如：

```text
cabinet_01:door:0
```

所以 `suggestNavigationActions` 不需要从 Mesh 名称或视觉语义猜“这可能是一扇门”。它可以直接回到：

```text
TileCache obstacle
→ Rapier collider snapshot
→ ObjectStore record
→ manifest.parts[door]
→ actions / targets / verification
```

## 候选排序

当 current path 返回 partial path 时，候选按 obstacle 到：

```text
partial path endpoint
```

的 XZ 距离排序。

输出字段准确叫：

```text
distanceToPartialEndpoint
```

它不是“到整条 path 的距离”。

每次最多评估 6 个候选，Skill 参数允许 1–8。

这是为了避免一个有很多可交互物体的大场景进行无界 TileCache remove/rebuild 实验。

## Articulation eligibility

### 手工 / builtin executable asset

当前内置 cabinet 等手工资产可以使用其 Manifest executable contract：

```text
part.actions contains open
part.targets.open finite
part.physics exists
part.joint exists
```

返回：

```text
status = declared-executable
```

它没有被错误称为 runtime-verified。

### Compiled asset

自动编译资产更严格。

必须已有持久化：

```text
manifest.verification.articulation
```

并且对应 Part/action 的 verifier 报告通过，才允许成为 recommendation：

```text
status = runtime-verified
```

否则：

```text
eligible = false
status = unverified
reason = ARTICULATION_UNVERIFIED
```

它仍然可以作为“疑似 blocker”显示，因为 counterfactual geometry 可能证明移除它会出现路径；但 Planner 不会推荐执行未验证动作。

## Live instance verification metadata

1.14 审计发现一个重要边界：

```text
spawn compiled asset
      ↓
live ObjectStore record 拿到当时 manifest
      ↓
之后 verifyAssetArticulation
      ↓
AssetManager manifest 更新
```

如果 live record 不更新，Navigation 仍会看到旧的 `unverified` 状态。

现在 verifier 写回后只同步：

```text
verification
compiler.quality
```

到已存在实例。

不会热替换：

```text
physics
parts
joint
colliders
actions
```

因为这些结构已经被 Rapier attach；如果结构本身变化，应重新实例化资产，而不是偷偷改变 live manifest。

## `waiting-for-world-update`

InteractionSystem 的：

```text
open
```

只是设置 motor target。

如果：

```text
record.state.parts.door = open
```

但 Rapier collider 当前仍然挡住路径，并且 counterfactual 证明它是 blocker，则：

```text
suggestNavigationActions.status
= waiting-for-world-update
```

不会再次建议 `open`。

这表达：

```text
open 已经请求
但 current-world physics 还没产生足够变化
```

Agent 应稍后重新 `findPath`，而不是重复发动作。

## Counterfactual failure recovery

诊断必须保证自身不改变世界。

如果 obstacle restore 暂时失败：

```text
counterfactual restore failed
        ↓
PhysicsSystem.navigationObstacles()
        ↓
从当前 Rapier truth 立即 reconcile
        ↓
恢复 TileCache current-world obstacle
```

专项测试会人为让第一次 restore 失败，并要求：

```text
NavigationSystem.status().dynamicObstacles.tracked == 1
```

且下一次 `findPath` 仍然不可达。

## 真实纵向 E2E

1.14 使用真实 Rapier revolute Door：

```text
closed Door
    ↓
TileCache blocks corridor
    ↓
suggestNavigationActions
    ↓
recommend open (provisional)
    ↓
InteractionSystem.open
    ↓
Rapier motor moves Door
    ↓
PhysicsSystem.navigationObstacles()
    ↓
TileCache reconcile current pose
    ↓
findPath
    ↓
reachable = true
```

整个过程中：

```text
static NavMesh buildVersion = 1
```

说明改变的是 current dynamic obstacle，而不是重建静态世界。

## 当前明确不做

1.14 不做：

```text
自动执行 recommendation
多动作搜索
两扇门组合 counterfactual
预测 articulated final collider pose
RRT / TAMP motion planning
自动等待 motor settle
真正 locomotion controller
```

第一版只回答：

> “有没有一个**单个、可验证的可交互 obstacle**，移除其阻挡后路径就会出现？”

这是可解释、可测试、不会虚构世界状态的最小闭环。

## 与 1.16 Embodied Interaction 的关系

1.14 的 `suggestNavigationActions` 回答“哪个可交互 obstacle 可能让路径重新出现”；1.16 的 `approachAndInteract` 回答“Agent 应站在哪里才能安全请求这个 articulation action”。前者是 navigation blocker counterfactual，后者是 interaction precondition，不应合成一个 Planner。详见 [`interaction-range.md`](./interaction-range.md)。
