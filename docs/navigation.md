# Current-world Navigation Truth

AgentScape 1.9 引入基于 Recast/Detour 的静态导航真值；1.10 在同一个 NavigationSystem 中加入 TileCache + Rapier dynamic obstacle overlay，使查询反映当前物理世界。

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
- 1.10 已沿 TileCache 扩展动态障碍，无需替换 Recast/Detour 算法。

没有使用 `three-pathfinding` 作为核心，因为它主要查询已有 NavMesh，不负责构建；它适合更轻的“离线已有 navmesh”场景，但当前 AgentScape 需要同一个导航边界同时拥有 build + query truth。

## 静态几何归属

底层 Recast base NavMesh **仍然只表示静态世界**。1.10 不把动态物体 bake 进去，而是在 query 前用 TileCache overlay。

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

1.10 在这个 static base 上叠加当前 Rapier collider：

```text
static Recast NavMesh
        +
Rapier dynamic collider snapshot
        ↓
TileCache temporary obstacles
        ↓
Detour query
```

有 PhysicsSystem 时返回：

```text
scope = "current"
```

并附带：

```json
{
  "dynamicObstacles": {
    "coverage": "complete",
    "tracked": 3,
    "changed": 1,
    "operations": 2,
    "updates": 4,
    "syncVersion": 8
  }
}
```

如果某个 shape 无法安全映射，`coverage = "partial"` 并列出 `skipped`；不会把不完整动态世界冒充完整 truth。

## 动态障碍的唯一事实来源

动态导航不读取 Three.js visual bounds，而从 `PhysicsSystem.navigationObstacles()` 读取当前 Rapier collider。Stable obstacle id：

```text
<objectId>:<partName>:<colliderIndex>
```

例如：

```text
cabinet_1:door:0
cup_3:$root:0
```

映射规则：

```text
Rapier upright Cuboid   → TileCache Box + yaw
Rapier upright Cylinder → TileCache Cylinder
tiltted Cuboid/Cylinder → collider-derived conservative AABB Box
ConvexPolyhedron        → collider vertices → world AABB Box
其它 shape              → skipped / partial coverage
```

注意 conservative AABB 仍来自**物理 collider**，不是视觉 Mesh。

## Query-time reconcile，而不是每帧同步

Physics step 不会调用 TileCache。每次 `canReach/findPath` 前才：

```text
world.updateSceneQueries()
        ↓
Rapier collider snapshot
        ↓
与已注册 TileCache obstacle 比较
        ↓
unchanged → no-op
changed   → remove old + add new
removed   → remove
new       → add
        ↓
tileCache.update(navMesh) until upToDate
```

这样有三个好处：

1. Physics 60Hz 热路径不承担 WASM tile rebuild。
2. 多次物理抖动在没有导航 query 时不会产生无意义更新。
3. Navigation 查询仍然得到**查询时刻**的真实物理姿态。

TileCache 官方 obstacle request queue 上限 64。AgentScape 在 48 个 queued operations 前主动 flush，并有 70-obstacle 真实回归。

### 当前 pose，不是 action target

Navigation 始终读取 Rapier collider 当前 pose，而不是 action target。1.19 又把状态拆成：

```text
record.state.partTargets.door = open  // active/requested motor target
record.state.parts.door = open        // verified completion only
```

Motor 正在运动时，path query 看到的仍是中间物理姿态；Action-aware diagnosis 会把 `partTargets=open` 视为 already requested，避免重复建议。高层失败会 hold-current 并清 active request。详见 [`live-articulation.md`](./live-articulation.md)。

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

因为这些几何不属于 static base；1.10 会在下一次 query 时通过 TileCache reconcile，而不是让 static NavMesh dirty。

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
TileCache.destroy()
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
dynamicObstacles
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

1.10 仍没有加入：

```text
Crowd
off-mesh connection
导航 agent controller
自动沿路径移动对象
NavMesh/TileCache 二进制持久化
```

原因不是 Recast 不支持，而是这些能力有不同状态所有权。

动态障碍的 ownership/时序在 1.10 已收敛为 Rapier collider + query-time reconcile。剩余问题已经转为更高层：Door 等可交互障碍如何参与条件式 planning，以及谁负责真正沿路径执行 locomotion。

## 验证基线

1.10 的 Recast/Detour/TileCache 验证覆盖：

```text
固定墙迫使 Detour 绕行
完整静态隔断 → unreachable
dynamic wall 不进入静态 base NavMesh
dynamic wall 通过 TileCache 改变 current reachability
Rapier dynamic body 移动后无需 static rebuild
articulated Door collider pose 随运动更新
70 obstacles queue batching
fixed transform → static dirty
off-navmesh 与 disconnected 分开
并发 query 只 build 一次
真实 cabinet.glb：Body 纳入，Door Part 排除
Runtime dispose 释放 navigation resources
viewer 通过 SkillRegistry 查询 canReach/findPath
```

这保证 Navigation 是 Runtime truth，而不是 UI path helper。
