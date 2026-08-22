
> 竞争/替代架构的 2026-08 复核见 [`alternatives-study.md`](./alternatives-study.md)。
# 引擎架构研究记录

这份文档记录 AgentScape 1.x 架构收敛前实际阅读过的项目，以及最终保留的原则。相关仓库均在本地拉取并通过 CodeGraph 追踪核心调用路径。

## 研究对象

| 项目 | 许可证 | 主要借鉴 |
| --- | --- | --- |
| HorizonRobotics/EmbodiedGen | Apache-2.0 | simulation-ready 资产流水线、生成后端解耦 |
| nepfaff/scenesmith | MIT | 分阶段场景构建、资产检索与生成分离 |
| generalholography/gizmo | Apache-2.0 | Editor/Headless 共用命令边界、原子批处理 |
| syndicalt/limina | AGPL-3.0 | Skill、权限、Trace/Replay 思想；只学习思想 |
| wrc356/Auto-Threejs | 未发现许可证 | compile/verify/repair guard 思想；不复制源码 |

## 收敛后的原则

### 1. Skill 是唯一能力边界

LLM、编辑器和未来 MCP 不直接操作 Three.js。能力由 SkillRegistry 注册，名称、描述、输入 Schema、权限和 Handler 在同一个定义里维护。

```text
Human / LLM / MCP
       ↓
  SkillRegistry
   ↓   ↓   ↓
Schema Policy Trace
       ↓
  WorldRuntime
```

早期单独维护的 `toolCatalog.js` 已删除，避免工具 Schema 和实际执行逻辑漂移。

### 2. 权限在执行前判断

权限示例：

- `world.read`
- `world.write`
- `asset.read`
- `asset.write`
- `spatial.read`
- `physics.read`

PolicyEngine 不参与渲染和物理，它只决定某个 Actor 是否允许执行 Skill。

### 3. Trace 必须有界

审计不能反过来拖垮运行时。TraceRecorder 会：

- 限制保留事件数量。
- 对二进制只记录类型和字节数。
- 截断超长字符串、数组和深层对象。
- 保留裁剪窗口前的哈希锚点，使长时间运行后仍能验证链一致性。

当前哈希链用于完整性检测，不宣称具备密码学不可抵赖性。

### 4. 多步修改需要事务

`executeBatch` 在执行前保存世界快照。任一内部 Skill 失败，恢复快照；全部成功才作为一个历史操作提交。

### 5. 世界构建采用阶段流水线

默认阶段：

```text
resolve_assets
      ↓
instantiate
      ↓
apply_relations
      ↓
validate
      ↓
repair
      ↓
finalize
```

每个阶段独立可替换，不把资产解析、布局和校验塞进一个巨大 Prompt。

### 6. Validation 与 Repair 分离

Validator 只报告确定性事实；Repair 才修改世界。修复后重新校验，如果硬错误数量增加则恢复之前的世界。

### 7. 浏览器 Runtime 不复制机器人模拟器

AgentScape 的执行目标保持为：

```text
GLB + Three.js + Rapier + Spatial Skills
```

EmbodiedGen、Isaac、MuJoCo 等更重系统应作为上游资产/仿真后端，而不是被重新实现进浏览器。

## 资源所有权与释放

当前 AssetManager 对每次实例化独立加载 GLB，不缓存共享 Three.js Geometry/Material/Texture。虽然网络和解析成本更高，但资源所有权非常清晰：一个世界对象拥有自己加载得到的渲染资源，删除对象时可以完整释放，不需要引用计数。

因此当前策略是先保证生命周期正确，不提前加入 GLB 缓存。只有真实性能数据证明加载缓存必要时，才应同时设计 Skeleton clone、共享纹理/BVH 和引用计数，否则缓存会把简单的所有权问题变成隐蔽的 use-after-dispose 或 GPU 泄漏。

对象删除会去重释放 Geometry、BVH、Material 和 Texture；Runtime 销毁还会释放环境 Geometry/Material、OrbitControls、Rapier World、Renderer 和 DOM Canvas。失败路径同样遵守资源所有权：GLB 节点校验失败、Store/Physics attach 中途失败都必须回滚并释放已经创建的资源。

## Scene Graph 新鲜度与批量更新

Scene Graph 是派生状态，不应在每帧物理更新时做 O(n²) 全量重建。当前采用 dirty + demand refresh：

```text
世界/物理发生变化
      ↓
sceneGraph.invalidate()/changed()
      ↓
只标记 dirty
      ↓
Agent 查询 / Inspector / Validator / Serializer
      ↓
sceneGraph.update()
      ↓
若 dirty 才重建
```

`changed()` 表示“世界发生变化”；单对象直接操作会立即刷新，处于 batch 时只标记 dirty。`update()` 表示“调用者现在需要最新关系”，因此即使在 batch 内也允许立即刷新，避免 Validator 在修复过程中读取旧关系。

Restore、Undo/Redo、Pipeline 和原子 batch 会合并重复变化，批量边界通常只重建一次。物理帧循环只在检测到刚体或关节姿态变化时 `invalidate()`，不会每帧重建。

场景导入在 destructive clear 前先做 Manifest 冲突和未知资产引用 preflight，避免明显无效的 Scene 把当前世界先清空。

## Spatial Snapshot：短生命周期几何事实

空间 Bounds 不做长期全局缓存。对象可能被编辑器、Rapier、关节或恢复流程随时改变，长期缓存会引入复杂的失效协议。当前采用一次查询事务内的 `SpatialSystem.snapshot()`：

```text
Validator / SceneGraph rebuild / Placement search
                ↓
      SpatialSystem.snapshot()
                ↓
每个对象只构建一次 Box3
                ↓
raw Box3 / center / size  ──→ 内部几何判断
rounded bounds            ──→ Agent / UI / JSON 输出
```

SceneGraph 使用 raw `Box3` 推导 `NEAR / ON / INSIDE`，避免三位小数展示精度影响几何判断。`getBounds()` 对外仍返回稳定的三位小数数组。

WorldValidator 每次运行只创建一个 Snapshot，并同时提供给 SceneGraph、地面检查和碰撞检查。 SceneGraph 的对象对遍历采用 `i < j`，每一对只计算一次距离，再显式生成双向 `NEAR` 并分别推导两个方向的 `ON / INSIDE`；不会为同一对对象重复做两遍 pair-level 计算。碰撞检查通过 `collisionPairs()` 只遍历 `i < j`，不会分别从 A→B、B→A 重复构建 Bounds。关系一致性也一次读取全部 Edge 并建立 Key Set，不再对每个 `ON` 关系重复扫描整张图。

`findFreeSpace()` 同样先冻结其他对象的 Snapshot；尝试多个候选位置时只重算正在移动对象自己的 Box，因此 Grid 搜索不会为每个候选重新扫描所有静态 Mesh。Snapshot 在函数返回后立即丢弃，不承担跨帧一致性。

## 可执行 Articulation 闭环

重新用 CodeGraph 阅读 Articulate-Anything、EmbodiedGen、ObjaTHOR 和 SceneSmith 后，AgentScape 把 articulated asset 明确拆为四层：

```text
Part / Link
    ↓
Semantic / Affordance annotation
    ↓
Joint + explicit action target
    ↓
Runtime verification
```

Articulate-Anything 的关键启发不是“用模型猜 joint”本身，而是候选需要被编译成可执行表示，再进入 simulator/render feedback。EmbodiedGen 同样把 part segmentation、part semantics、grasp generation、grasp evaluation 分阶段执行。AgentScape 因此不把 annotation 和 executable capability 混成一个字段。

当前第一条真实闭环已经完成：Part 的 `actions + targets + physics + joint` 形成可执行契约，InteractionSystem 按 action 查找 Part，PhysicsSystem 同步 revolute 与 prismatic 的旋转和位移，ArticulationVerifier 在隔离 Rapier World 中执行所有 target，再把验证结果写回资产 readiness。

旧 `door` 特例已经从 Runtime API 中删除。旧场景里的 `state.door` 只在 restore 时作为兼容迁移入口保留，不再影响新状态模型；新状态统一存储在 `state.parts[partName]`。

## Joint Frame 编译边界

URDF/机器人生态中的 joint frame 比“猜一个 pivot”可靠得多，但仍必须转换到 Rapier 的 rigid-body local anchor 表示。1.4 的 JointFramePass 只自动处理坐标可证明一致的安全子集；带任意 frame rotation、非单位 scale、GLB/URDF 零位姿不匹配时拒绝自动转换。

这个设计故意保守：错误 anchor/axis 往往仍能在物理引擎中“动起来”，却会产生错误运动学，因此比显式 `provisional` 更危险。后续若需要支持任意旋转 joint frame，应先验证 Rapier generic/frame API 能正确表达两侧不同 local joint frames，再扩展契约。

## Articulated Collision Ownership

可执行 Part 出现后，碰撞系统不能继续把 whole-asset collider 当 Root collider。1.6 在 Compiler 中建立唯一所有权：先用 Proposal-level collider 让可执行条件可判定，再基于最终 promoted Parts 重新分配 Mesh。Runtime 只消费最终 Manifest，不需要自己猜哪个 Mesh 应归哪个 rigid body。

这保持了职责边界：

```text
Compiler = 几何所有权 / collider provenance / quality
Runtime  = 按 Manifest 创建 Rapier bodies + colliders + joints
```

Runtime 不重新做编译期 Mesh 分析，Compiler 也不直接控制运行中的 PhysicsWorld。

## Binary Heavy Provider Stage

Compiler Provider 现在有两种职责不同的传输：JSON `enrich` 用于原始资产 URL 和轻量 metadata；multipart `part-geometry` 用于必须消费“当前编译中间 GLB”的重型几何任务。两者共用同一个 endpoint 和超时/错误边界，不增加第二套服务配置。

这形成一个可继续扩展的稳定边界：未来需要 materialized mesh 的 VHACD、surface extraction、interaction geometry 等任务，可以继续走 binary stage，而不必把中间资产上传到公网 URL。
