# Spatial Runtime

`SpatialSystem` 是 World Runtime 的**只读空间查询层**。它位于 `Interaction` 之前（依赖层级更低），提供几何事实，但不执行动作、不拥有物理接触真相，也不负责渲染。

```text
World State
   ├─> Physics
   ├─> Spatial
   └─> Navigation
          \   |   /
          Locomotion
              ↓
         Interaction

World State ─────────> Rendering
```

依赖规则固定为：

```text
Interaction → Spatial   ✅
Spatial → Interaction   ❌
Spatial → Rendering     ❌
```

## 1. Spatial 拥有什么

Spatial 负责世界空间中的**几何查询事实**：

- world-space bounds / center / size
- nearby / distance-style query
- geometric ray query
- AABB overlap
- manifest-declared support surface
- manifest-declared receptacle containment
- read-only placement candidate search

Spatial 不负责：

- rigid-body contact / collision manifold
- character collision
- settle / sleeping
- pickup / carry / place
- navigation execution
- world mutation
- rendering state

真正的 Physics collision/contact 仍由 `PhysicsSystem` / backend 提供。Spatial 中的 `overlap` 仅表示几何包围盒重叠。

## 2. Query purity

Spatial query 必须是只读的。

`findFreeSpace()` 与 `findFreeSpaceInside()` 不允许为了测试候选位置而临时修改 `Object3D.position`、ObjectStore 或 Physics world。候选位姿通过短生命周期 `SpatialSnapshot` 的平移副本计算：

```text
ObjectStore representation
        ↓
SpatialSnapshot
        ↓
translated candidate snapshot
        ↓
overlap / containment query
```

这使查询可以被 Interaction、Validator、Observatory 重复调用，而不会产生隐藏 world mutation。

## 3. Geometry 与 Physics authority

Spatial API 使用明确的几何语义：

```js
spatial.overlappingIds(id, options)
spatial.overlapPairs(options)
spatial.supportGeometry(subjectId, targetId, options)
spatial.containmentGeometry(subjectId, targetId, options)
```

不要把 `overlap` 命名成 `collision`。后者属于 Physics authority。

`supportGeometry()` 返回的 `supported` 仅表示几何支撑条件成立，并带：

```text
evidence = spatial-geometry
```

它本身不证明物体已经物理稳定。

最终 Place verification 为：

```text
Physics: settled / slow / sleeping
                 +
Spatial: supportGeometry.supported
                 ↓
Interaction: placed + supportVerified=true
```

因此 `supportVerified` 是 Interaction post-condition，不是 Spatial 单独宣称的物理事实。

## 4. SceneGraph relations

`SceneGraph` 可以由 Spatial 几何事实派生：

```text
supportGeometry   → ON / SUPPORTS
containmentGeometry → INSIDE / CONTAINS
```

这些 relation 会显式记录：

```text
evidence: spatial-geometry
```

这样 relation provenance 不会和 Physics contact 混为一谈。

## 5. 当前 API

主要只读接口：

```js
spatial.snapshot()
spatial.getBounds(id, snapshot?)
spatial.findNearby(id, radius, snapshot?)
spatial.raycast(origin, direction, maxDistance)
spatial.overlappingIds(id, options?)
spatial.overlapPairs(options?)
spatial.getSupportSurface(targetId, surfaceId, snapshot?)
spatial.getReceptacle(targetId, receptacleId, snapshot?)
spatial.supportGeometry(subjectId, targetId, options?)
spatial.containmentGeometry(subjectId, targetId, options?)
spatial.findFreeSpace(objectId, targetId, options?)
spatial.findFreeSpaceInside(objectId, targetId, options?)
```

`findFreeSpace*` 当前仍属于 Spatial，因为它们只是 bounded geometric candidate query；真正的动作选择、Physics pose check、release transfer 与 settle 继续由 Interaction 负责。若未来 placement policy 继续变复杂，再按真实代码压力抽成 Interaction-side `PlacementPlanner`，现在不提前制造新层。

## 6. Three.js 边界

当前 Runtime Object 仍由 `THREE.Object3D` 承载，因此 bounds extraction 暂时需要 Three.js。Three-specific snapshot construction 已收敛到：

```text
runtime/spatial/SpatialSnapshot.js
```

Interaction 与 SceneGraph 不需要知道 `Box3.setFromObject()` 等实现细节。未来如果引入独立 `TransformState` / geometry representation，可以替换 snapshot adapter，而无需改变 Interaction → Spatial 的依赖方向。

## 7. Debug contract

`SpatialSystem.debugSnapshot()` 使用几何命名：

```text
bounds
overlapPairs
metrics.objectCount
metrics.overlapPairCount
metrics.overlapMargin
```

Observatory 只消费这个 observation contract，不读取 Spatial 内部实现状态。
