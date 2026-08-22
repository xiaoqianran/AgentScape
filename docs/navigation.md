# Static Navigation Truth

AgentScape 1.9 引入基于 Recast/Detour 的静态导航真值。

目标不是“画一条路径”，而是补上这个长期语义缺口：

```text
findFreeSpace
    ≠
canReach
```

一个位置没有 AABB 碰撞，不代表 Agent 能从当前位置到达那里。

## 当前能力

Agent-facing Skill：

```text
canReach(start, end)
findPath(start, end)
getNavigationStatus()
```

底层唯一实现：

```text
SkillRegistry
    ↓
NavigationSystem
    ↓
Recast NavMesh
    ↓
Detour NavMeshQuery
```

`SpatialSystem` 继续负责 bounds / raycast / nearby / placement；它不承载 WASM/NavMesh 生命周期。

## 为什么选择 recast-navigation-js

当前使用：

```text
@recast-navigation/core       0.43.1
@recast-navigation/generators 0.43.1
```

原因：

- Recast 负责从几何构建 NavMesh。
- Detour 负责 path finding / spatial reasoning。
- Browser / Node 都可运行。
- NavMeshQuery 有明确 destroy 生命周期。
- 后续如果需要动态障碍，可以沿 TileCache 扩展，不需要替换算法。

没有使用 `three-pathfinding` 作为核心，因为它主要查询已有 NavMesh，不负责构建；它适合更轻的“离线已有 navmesh”场景，但当前 AgentScape 需要同一个导航边界同时拥有 build + query truth。

## 静态几何归属

1.9 的 NavMesh **只表示静态世界**。

输入：

```text
Environment floor
+
manifest.physics.body === "fixed" 的对象几何
-
executable Part 子树
-
dynamic / kinematic object
```

例如 cabinet：

```text
Cabinet (fixed Root)
├── Body          → static NavMesh input
└── doorHinge     → executable Part boundary
    └── Door      → excluded from static NavMesh
```

这样 Door 当前是打开还是关闭，都不会偷偷改变“静态”导航定义。

代价也必须明确：

> 关闭的动态门、移动箱子、行走 Agent 当前不会作为 Detour 动态障碍。

所以返回结果明确带：

```text
scope = "static"
```

`getNavigationStatus()` 也明确：

```json
{
  "capabilities": {
    "staticNavMesh": true,
    "dynamicObstacles": false,
    "tileCache": false
  }
}
```

这不是完整动态导航的伪装。

## 世界单位与 Recast voxel

AgentScape 对外使用世界单位：

```text
cellSize        = 0.15
cellHeight      = 0.1
agentRadius     = 0.3
agentHeight     = 1.7
maxClimb        = 0.3
maxSlope        = 45°
maxSnapDistance = 0.75
```

但 Recast 的：

```text
walkableHeight
walkableClimb
walkableRadius
```

是 voxel 单位。

因此转换发生在 `NavigationSystem` 内：

```text
walkableHeight = ceil(agentHeight / cellHeight)
walkableClimb  = floor(maxClimb / cellHeight)
walkableRadius = ceil(agentRadius / cellSize)
```

同时对浮点整数边界加入极小 epsilon，避免：

```text
0.3 / 0.1
≈ 2.999999999
→ floor = 2
```

让配置无意缩小一整个 voxel。

## Lazy build 与 dirty state

NavMesh 是派生状态，不进入 Scene JSON。

```text
World objects
   ↓
static geometry changed
   ↓
NavigationSystem.dirty = true
   ↓
下一次 canReach/findPath
   ↓
lazy rebuild
```

会使 static NavMesh dirty 的变化：

```text
fixed object spawn
fixed object remove
fixed object move/place
Editor 修改 fixed object transform
```

不会使它 dirty：

```text
dynamic physics 每帧移动
dynamic object move
articulated Part open/close
```

因为这些几何本来就不属于 1.9 static NavMesh。

并发 query 共用同一个 `buildPromise`，避免两个 Agent 查询同时重复构建 Recast。

## WASM 生命周期

Recast 只在第一次导航查询时动态加载：

```text
App startup
   ↓
不加载 Recast

第一次 navigation query
   ↓
dynamic import core + generators
   ↓
init WASM
   ↓
build
```

当前 production build 中 Recast WASM compatibility chunk 约 727 KB，并保持独立 lazy chunk；不会塞进 Three 主 chunk或首屏同步路径。

NavigationSystem teardown：

```text
NavMeshQuery.destroy()
NavMesh.destroy()
interaction unsubscribe
```

Runtime dispose 后再次 query 会返回：

```text
NAVIGATION_DISPOSED
```

而不会重新挂回异步 WASM 状态。

## 端点吸附

Detour 查询前先把 start/end 映射到最近 NavMesh point。

返回：

```json
{
  "start": {
    "input": [-4, 0, 0],
    "snapped": [-4, 0, 0],
    "snapDistance": 0
  }
}
```

如果与 NavMesh 距离超过 `maxSnapDistance`：

```text
START_OFF_NAVMESH
END_OFF_NAVMESH
```

不会把“点不在导航区域”误报成“世界不连通”。

## 路径结果

`findPath()` 返回：

```text
reachable
scope
reason
sameIsland
start/end snap info
path[]
cost
finalDistance
buildVersion
```

`cost` 当前是 Detour straight path 各段的世界空间长度总和。

`canReach()` 复用完全相同的 `findPath()`，只是移除完整 waypoint 数组并返回 `waypointCount`，避免 Agent 只想问可达性时浪费 context。

## 不可达原因

当前主要 reason：

```text
INVALID_INPUT
NAVMESH_EMPTY
NAVMESH_BUILD_FAILED
NAVIGATION_DISPOSED
START_OFF_NAVMESH
END_OFF_NAVMESH
PARTIAL_PATH
NO_PATH
```

其中：

```text
OFF_NAVMESH
```

代表端点问题；

```text
PARTIAL_PATH / NO_PATH
```

代表 Detour 连通性/查询结果问题。

因此 Agent 可以决定是：

```text
换一个目标点
```

还是：

```text
需要改变世界状态 / 开门 / 重新规划
```

## 当前明确不做

1.9 没有加入：

```text
TileCache
Crowd
动态 box/cylinder obstacle
off-mesh connection
导航 agent controller
自动沿路径移动对象
NavMesh 二进制持久化
```

原因不是 Recast 不支持，而是这些能力有不同状态所有权。

特别是动态障碍必须回答：

```text
哪个 Runtime object 是 obstacle？
Part open/close 何时更新 obstacle？
physics motion 与 tile cache 更新频率是什么？
导航查询发生在 motor 尚未 settle 时怎么办？
```

在这些语义没有定义清楚前，不把 TileCache 提前接进默认 Runtime。

## 验证基线

1.9 有真实 Recast/Detour 测试覆盖：

```text
固定墙迫使 Detour 绕行
完整静态隔断 → unreachable
dynamic wall 不进入静态 NavMesh
fixed transform → dirty
off-navmesh 与 disconnected 分开
并发 query 只 build 一次
真实 cabinet.glb：Body 纳入，Door Part 排除
Runtime dispose 释放 navigation resources
viewer 通过 SkillRegistry 查询 canReach/findPath
```

这保证 Navigation 是 Runtime truth，而不是 UI path helper。
