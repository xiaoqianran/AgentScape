# PhysicsSystem：物理状态与纯计算边界

## 状态归属

`PhysicsSystem` 仍然唯一持有 backend、Physics World、实体及关节映射、碰撞体句柄、碰撞组、角色控制器、事件和真实求解结果。Physics 的 `step()`、`writeback()`、`addObject()`、关节驱动、形状查询与碰撞触发继续在该系统中执行，**不复制第二份物理世界**。

## 本次提取的无状态模块

| 文件 | 单一职责 |
| --- | --- |
| `physics/NavigationObstacleGeometry.js` | 根据 backend 当前碰撞体快照，纯计算箱体、圆柱、胶囊、凸包的导航障碍投影；保留精确 yaw 与保守 AABB 标记、未知类型跳过诊断 |
| `physics/CounterfactualGeometry.js` | 纯计算碰撞形状包围半径、关节自适应采样数、密集采样上界与反事实收敛评分 |
| `PhysicsSystem.js` | 对真实物理世界执行查询、驱动关节、取快照、筛选实体；将只读几何输入交给独立算法后汇集结果 |

`shapeBoundingRadius(shape)` 原系统方法保留为兼容代理，现调用纯函数；`articulationCounterfactualSampleCount()`、`articulationPairCounterfactualConvergence()`、`getNavigationObstacles()` 的公开调用方式和结果字段不变。

## 约束和验收

- 导航障碍结果来自**当前 backend 快照**，不会缓存或以预估场景覆盖真实碰撞体。
- 非直立的圆柱、胶囊和箱体继续使用保守 AABB；直立箱体保留精确 yaw。凸包仅计算保守投影，不改变物理形状。
- 关节的适配采样仍由真实刚体及碰撞体尺寸推导，密度上下限不变，反事实是假设检测，不移动实际关节。
- 刚体操作的 manipulationBody() 也使用被提取的 ector3Array()；该共享依赖有独立回归测试覆盖，避免删除旧局部函数后在真实推/拖操作中出现运行时错误。
- 采样一致性评分只处理查询返回的证据，不能对不通过的碰撞判定伪造稳定结论。
- 在 `tests/world/physics-pure-geometry.test.js` 直接覆盖几何和采样边界；使用现有导航、Rapier/Jolt、关节反事实、WorldRuntime 与 E2E 测试检测行为回归。

本轮属于纯职责提取，并非替换求解器或改变 Physics 公共 API。
