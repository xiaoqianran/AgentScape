# AgentScape 的工程研究方法

这篇不是编码规范，而是解释 AgentScape 每一轮为什么通常按下面的顺序推进：

```text
真实调用图
  ↓
明确缺口
  ↓
成熟开源实现
  ↓
许可证边界
  ↓
抽取最小模式
  ↓
映射回现有架构
  ↓
最小实现
  ↓
专项测试
  ↓
真实 E2E
  ↓
CodeGraph 反向审计
  ↓
全量检查
  ↓
独立 commit + push
```

---

## 1. 为什么第一步不是写代码

一个看起来合理的新功能，最危险的问题往往不是“写不出来”，而是：

```text
项目其实已经有相同能力
但名字不同
```

或者：

```text
新功能跨过了现有 transaction / state ownership
```

所以第一步先回答：

1. 当前入口是谁？
2. 谁调用它？
3. 它最终修改哪份状态？
4. 是否已经有相似实现？
5. 删除/修改它会影响谁？

CodeGraph 在这里主要用于：

```text
callers
callees
blast radius
symbol search
architecture exploration
```

例子：历史上删除重复 `toolCatalog` 前，不是因为“看起来重复”就删，而是先确认：

```text
SkillRegistry
已经是 Agent capability 的真实权威来源
```

再让 `ToolCallingAgent` 直接从 `SkillRegistry.definitions()` 导出 JSON Schema。

---

## 2. 如何定义“真实缺口”

不是：

> 竞品有这个功能，我们也应该有。

而是：

```text
用户目标
  ↓
当前调用图
  ↓
哪一个必要事实无法表达 / 无法执行 / 无法验证？
```

例如 Part Segmentation 阶段真正的缺口不是：

```text
我们没有 P3-SAM
```

而是：

```text
外部 segment 的 face ids
无法变成 Runtime 可绑定的 GLB Nodes
```

所以先定义：

```text
Segmentation Evidence
→ Materialization
→ Part Proposal
```

而不是先把一个巨大分割模型塞进默认 Runtime。

---

## 3. 如何找成熟开源实现

优先找：

- 已经被真实用户/benchmark 使用的项目。
- 与当前缺口直接相关的模块，而不是只看 README。
- 许可证明确。
- 数据结构和调用链能被源码验证。

研究时通常分三类：

### 可以直接复用

例如：

```text
glTF-Transform  MIT
CoACD           MIT
yourdfpy        MIT
SAPIEN          Apache-2.0
```

如果成熟库已经做了 parser / optimizer / geometry algorithm，就不自己再造。

### 可以研究思想，但不复制源码

例如：

```text
Articulate-Anything  本轮未发现清晰许可证
Auto-Threejs         无明确许可证
Grudge Studio Forge  本轮仓库根部未发现明确 LICENSE
Limina               AGPL-3.0
```

这类可以学习：

```text
pipeline shape
failure taxonomy
state model
verification stages
```

但不能复制源码进入 AgentScape。

### 可以作为外部 Provider

例如 Hunyuan3D-Part / P3-SAM 有自己的 Community License。

AgentScape 定义开放协议：

```text
External model
   ↓
Evidence / Proposal
   ↓
AgentScape Compiler
```

而不是默认分发其模型和权重。

---

## 4. 不读“整个项目”，读真正相关的调用链

错误研究方式：

```text
clone 10 个仓库
看 10 个 README
得到 100 个功能点
```

正确方式更像：

```text
我们缺 Motion Verification
         │
         ├─ OmniGibson action primitive failure
         ├─ Habitat rearrange settle/collision
         ├─ EmbodiedGen grasp sweep
         └─ AI2-THOR action result
```

只比较与缺口有关的真实结构。

例如研究 Aedifex 时，真正值得看的不是“它有建筑编辑器”，而是：

```text
GeometryContext
preview
validate
commit / cancel
```

因为这对我们控制隐式依赖、未来 proposal preview 有直接价值。

---

## 5. 把外部模式映射回现有架构

发现好设计后先问：

> 能不能用现有类表达？

例如 OmniGibson 有阶段化 Action failure。

错误做法：

```text
新建 ActionFailureManager
新建 VerificationService
新建 StageFactory
```

当前更合理的做法：

```text
扩现有 ArticulationVerifier report
+
AgentScapeError.details
```

因为真实缺口是“报告语义不足”，不是“缺一个 Manager”。

---

## 6. 确定性事实优先于 AI

AgentScape 的默认顺序：

```text
数学 / Schema / Geometry
        ↓
确定不了
        ↓
外部 Model / LLM / VLM
```

例子：

### Ground normalization

用 glTF bounds 计算，不让 LLM 看图片猜地面。

### Part Node 是否存在

直接查 GLB Document，不相信 Provider 字符串。

### Part parent 是否与视觉 hierarchy 一致

直接查 `getParentNode()` ancestor chain。

### Resource budget

用 glTF-Transform `inspect()`，不让模型估计“这个资产应该不大”。

AI 应该补充未知语义，而不是替代已经可以确定的事实。

---

## 7. Evidence 不能偷偷升级成 Capability

外部模型输出必须带身份。

```text
name heuristic
  ↓
semantic candidate

P3-SAM
  ↓
segmentation evidence

URDF
  ↓
joint evidence
```

只有 Compiler 确认：

```text
node exists
hierarchy valid
joint supported
axis valid
anchors valid
collider valid
actions exist
targets finite
```

才可以：

```text
manifest.parts
```

这个过程叫 admission，不叫 inference。

---

## 8. 最小实现不是最少代码，而是最少新概念

例如 face materialization 没有现成 glTF-Transform 高层函数。

我们最终自己写了一层薄逻辑，但没有写：

```text
GLTFParser
MeshOptimizer
MaterialCloner
UVRewriter
```

而是继续复用 glTF-Transform：

```text
Document
Accessor
Primitive
Mesh
Node
```

自己只做：

```text
face label
→ new index accessor
```

这就是“最小新概念”。

---

## 9. 测试分成四级

### 级别 1：纯单元测试

适合：

```text
schema
part topology
resource threshold
canonical identity
```

### 级别 2：真实库对象测试

避免 fake mock 掩盖 API 错误。

典型例子：

曾经用 fake parent mock，没有发现 glTF-Transform 正确 API 是：

```js
node.getParentNode()
```

而不是：

```js
node.getParent()
```

后来改成真实 `Document` 测试才锁住。

### 级别 3：真实资产 E2E

使用仓库里的：

```text
public/assets/cabinet.glb
```

验证：

```text
compile
→ output GLB round-trip
→ nodes
→ bounds
→ draw calls
```

### 级别 4：真实 Runtime / Service E2E

例如：

```text
AssetCompiler
→ AssetManager
→ GLTFLoader
→ PhysicsSystem
→ Rapier
→ open 240 steps
→ close 240 steps
```

以及：

```text
HttpCompilerProvider
→ multipart
→ FastAPI
→ trimesh
→ CoACD
→ Compiler Manifest
```

只有到了这一层，才知道“代码能拼起来”是否真的等于“系统能工作”。

---

## 10. 测试失败优先解释事实，不为了绿而放宽规则

几个典型案例：

### Joint anchor 测试从 0.39 变成 0.355

不是改生产代码迎合测试。

真实原因：

```text
原始 GLB hinge z = 0.39
center-below 后最终 Runtime z = 0.355
```

所以旧测试期待的是错误坐标。

最终修改测试，让它锁住正确语义。

### Provider fail 不应该让整个 compile fail

测试暴露后，不是 catch 后吞掉所有信息，而是：

```text
fallback 保留
+
quality advisory
+
provider error provenance
```

失败仍然可见。

---

## 11. 每次实现后再用 CodeGraph 反向审计

代码写完后再问：

```text
这个新 Pass 有几个入口？
有没有第二套旁路？
旧代码还在维护相同事实吗？
新的字段是否真的到 Manifest / Runtime？
```

例如 Part Collider 完成后，再审计：

```text
proposal collider
→ promotion
→ final ownership
→ Manifest
→ PhysicsSystem
```

确认没有另一条 whole-asset collider 路径在 articulated 场景继续生效。

---

## 12. Commit 是工程过程的一部分

一个阶段完成后：

```text
targeted tests
   ↓
full npm run check
   ↓
service tests
   ↓
git diff --check
   ↓
CodeGraph review
   ↓
Conventional Commit
   ↓
push main
   ↓
GitHub Actions
```

常用类型：

```text
feat:
fix:
perf:
refactor:
docs:
chore:
```

原则：

> 功能、研究、重构、修复尽量不混一个 commit。

比如竞争者审计是纯：

```text
docs: reassess competing embodied 3d architectures
```

没有为了文档 bump Runtime version。

---

## 13. 一个新能力的准入清单

今后新增能力前，至少回答：

```text
[ ] 当前调用图真的缺它吗？
[ ] 成熟实现证明这个抽象合理吗？
[ ] 许可证允许我们复用吗？
[ ] 能不能复用成熟库，而不是自造？
[ ] 新事实的 source of truth 在哪里？
[ ] Runtime 能执行吗？
[ ] 如果不能，是否明确叫 Evidence / Proposal？
[ ] mutation transaction owner 是谁？
[ ] failure 是否机器可读？
[ ] 是否有 deterministic validation？
[ ] 是否有真实资产 / Runtime E2E？
[ ] 新抽象减少复杂度还是增加平行状态？
```

如果最后一项答案是“只是以后也许有用”，默认不加。
