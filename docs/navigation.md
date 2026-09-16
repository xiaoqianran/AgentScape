# Navigation

AgentScape 的 Navigation 只负责回答：**哪里能走、从 A 到 B 有没有可行路径。**

```text
World Geometry + Physics Obstacles
              ↓
       NavigationSystem
              ↓
      NavigationBackend
              ↓
 Recast / Detour / TileCache
              ↓
            Path
              ↓
       LocomotionSystem
```

## Public surface

`NavigationSystem` 是 World Runtime 的导航语义层：

```text
findPath(start, end)
canReach(start, end)
suggestActions(start, end)
invalidate(reason)
status()
debugSnapshot()
```

`NavigationBackend` 是可替换的技术边界：

```text
build(staticGeometry, config)
syncObstacles(obstacles)
queryPath(start, end, options)
clear()
isReady()
```

当前 production backend：

```text
RecastNavigationBackend
├─ Recast      → static NavMesh generation
├─ Detour      → path query
└─ TileCache   → dynamic obstacle updates
```

## Source of truth

静态导航输入：

```text
Environment geometry
+ fixed object geometry
- dynamic / articulated Part geometry
```

动态障碍输入只来自：

```text
PhysicsSystem.getNavigationObstacles()
```

Navigation 不读取 visual bounds 作为当前物理障碍真值。

静态几何发生变化时：

```text
invalidate()
   ↓
next query
   ↓
NavMesh rebuild
```

动态 collider 变化时：

```text
Physics snapshot
   ↓
syncObstacles()
   ↓
TileCache update
```

不重建 static NavMesh。

## Boundary

Navigation decides **where an actor can go**.
Locomotion decides **how the actor actually moves**.
Physics decides **whether each movement is physically valid**.

Navigation **does not own**：

- character movement / velocity / acceleration
- character controller stepping
- collision resolution
- animation
- interaction execution
- crowd movement execution

这些分别属于 `LocomotionSystem`、`PhysicsSystem`、`InteractionSystem` 或更高层 actor controller。

## Extension rule

保持当前边界冻结。新增能力只有在现有 contract 无法表达时才扩展。

未来可能的扩展：

```text
off-mesh links    → jump / ladder / elevator / teleport
crowd avoidance   → ownership 先在 Navigation vs Locomotion 间明确
large-world tiles → benchmark 后再决定是否做 incremental rebuild
```

不要引入 `NavigationManager`、`NavigationService` 等额外中间层；`NavigationSystem → NavigationBackend` 已是当前稳定边界。