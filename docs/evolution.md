# AgentScape 架构演进：从第一个 Runtime 到 1.7.0

这篇不是 changelog。

它记录每一阶段背后的问题：

```text
当时系统是什么样？
      ↓
哪里不够？
      ↓
我们研究了什么？
      ↓
最终只引入了什么最小能力？
      ↓
这个决策后来又暴露了什么新问题？
```

理解这条演进线，比记住当前所有类更重要。

## 阶段地图

```text
原型 Runtime
   │
   ▼
真实 GLB + Rapier
   │
   ▼
Human / Agent 共用 WorldRuntime
   │
   ▼
Spatial / Persistence / History
   │
   ▼
Skill / Policy / Trace / Validation        1.0
   │
   ▼
Agent-Ready Asset Compiler                 1.1
   │
   ▼
Normalization / Identity / Resource Budget
   │
   ▼
Runtime lifecycle / spatial truth
   │
   ▼
Articulation Runtime Verifier
   │
   ▼
Part Proposal / URDF / Segmentation        1.3–1.4
   │
   ▼
Face → Stable GLB Part Nodes               1.5
   │
   ▼
Part Collision Ownership + Runtime E2E     1.6
   │
   ▼
Per-Part Heavy Geometry / CoACD            1.7
   │
   ▼
Motion Sweep / Navigation                  下一阶段
```

---

## 0. 起点：先证明 Agent 可以住在一个真实 3D Runtime

初始提交：

```text
54fed47 feat: bootstrap AgentScape interactive 3D agent runtime
```

最初目标很简单：

```text
Three.js Scene
   │
   ├─ Object
   ├─ Camera
   └─ Human Interaction

Agent
   │
   ▼
最小操作 API
```

这一步只回答：

> Web 页面里的 3D Scene 能不能成为 Agent 真正修改的环境？

而不是只让 Agent 输出一段 Three.js 代码。

很快接上 Pages CI：

```text
8bdeb6a ci: deploy AgentScape to GitHub Pages
```

从第一天开始，项目就要求：

```text
main branch
→ check
→ build
→ deploy
```

而不是“本机能跑就算完成”。

---

## 1. 早期模块化：先分责任，不追抽象层数

```text
cacddb7 refactor: modularize runtime for stable extensibility
```

初始原型很容易出现：

```text
main.js
├── scene
├── assets
├── physics
├── interactions
├── agent actions
└── persistence
```

全部混在一起。

但这时没有引入：

```text
ManagerFactory
SceneService
PhysicsFacade
AgentRuntimeController
```

而是只拆已经有独立责任的系统。

这形成了之后一直保持的原则：

> 抽象来自已发生的重复和边界，不来自“以后可能需要”。

---

## 2. 从假物体到真实 GLB + Rapier

```text
31163bf feat: load real GLB assets with Rapier articulations
```

这一步第一次把项目从“3D UI demo”拉向真实 world engine。

问题从：

```text
画一个柜子
```

变成：

```text
加载一个真实 GLB
→ 绑定 Rapier
→ Door 真的是 jointed rigid body
```

核心认知开始改变：

```text
视觉对象
≠
可交互对象
```

一个资产真正能 open，需要：

```text
visual node
joint
collider
physics body
target state
```

这个认识后来成为整个 Agent-Ready Asset Compiler 的起点。

---

## 3. Human Editor 与 Agent 必须操作同一个 Runtime

```text
c020440 feat: add visual scene editor with shared agent runtime
```

很容易走向两套系统：

```text
Human Editor State
        +
Agent World State
```

AgentScape 没有这么做。

最终原则：

```text
Human
  │
  ├──────────┐
  ▼          ▼
Editor      Agent
  │          │
  └────┬─────┘
       ▼
   WorldRuntime
```

这意味着 Agent 与 Human 的区别只在入口，不在权威状态。

这个决定后来支撑：

```text
undo/redo
scene persistence
trace
policy
skill execution
```

全部共享同一世界。

---

## 4. 空间 Agent 不能靠随手填坐标

```text
d86f621 feat: add spatial intelligence and collision-aware placement
```

最早 Agent 很容易产生：

```json
{ "position": [2.3, 0, -1.8] }
```

但真实空间任务更需要：

```text
附近有什么？
哪里有空位？
能不能放在桌子上？
这个位置会不会碰撞？
```

因此引入：

```text
findNearby
findFreeSpace
place
raycast
bounds
```

这一步建立了一个重要产品方向：

> Agent 应该调用高层空间 API，而不是直接操作任意坐标。

后来所有 navigation / reachability 讨论，都是在这条原则上继续扩展，而不是推翻它。

---

## 5. LLM 只是能力调用者，不是 Runtime

```text
78a44c8 feat: add provider-neutral LLM tool-calling agent loop
```

这里没有把业务逻辑写进 prompt。

而是：

```text
LLM
 ↓
tool call
 ↓
AgentTools / Skill
 ↓
WorldRuntime
```

同时 Gateway provider-neutral：

```text
OpenAI-like
自定义 Gateway
Local Planner
```

都可以更换。

这让 Runtime 不依赖某个模型厂商，也不让 prompt 成为真实业务规则。

---

## 6. Asset Library 与 Generator 也必须 provider-neutral

```text
63e46ee feat: add searchable asset library and generation gateway
```

项目目标不是绑定某个 3D 生成模型。

正确边界是：

```text
Hunyuan3D
TRELLIS
Blender
Objaverse
EmbodiedGen
人工模型
     │
     ▼
    GLB
     │
     ▼
AgentScape
```

因此 Asset Generator 只是可选 Gateway。

之后 Asset Compiler 的所有设计都延续：

> generator-neutral，GLB-first。

---

## 7. World 需要真正的持久化和历史

连续三步：

```text
3c5ee19 feat: add versioned scene persistence and import export
1fa4309 feat: add undo redo command history and autosave
6c66ea7 feat: add semantic scene graph and spatial relations
```

项目开始从“当前页面 Scene”变成“长期 World”。

关键边界逐渐明确：

```text
SceneSerializer
→ durable world representation

CommandHistory
→ mutation history

SceneGraph
→ derived semantic relations
```

这里的一个重要设计是：

```text
SceneGraph 不是 durable source of truth
```

它从真实 object/spatial facts 派生。

---

## 8. 1.0：从工具集合升级成 Agent-native World Engine Core

```text
df09e0d feat: promote AgentScape to agent-native world engine core
```

这是第一次系统性回答：

> 一个 Agent World Engine 除了“能修改 Scene”还缺什么？

加入：

```text
PolicyEngine
TraceRecorder
SkillRegistry
WorldValidator
RepairEngine
PipelineEngine
EmbodiedGenAdapter
```

架构：

```text
LLM / Human
    │
    ▼
SkillRegistry
  /   |   \
validate policy execute
       │
       ├── Trace
       ▼
  WorldRuntime
```

这里曾出现一个后续要修的重要问题：

```text
AgentTools
Tool Catalog
SkillRegistry
```

能力 schema 有重复定义。

这在 1.1.1 被清理。

---

## 9. 1.1：为什么必须有 Agent-Ready Asset Compiler

```text
bcd59e2 feat: add agent-ready GLB asset compiler pipeline
```

这是项目最关键的战略转折之一。

之前可以手工做一个 cabinet Manifest：

```text
door node
joint
open target
collider
```

但现实输入是：

```text
任意普通 GLB
```

问题变成：

> 如何让普通 GLB 逐步获得 Agent 能理解并执行的能力？

初始流水线：

```text
GLB
 ↓
Inspect
 ↓
Normalize
 ↓
Geometry
 ↓
Semantics
 ↓
Articulation Candidate
 ↓
Collider
 ↓
Remote Enrichment
 ↓
Optimize
 ↓
Quality
 ↓
Manifest
```

从这里开始，Compiler 成为独立主线，而不是 AssetManager 的一个 helper。

---

## 10. 1.1.1：清除重复契约，强制能力真实

```text
a2bc29f refactor: consolidate engine contracts and harden runtime
6630959 fix: enforce executable asset capabilities and compiler quality gates
1f0ffc5 chore: clean compiler artifacts and unify version source
```

### 删除重复 Tool Catalog

CodeGraph 证明 `SkillRegistry` 已经能成为唯一能力边界，于是删除重复：

```text
src/agent/toolCatalog.js
```

ToolCallingAgent 改为从：

```text
SkillRegistry.definitions()
```

生成模型工具 schema。

### `resolveAsset` 被移出 Agent-facing Skill

原因不是功能不好，而是 mutation semantics 不清晰。

Agent 改为：

```text
searchAssets
+
generateAsset
```

Internal library 仍可以有 resolve。

### `runWorldPipeline` 补权限

外层 Skill 不能通过调用内部 API 绕过：

```text
asset.write
physics.read
```

权限必须以真实副作用为准。

---

## 11. 质量状态：ready / provisional / rejected

Compiler 需要回答的不只是“成功 / 失败”。

最终形成：

```text
rejected
  └─ hard invariant failed

provisional
  └─ 能使用，但仍有不确定/低质量信息

ready
  └─ 当前 gate 全部满足
```

典型 provisional：

```text
coarse collider
low semantic confidence
unverified articulation
mesh topology warning
```

这让“不确定”成为系统数据，而不是藏在日志中。

---

## 12. 1.1.3：为什么 Normalize 必须保守

```text
6f370cf feat: add conservative GLB structure normalization
```

研究 glTF-Transform 后，选择只自动做：

```text
center X/Z
bottom Y=0
```

不自动：

```text
axis rotation guess
flatten
clear root rotation
negative scale bake
unit scaling guess
```

因为 glTF hierarchy 可能携带：

```text
animation
skin
future articulation
semantic structure
```

“清理得更干净”不一定“语义更正确”。

---

## 13. 1.1.4：身份、Provider fallback、Mesh Quality

```text
b533d04 fix: harden asset identity and compiler fallback semantics
```

这一轮解决三个长期一致性问题。

### Asset ID conflict

以前：

```text
same id
→ silent overwrite
```

现在：

```text
same id + same manifest → idempotent
same id + different manifest → explicit conflict
replace → explicit only
```

### Optional Provider 失败

以前容易把：

```text
provider configured
```

理解成：

```text
provider required
```

现在：

```text
remote fail
→ local fallback survives
→ ENRICHMENT_FAILED advisory
```

### Mesh Quality

Heavy service 用 trimesh 提供：

```text
watertight
windingConsistent
components
volume
```

浏览器不重新实现拓扑算法。

---

## 14. 1.1.5：浏览器 Resource Admission

```text
0cc1cad feat: add browser asset resource admission budget
```

问题不是理论 WebGL limit，而是：

> 一个未知 GLB 可能让浏览器在 parse 前就被 500MB 输入拖垮。

防线分三层：

```text
UI file.size
   ↓
AssetCompiler input bytes
   ↓
URL streaming Content-Length + accumulated bytes
```

统计使用 glTF-Transform `inspect()`，并且在 Optimize 后重新统计最终 Document。

重要修正：

```text
draw calls
只统计默认 Runtime Scene
```

而 texture VRAM / animation 等仍看整个 GLB 资源。

---

## 15. Runtime 真实性：资源释放、Graph 重建、Spatial Snapshot

连续优化：

```text
7a5b141 fix: make runtime resource ownership and cleanup explicit
ccd9d52 perf: coalesce semantic graph rebuilds and track physics dirtiness
f9d9315 perf: reuse spatial snapshots across graph and validation
```

这三步的共同主题不是“跑分”，而是：

```text
谁拥有资源？
什么事实重复计算？
什么时候真的 dirty？
```

### Explicit disposal

解决：

```text
scene.remove
≠
GPU / Rapier resource release
```

### Coalesced graph rebuild

多个 mutation 不再每一步 rebuild SceneGraph。

### Spatial Snapshot

Graph / Validator / Repair 在同一轮共享 bounds / pairwise facts。

这形成之后的性能原则：

> 优先消灭重复事实计算，而不是微优化循环。

---

## 16. Articulation Verifier：Manifest 能执行还不够

```text
9463e5d feat: verify executable articulated assets in Rapier
```

这是 Compiler 从静态验证走向 Runtime verification 的第一步。

流程：

```text
compiled asset
   ↓
instantiate
   ↓
Rapier body + joint
   ↓
set target
   ↓
step simulation
   ↓
finite?
moved?
accepted?
```

于是：

```text
executable
≠
verified
```

第一次被代码明确分开。

---

## 17. Part Proposal：不绑定一个分割/关节模型

```text
1e30953 feat: add provider-neutral hierarchical part proposals
```

研究 SAPIEN、ManiSkill、Articulate-Anything、yourdfpy 后，决定不把 Runtime 直接绑定某个模型输出。

统一：

```text
Part Proposal v1
```

来源可以是：

```text
URDF
VLM
人工标注
Part Segmenter
外部服务
```

但 Proposal 只有满足：

```text
node
hierarchy
joint
axis
limits
anchors
collider
action
target
```

才能 promotion。

还加入 parent closure：

```text
child executable
→ parent 也必须有 Runtime body
```

---

## 18. URDF Adapter：复用 parser，不手写 XML

选择：

```text
yourdfpy (MIT)
```

原因：

```text
我们只需要可信 link/joint structure
不需要拉整个 SAPIEN Runtime
```

Adapter 提取：

```text
parent / child
joint type
axis
limits
origin matrix
fixed-chain composition
```

但不会猜：

```text
open
action target
collider
mass
```

这体现：

> 可信机械事实可以自动进入 Evidence，行为语义不能凭空补。

---

## 19. 1.4：Segmentation Evidence 与 Joint Frame

```text
65e83b2 feat: add segmentation evidence and safe joint-frame compilation
```

研究 EmbodiedGen / Hunyuan3D-Part 后发现：

```text
P3-SAM 输出的是 face ids
```

不是 GLB Node。

因此先定义：

```text
Segmentation Evidence
```

而不是直接生成 `manifest.parts`。

Joint Frame 同期只支持安全子集：

```text
原始 GLB frame 与 URDF 可证明一致
→ 才自动生成 anchors
```

rotation / scale 不满足条件则 report-only。

---

## 20. 1.5：face segment 真正变成 GLB Part Node

```text
fb6892e feat: materialize face segmentation into stable glb parts
```

这是很关键的一步。

之前：

```text
face segment
→ evidence only
```

现在安全子集：

```text
face labels
   ↓
new index accessors
   ↓
shared POSITION / NORMAL / UV / Material
   ↓
stable child Nodes
```

没有写第二套 glTF parser，也没有复制整个 Mesh。

真实 cabinet 测试验证：

```text
12 faces
→ 6 + 6
→ 36 indices 总数不变
→ bounds 不变
→ GLB round-trip 成功
```

同时 ResourceBudget 能看到拆分导致 draw calls 上升。

---

## 21. 真实 glTF API 测试抓到一个旧 Bug

之前 fake test 使用：

```js
node.getParent()
```

真实 glTF-Transform API 是：

```js
node.getParentNode()
```

合成 mock 测试没有暴露。

换成真实 `Document` 后，问题立刻出现。

这个案例强化了一条测试原则：

> 对第三方库对象，至少要有一层真实 library-object test，不能全靠 fake mock。

---

## 22. 1.6：Part Collider 与 Collision Ownership

```text
c506e3c feat: compile articulated part collision ownership
```

Materialized Part 有了 Node，但仍缺自己的物理几何。

第一步做确定性 local AABB：

```text
Primitive indices
→ POSITION
→ Mesh world
→ Part rigid local
→ AABB
```

随后发现更重要的问题：

```text
whole-asset collider
+
Part collider
```

会 double ownership。

于是增加最终 ownership：

```text
nearest executable Part ancestor
```

Root 只拥有其余 Mesh。

这一轮还修了两个物理语义 Bug：

### Multi-collider mass duplication

`mass` 应该是整个 rigid body 总质量，不能每个 collider 重复设置完整值。

### Whole-asset mass after articulation

Provider 的 whole mass 不能全部继续放 Root。

当前保留：

```text
ARTICULATED_MASS_UNPARTITIONED
```

而不是猜分配。

---

## 23. Joint Anchor 的规范化坐标 Bug

真实 Runtime E2E 暴露：

```text
URDF compatibility
使用原始 GLB
```

是对的。

但写入 Rapier 的 anchor 仍用原始位置是错的，因为：

```text
NormalizeTransformPass
已经 center-below
```

真实 cabinet hinge：

```text
原始 z=0.39
最终 z=0.355
```

修正后：

```text
原始 frame → validation
当前 normalized Document → emitted anchor
```

这个案例说明：

> “验证输入是否合法”的坐标系，和“Runtime 最终执行”的坐标系，可以不同。

---

## 24. 真实 Runtime open → close 闭环

此时不再只测 Manifest。

完整测试：

```text
cabinet.glb
→ compile
→ materialize Door
→ Part collider
→ promote
→ optimized GLB
→ AssetManager
→ GLTFLoader
→ PhysicsSystem
→ Rapier root body + door body
→ set target -1.2
→ 240 steps
→ Door opened
→ set target 0
→ 240 steps
→ Door returned
```

这第一次完整证明：

```text
Segmentation
→ Runtime Action
```

纵向链真的通了。

---

## 25. 1.7：Per-Part Heavy Geometry

```text
5836cb3 feat: add per-part heavy geometry enrichment
```

浏览器 local AABB 仍然 coarse。

现有服务只知道原始公网 GLB URL：

```text
whole-asset CoACD
```

但 materialized Node：

```text
Door__part_door
```

不存在于原始文件。

所以不能假装 whole CoACD 是 Part collider。

最终边界：

```text
current materialized Document
→ writeBinary
→ multipart FormData
→ same /compile endpoint
→ trimesh scene graph
→ Part-local Mesh
→ CoACD
→ convexHull
→ validatePhysics
→ replace AABB fallback
```

这一设计没有增加第二个 Compiler endpoint 配置，也不需要把中间 GLB 上传公网 URL。

真实 E2E：

```text
HttpCompilerProvider
→ FastAPI
→ trimesh
→ CoACD
→ Manifest Part convexHull
```

成功。

非 watertight Door：

```text
mass = missing
```

没有再用 AABB 体积猜质量。

---

## 26. 竞争者重新审计：为什么下一步不继续堆 Editor 功能

```text
879a611 docs: reassess competing embodied 3d architectures
```

重新 CodeGraph：

```text
Gizmo
Feather
Aedifex
Trigen
Chisel
Genesis
SAPIEN
ManiSkill
OmniGibson
AI2-THOR
Habitat
SAGE
EmbodiedGen
SceneSmith
...
```

结论：

```text
Web + AI + 3D Editor
已经不是稀缺能力
```

Feather / Aedifex 等已经很强。

AgentScape 应继续守：

```text
Unknown GLB
→ executable asset
→ physical runtime
→ verification
→ Agent-readable failure
```

外部项目共同指出的下一缺口是：

```text
Motion Sweep Validation
```

而不是 Blueprint、更多 Inspector、更多 Editor Panel。

---

## 27. 到 1.7.0，架构已经形成什么

从第一天的：

```text
Agent
→ modify 3D Scene
```

演进成：

```text
                          Human
                            │
Agent / LLM ────────────────┤
                            ▼
                       SkillRegistry
                            │
                       Policy / Trace
                            │
                            ▼
                       WorldRuntime
                  ┌─────────┼─────────┐
                  ▼         ▼         ▼
               Spatial   Physics   SceneGraph

普通 GLB
   │
   ▼
AssetCompiler
   │
   ├─ deterministic inspect
   ├─ evidence
   ├─ materialization
   ├─ proposal
   ├─ joint
   ├─ collider
   ├─ heavy geometry
   ├─ budget
   └─ quality
   │
   ▼
Executable Manifest
   │
   ▼
WorldRuntime
   │
   ▼
Rapier
   │
   ▼
Verifier
```

真正不变的主线其实只有一句：

> **让 Agent 的空间能力从“描述”逐步变成“Runtime 可以执行并验证的事实”。**
