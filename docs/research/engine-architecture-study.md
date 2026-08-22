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
