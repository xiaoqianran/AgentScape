# 关键架构决策、踩坑与反例

这篇记录 AgentScape 目前已经付过成本、以后不应该轻易重复的错误。

格式：

```text
问题
→ 早期/直觉方案
→ 为什么不够
→ 当前决策
→ 未来什么时候才允许改变
```

---

## 1. Agent Capability 只能定义一次

### 问题

Agent、UI、LLM gateway 都需要知道有哪些能力。

### 错误方向

```text
SkillRegistry
+
toolCatalog.js
+
AgentTools.schema()
```

三份定义看起来方便，长期一定漂移。

### 当前决策

```text
SkillRegistry
  ├─ handler
  ├─ permissions
  ├─ mutates
  ├─ required/properties
  └─ definitions() → LLM JSON Schema
```

AgentTools 只 delegate。

### 什么时候改变

只有 Skill 本身已经不能表达新 Runtime capability 时，不因为外部协议格式不同就复制第二份 Catalog。

---

## 2. 一次 mutation 只能有一个 history owner

### 典型问题

Batch action 内部调用多个 Skill。

如果每个 Skill 都自己：

```text
history.begin
history.commit
```

外层又有一次 transaction，就会产生：

```text
重复 snapshot
undo 粒度错误
rollback 不完整
```

### 当前决策

```text
executeBatch
  ↓
one outer transaction
  ↓
nested skills skipHistory=true
```

---

## 3. SceneGraph 是派生数据，不是第二个场景数据库

### 错误方向

每个 move/spawn/delete 手工同时改：

```text
ObjectStore
Three Scene
Physics
SceneGraph relations
```

维护成本会指数上升。

### 当前决策

SceneGraph 从 Store + Spatial facts 重建，只做 dirty/batch coalescing。

---

## 4. “名字像 door”不能自动得到 open

### 原因

```text
Door
```

可以说明语义，但不能说明：

```text
hinge axis
limits
collider
target
```

### 当前决策

Name heuristic 只能产生：

```text
semantic candidate
```

不能产生 executable action。

---

## 5. Part Candidate 不等于 Part Capability

### 层级

```text
ArticulationCandidate
      ↓
Part Proposal
      ↓
Executable Part
      ↓
Verified Part
```

每一层都比上一层多真实证据。

绝不能跳级。

---

## 6. URDF 数据可信，但坐标不能直接抄

URDF joint origin 有自己的 Joint Frame；Rapier anchor 在 rigid-body local frame。

错误做法：

```text
URDF origin xyz
→ parentAnchor
```

尤其 Compiler 已经做 center-below 后会错。

### 当前决策

```text
原始 GLB worldMatrix
↔ URDF frame
    只用于 compatibility validation

规范化后的当前 Document
→ 真正计算 Runtime parentAnchor
```

并且当前只支持能证明安全的 rotation 子集。

---

## 7. 不确定的 transform 不自动 normalize

自动做：

```text
center X/Z
bottom Y=0
```

因为它们确定。

不自动：

```text
猜 Up axis
猜单位
flatten hierarchy
清 root rotation
bake negative scale
```

因为它们可能破坏：

```text
animation
skin
part hierarchy
joint frame
语义 helper nodes
```

---

## 8. Preserve hierarchy 是资产编译原则

Hierarchy 不是视觉噪声。

今天看起来没用的 Node，未来可能代表：

```text
link
joint frame
semantic marker
interaction point
animation target
```

所以 glTF 优化不能以“树越平越好”为目标。

---

## 9. Provider 是可选增强，不是 baseline 单点故障

Remote Provider 可能因为：

```text
网络
服务升级
模型失败
返回格式错误
```

不可用。

### 错误方向

Provider 配置了，失败就整个 compile reject。

### 当前决策

```text
local deterministic compile
     ↓
provider optional upgrade
     │
     ├─ success → better result
     └─ failure → fallback + advisory
```

如果以后有“必须有 provider”场景，应做显式 strict policy，而不是改变默认失败语义。

---

## 10. validate before persistence

Compiled GLB / Manifest 只有在：

```text
schema valid
quality != rejected
```

之后才能写 `CompiledAssetStore`。

否则浏览器缓存会变成错误资产的持久来源。

---

## 11. Asset ID 是身份，不是 Map key 字符串

历史问题：相同 ID 的不同 Manifest 可以被静默覆盖。

### 当前决策

```text
same id + same canonical manifest
→ idempotent

same id + different manifest
→ conflict

replace
→ 必须显式
```

Scene restore 也必须检查 compatibility。

---

## 12. Resource Budget 必须看最终 Document

如果在 optimization 前统计：

```text
旧 vertex count
旧 textures
旧 primitives
```

然后拿它决定最终资产 admission，数据会过时。

### 当前决策

`ResourceBudgetPass` 在 Optimize 后重新 `inspect(context.document)`。

并且 draw calls 只统计 Runtime 默认 Scene，避免未使用的 alternate scene 导致误拒绝。

---

## 13. 不隐藏地自动减面

自动 simplify 可能破坏：

```text
silhouette
UV
normal
small movable parts
grasp geometry
joint-local geometry
```

当前策略：

```text
先报告预算
先 admission
```

未来要加 simplification，必须是显式 Pass，带 before/after report。

---

## 14. Runtime 资源必须明确释放

`scene.remove(object)` 不等于 GPU 资源释放。

需要显式处理：

```text
BufferGeometry.dispose
Material.dispose
Texture.dispose
BVH dispose
Rapier body remove
renderer dispose
listeners remove
```

同时要看资源 ownership，避免共享 Texture 被某一个 clone 提前释放。

---

## 15. 性能优化优先消灭重复事实计算

我们做过两类有效优化：

### SceneGraph rebuild coalescing

把多个 mutation 的 rebuild 合并。

### Spatial Snapshot reuse

同一轮：

```text
SceneGraph
Validator
Repair
```

共享一次 bounds / pairwise geometry facts。

比“换一个更快 for loop”收益更稳定。

---

## 16. face segment 不是 GLB Node

P3-SAM 类输出：

```text
triangle → segment id
```

Runtime Part：

```text
Node → rigid body → joint
```

中间必须有 materialization。

### 当前安全子集

只自动处理：

```text
TRIANGLES
100% face coverage
unique sourceNode
no skin
no morph
no unsupported extension
```

无法证明保持语义时，交给外部 Provider。

---

## 17. Materialization 尽量共享 vertex data

正确做法不是复制一整份 Mesh。

当前：

```text
shared POSITION
shared NORMAL
shared UV
shared Material
+
new indices per segment
```

这是 glTF-Transform Core API 上最薄的一层重组。

---

## 18. Node 名必须能唯一解析

Part Proposal 通过 node name 绑定 GLB。

所以：

```text
0 match → PART_NODE_MISSING
>1 match → PART_NODE_AMBIGUOUS
```

不能“取第一个”。

模糊身份会一路污染到 Physics body。

---

## 19. Proposal parent 必须与 GLB hierarchy 一致

如果 Proposal 说：

```text
handle.parent = door
```

但真实 GLB 是 sibling：

```text
Scene
├── Door
└── Handle
```

Physics hierarchy 与 visual hierarchy 会分叉。

因此 Compiler 用真实 `getParentNode()` ancestor chain 验证。

---

## 20. Executable child 必须有 executable parent

如果：

```text
door 不是 rigid body
handle.parent = door
handle 自己可执行
```

Runtime 实际找不到 parent body。

所以 child 必须满足 executable parent closure。

---

## 21. Whole-asset collider 不能继续覆盖 movable Part

这是 articulated asset 非常容易犯的错。

### 错误

```text
Root whole cabinet collider
+
Door collider
```

Door 发生 double ownership。

### 当前决策

最终 promotion 后重新分配 Mesh ownership：

```text
nearest executable Part ancestor
```

Root collider 只保留不属于 Part 的几何。

---

## 22. Mass 是 rigid body 总质量

Rapier 如果一个 body 有多个 collider，不能给每个 collider 都设置完整 body mass。

否则：

```text
body mass 4
2 colliders
→ 8
```

当前 Runtime 把总质量分摊到 colliders，至少保证总量语义正确。

惯性仍然是近似，因此不宣传高精度。

---

## 23. Whole-asset mass 不能直接给 articulated Root

Provider 估算的是整个资产质量。

资产拆成：

```text
Root + Door + Drawer
```

后把 whole mass 全给 Root，会和 Part 重复。

当前记录：

```text
ARTICULATED_MASS_UNPARTITIONED
```

保留 provenance，不偷偷按 AABB 比例猜质量。

---

## 24. Heavy geometry 必须消费 materialized GLB

原始 URL 里没有：

```text
Door__part_door
```

因此 whole-asset `/compile enrich` 不能冒充 per-part CoACD。

### 当前决策

```text
current Document
→ writeBinary
→ multipart
→ FastAPI
→ trimesh node graph
→ part-local CoACD
```

不要求中间 GLB 先上传到公网。

---

## 25. Heavy report 不重复保存 hull vertices

巨大 convex hull 数据只保留在：

```text
manifest.parts[*].physics.colliders
```

Compiler report 只保存：

```text
hull count
quality
faces
vertices count
extents
mesh quality
```

避免同一物理数据存两份。

---

## 26. Non-watertight Part 不猜 mass

Whole-asset fallback 曾有 extents-based mass estimate，但 Part-level heavy geometry更严格。

只有：

```text
trimesh.is_volume
+
valid positive volume
```

才给：

```text
massMethod = watertight-volume-density
```

否则 mass 缺失。

---

## 27. `verified` 这个词必须严格

曾经某个 collision quality 分支想叫：

```text
articulated-verified
```

但 Provider collider 只是来源更好，不等于经过 verifier。

最后改成：

```text
provider-part-colliders
```

只有真实 verifier 结果才能使用 `verified`。

---

## 28. UI 大文件不是自动重构理由

`main.js` 大不等于应该拆。

拆分只有在：

```text
出现独立责任
真实复用
可测试边界
```

时才做。

为了“文件行数好看”制造 Controller/Manager，会让依赖更难追。

---

## 29. 不为了消 warning 使用 private import/hack

当前已知：

```text
Rapier init deprecation warning
glTF-Transform browser externalization
Vite chunk warning
```

只要官方 public API 和 production build 正常，就不因为 warning：

```text
deep import private module
patch dependency
silence logger
```

优化要基于源码与真实成本。

---

## 30. “竞品有”不是设计理由

重新审计 Gizmo、Feather、Aedifex、Genesis、OmniGibson、Habitat、SAGE 等后，明确不做：

```text
为了 Gizmo 上 ECS
为了 Feather 做 Blueprint
为了 SAGE 引入 Manager 体系
为了 MCP 做第二套 Runtime API
为了功能数量变成 browser Unity
```

竞争研究的目标是找到：

```text
我们当前真正缺的能力
+
已经被成熟项目证明的最小模式
```

而不是追功能列表。
