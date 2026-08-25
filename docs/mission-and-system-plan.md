# AgentScape 最终使命与系统规划

> 本文描述 AgentScape 的 **Target Architecture / 目标架构** 与后续工作分解。
> 当前已经真实存在的实现、状态所有权与调用链，以 [`architecture.md`](./architecture.md) 为准；当前成熟度与近期任务，以 [`status-and-roadmap.md`](./status-and-roadmap.md) 为准。

---

## 1. 最终使命 / Mission

AgentScape 最终要成为：

> **一个把自然语言中的世界意图，编译成可生成、可交互、可执行、可验证三维世界的 Agent-native World Compiler & Runtime（面向智能体的世界编译器与运行时）。**

核心不是“AI 会建模”，也不是“在 Three.js 上接一个 LLM”。

AgentScape 真正拥有的是：

> **World Compilation Authority / 世界编译权。**

即：AI 可以提出世界结构、语义、规则、资产与修复方案，但什么能够进入世界、什么动作真实发生、什么结果算成功，必须由 AgentScape 的确定性编译、运行时与验证链决定。

### 1.1 最终闭环 / End-to-end Loop

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ User / 用户                                                             │
│                                                                          │
│ “生成一个宿舍：门能开，灯能控制，拿到钥匙才能打开柜子。”               │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ Natural-language intent / 自然语言意图
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ World Planner / 世界规划器                                               │
│ Intent → entities / spaces / interactions / rules / acceptance criteria │
│ 意图 → 实体 / 空间 / 交互 / 规则 / 验收条件                             │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ World IR / 世界中间表示                                                  │
│ Entity + Spatial + Physics + Capability + State + Rule + Acceptance     │
│ 实体 + 空间 + 物理 + 能力 + 状态 + 规则 + 验收条件                      │
└─────────────────┬─────────────────────────────────┬──────────────────────┘
                  │                                 │
                  ▼                                 ▼
┌────────────────────────────────┐   ┌─────────────────────────────────────┐
│ Asset Compiler / 资产编译器    │   │ Interaction & Rule Compiler        │
│ 3D → executable entity        │   │ / 交互与规则编译器                 │
│ 3D → 可执行实体               │   │ semantics → executable behavior   │
└────────────────┬───────────────┘   └──────────────────┬──────────────────┘
                 │                                      │
                 └──────────────────┬───────────────────┘
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ World Compiler / 世界编译链                                              │
│ assets + layout + physics + state + interaction + rules                 │
│ 资产 + 布局 + 物理 + 状态 + 交互 + 规则                                 │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ World Runtime / 世界运行时                                               │
│ Rendering / 渲染  Physics / 物理  Navigation / 导航  Actions / 动作    │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Verification & Repair / 验证与修复                                       │
│ execute → observe → verify → attribute → repair → re-run                │
│ 执行 → 观测 → 验证 → 归因 → 修复 → 再执行                              │
└──────────────────────────────────────────────────────────────────────────┘
```

最终用户面对的不是“生成了一张 3D 图”，而是：

```text
World Intent / 世界意图
        ↓
World Structure / 世界结构
        ↓
Executable Entities / 可执行实体
        ↓
Executable Behaviors / 可执行行为
        ↓
Deterministic Runtime / 确定性运行时
        ↓
Verified World / 已验证世界
```

---

## 2. 最核心的抽象：World IR / 世界中间表示

AgentScape 不应该让 Agent 直接写 Three.js / Rapier 控制逻辑；AI 的主要输出应该先落到统一的世界中间表示。

```text
World IR / 世界中间表示
│
├─ Scene / 场景
│  ├─ Room / 房间
│  ├─ Region / 区域
│  └─ Environment / 环境
│
├─ Entity / 实体
│  ├─ Door / 门
│  ├─ Cabinet / 柜子
│  ├─ Table / 桌子
│  ├─ Light / 灯
│  └─ Key / 钥匙
│
├─ Spatial Relation / 空间关系
│  ├─ ON / 在……上
│  ├─ IN / 在……里
│  ├─ NEAR / 靠近
│  └─ CONNECTED / 连接
│
├─ Physics / 物理
│  ├─ Rigid Body / 刚体
│  ├─ Collider / 碰撞体
│  ├─ Mass / 质量
│  ├─ Friction / 摩擦
│  └─ Joint / 关节
│
├─ Capability / 能力
│  ├─ OPEN / 打开
│  ├─ CLOSE / 关闭
│  ├─ PICKUP / 拿起
│  ├─ PLACE / 放置
│  ├─ PRESS / 按下
│  └─ SWITCH / 开关
│
├─ State / 状态
│  ├─ openAmount / 打开程度
│  ├─ locked / 是否上锁
│  ├─ powered / 是否通电
│  └─ heldBy / 当前持有者
│
├─ Rule / 世界规则
│  ├─ Event / 事件
│  ├─ Condition / 条件
│  └─ Effect / 结果
│
└─ Acceptance / 验收条件
   ├─ door angle >= 80° / 门实际角度至少 80°
   ├─ key can be picked up / 钥匙真实可拿起
   └─ alarm triggers after open / 开门后报警真实触发
```

### 2.1 World IR 不是第二份 Runtime Truth

World IR 是 **计划与编译契约**，不是可以覆盖 Runtime 的第二份事实。

```text
AI Proposal / AI 提议
        │
        ▼
World IR / 世界中间表示
        │ compile / 编译
        ▼
Runtime State / 运行时状态  ───────►  Physics Truth / 物理事实
        │                                  │
        └──────── observe / 观测 ◄─────────┘
                       │
                       ▼
              Verification / 验证
```

原则：

- IR 说“门应该能打开”只是目标；
- Manifest 说“门具有 OPEN capability”只是已准入能力；
- 只有 Runtime + Physics 证明真实角度达到验收条件，动作才是 verified success / 已验证成功。

---

## 3. Entity Model / 实体模型

传统引擎中的 `door.glb` 只是视觉资产；AgentScape 中的“门”必须是可执行实体。

```text
Door Entity / 门实体
│
├─ Visual / 外观
│  └─ door.glb
│
├─ Parts / 部件
│  ├─ Frame / 门框
│  ├─ Leaf / 门板
│  └─ Handle / 把手
│
├─ Physics / 物理
│  ├─ Frame: fixed / 门框：固定
│  └─ Leaf: articulated / 门板：关节体
│
├─ Joint / 关节
│  └─ Revolute hinge / 旋转铰链
│
├─ Capabilities / 能力
│  ├─ OPEN / 打开
│  ├─ CLOSE / 关闭
│  ├─ LOCK / 上锁
│  └─ UNLOCK / 解锁
│
├─ State / 状态
│  ├─ openAmount / 打开程度
│  └─ locked / 是否上锁
│
└─ Verification / 验证
   └─ actual joint angle >= 80° / 实际关节角度至少 80°
```

所以系统必须始终保持：

> **3D geometry is one component of an entity. / 3D 几何只是实体的一部分。**

---

## 4. 五大核心系统 / Five Core Systems

最终架构压缩为五个核心系统。World IR 横跨五者，不单独复制一套 Truth。

```text
┌────────────────────────────────────────────────────────────────────┐
│ AgentScape                                                         │
├────────────────────────────────────────────────────────────────────┤
│ ① World Planner / 世界规划器                                      │
│    Natural language → World IR / 自然语言 → 世界中间表示          │
│                                                                    │
│ ② Physical-Semantic Asset Compiler / 物理语义资产编译器           │
│    Raw 3D → Executable Entity / 原始 3D → 可执行实体              │
│                                                                    │
│ ③ Interaction & Rule Compiler / 交互与规则编译器                  │
│    Semantics → Executable Behavior / 语义 → 可执行行为            │
│                                                                    │
│ ④ World Runtime / 世界运行时                                      │
│    Render + Physics + Navigation + State / 渲染+物理+导航+状态    │
│                                                                    │
│ ⑤ Verification & Repair / 验证与修复系统                          │
│    Execute → Verify → Attribute → Repair / 执行→验证→归因→修复    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 5. Core ① — World Planner / 世界规划器

职责：把用户的自然语言目标变成严格、可验证、可重新编译的 World IR / WorldSpec。

```text
User Prompt / 用户描述
          │
          ▼
Intent Analysis / 意图分析
          │
          ├─ Entities / 实体
          ├─ Spaces / 空间
          ├─ Relations / 关系
          ├─ Interactions / 交互
          ├─ Rules / 规则
          └─ Acceptance / 验收条件
          │
          ▼
World IR / WorldSpec
          │
          ▼
Schema + semantic checks
Schema + 语义检查
          │
          ▼
Canonical Pipeline / 标准世界管线
```

### 当前 AgentScape 映射

主要已有基础：

- `src/pipeline/WorldSpec.js`
- `src/pipeline/createWorldPipeline.js`
- Generated World Admission
- Deterministic World Composer
- Bounded World Regeneration

### 规划重点

1. 从当前强 WorldSpec 继续演进为稳定 World IR；
2. 增加 interaction / rule / acceptance 的正式 contract；
3. non-retriable finding 必须走 **constrained WorldSpec revision / 受约束 WorldSpec 修订**；
4. 修订不能直接 patch Runtime，必须重新进入 canonical pipeline；
5. 为未来局部增量编译预留 revision / provenance。

---

## 6. Core ② — Physical-Semantic Asset Compiler / 物理语义资产编译器

职责：把原始视觉资产变成 Agent 可以真实操作、Runtime 可以验证的 executable entity / 可执行实体。

```text
Raw GLB / 原始 GLB
      │
      ▼
Geometry Inspect / 几何检查
      │
      ▼
Transform Normalize / 坐标规范化
      │
      ▼
Part Segmentation / 部件分割
      │
      ▼
Semantic Evidence / 语义证据
“door leaf?” / “门板？”
      │
      ▼
Physics Inference / 物理推断
mass / friction / 质量 / 摩擦
      │
      ▼
Joint Inference / 关节推断
hinge / slider / 铰链 / 滑轨
      │
      ▼
Collider Build / 碰撞体生成
      │
      ▼
Capability Proposal / 能力提议
OPEN / PICKUP / 打开 / 拿起
      │
      ▼
Admission & Quality Gate / 准入与质量门
      │
      ▼
Executable Manifest / 可执行 Manifest
```

### 当前 AgentScape 映射

- `src/compiler/`
- `src/assets/`
- `services/asset-compiler/`
- Part proposal / segmentation evidence / joint frame
- Part collider / CoACD / materialization / quality gate
- executable promotion / verified admission

### 规划重点

- 自动 Part Segmentation 从协议接入推进到可靠默认 provider；
- 自动 Semantics 继续保持 evidence-first，不把猜测提升为事实；
- Joint / Target inference 需要 conservative confidence gate / 保守置信门；
- Capability 必须由结构、语义、物理条件共同支持；
- Provider 给出的标签只能是 evidence / 证据，不能直接成为 executable truth / 可执行事实。

---

## 7. Core ③ — Interaction & Rule Compiler / 交互与规则编译器

这是目标架构中需要显式补齐的一层。

它回答四个问题：

1. What can this entity do? / 这个实体能做什么？
2. Under what conditions? / 在什么条件下能做？
3. What state changes after execution? / 执行后什么状态改变？
4. What world rules are triggered? / 会触发哪些世界规则？

### 7.1 Capability / 能力层

```text
Door / 门
├─ OPEN / 打开
├─ CLOSE / 关闭
├─ LOCK / 上锁
└─ UNLOCK / 解锁

Drawer / 抽屉
├─ PULL_OPEN / 拉开
└─ PUSH_CLOSE / 推回

Cup / 杯子
├─ PICKUP / 拿起
├─ PLACE / 放下
└─ POUR / 倾倒

Button / 按钮
└─ PRESS / 按下
```

Agent 问的是“目标拥有哪些能力”，而不是“应该写什么 JS”。

### 7.2 Interaction Graph / 交互图

```text
Agent / 智能体
    │ INTERACT / 交互
    ▼
Key / 钥匙
    │ PICKUP / 拿起
    ▼
Inventory State / 持有状态
    │ hasKey=true / 已持有钥匙
    ▼
Cabinet / 柜子
    │ UNLOCK / 解锁
    ▼
locked=false / 已解锁
    │ OPEN / 打开
    ▼
Joint Motion / 关节运动
    │
    ▼
Verify angle / 验证实际角度
```

### 7.3 Rule Engine / 规则引擎

```text
Door Opened / 门已打开
        │ Event / 事件
        ▼
Alarm Armed? / 报警已布防？
        │ Condition / 条件
        ▼ yes / 是
Alarm On / 报警启动
        │ Effect / 效果
        ▼
Verified State / 已验证状态
```

### 当前 AgentScape 映射

已有部分能力散布在：

- `src/skills/`
- Asset Manifest articulation / action descriptors
- Runtime interaction methods
- `src/agent/`
- `src/policy/`

但目前还没有完整独立的“Interaction & Rule Compiler”产品边界。

### 规划重点

- 先定义 contract，再决定是否创建新的 `interaction/`、`rules/` 目录；
- capability、precondition、effect、state transition、acceptance 必须 schema 化；
- LLM 可以生成/修订交互图与规则，但不能执行任意 JS；
- 所有 effect 最终必须通过 Runtime mutation contract；
- 所有 success 最终必须有 verifier / observable post-condition。

---

## 8. Core ④ — World Runtime / 世界运行时

职责：保存 live world truth / 运行时世界事实，并提供渲染、物理、导航、空间与动作执行。

```text
                         WorldRuntime / 世界运行时
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
ObjectStore / 对象库      AssetManager / 资产管理    EventBus / 事件总线
          │
          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Runtime Systems / 运行时系统                                    │
│                                                                  │
│ Physics / 物理       Spatial / 空间       Navigation / 导航      │
│ Locomotion / 移动    Interaction / 交互   State / 状态           │
└──────────┬──────────────────┬───────────────────┬────────────────┘
           │                  │                   │
           ▼                  ▼                   ▼
   Physics Authority    Spatial Facts      Recast/Detour
   物理权威后端          空间事实           导航事实
   (current: Rapier)
   （当前：Rapier）
```

### 当前 AgentScape 映射

- `src/runtime/`
- `src/core/`
- Three.js visual scene
- Rapier physics world
- Recast / Detour navigation
- ObjectStore / AssetManager / SceneGraph
- locomotion / interaction / articulation execution

### 永久约束 / Invariants

- UI 不能成为第二份 world state；
- Agent 不能绕过 Skill/Runtime 直接改 mesh transform；
- Provider 不能直接写 Runtime truth；
- Physics state 必须由被选中的 authoritative physics backend / 权威物理后端维护；
- world mutation 必须满足 atomicity / rollback contract；
- Human 与 Agent 必须操作同一个 Runtime。

### 8.1 Physics Capability Layer / 可替换物理能力层

当前实现直接使用 Rapier，这是 **Current Implementation / 当前实现事实**，不是最终架构中不可替换的永久绑定。目标架构应把 Runtime 对具体 solver 的依赖收敛到一个 Physics Capability Layer / 物理能力层。

```text
Entity Physics Requirement / 实体物理需求
                 │
                 ├─ rigid-body / 刚体
                 ├─ articulated-body / 关节体
                 ├─ character-controller / 角色控制
                 ├─ soft-body / 柔体
                 ├─ cloth / 布料
                 └─ high-fidelity dynamics / 高精度动力学
                 │
                 ▼
        Physics Capability Router
             物理能力路由器
                 │
       ┌─────────┼───────────┐
       ▼         ▼           ▼
    Rapier     Genesis      PhysX / ...
    Rapier     Genesis      PhysX / 其他
       │         │           │
       │         │           └─ advanced simulation / 高级仿真候选
       │         └───────────── soft-body / cloth / 柔体与布料候选
       └─────────────────────── rigid/articulated realtime / 实时刚体与关节体
```

AgentScape 不应该自己重新发明刚体、柔体或高级动力学 solver。它应该拥有：

> **Physics Requirement Compilation + Capability Routing / 物理需求编译与能力路由权。**

即：World IR 描述“这个实体需要什么物理能力”，AgentScape 决定哪个已注册 backend 能满足该 contract，并由该 backend 对其 authority scope / 权威范围内的物理状态负责。

### 8.2 PhysicsRequirement / 物理需求进入 World IR

World IR 不应该硬编码 `engine: rapier`。更稳定的表达是能力需求：

```text
PhysicsRequirement / 物理需求
│
├─ bodyClass / 物体类别
│  ├─ rigid / 刚体
│  ├─ articulated / 关节体
│  ├─ soft / 柔体
│  └─ cloth / 布料
│
├─ requiredCapabilities / 必需能力
│  ├─ collision / 碰撞
│  ├─ joint-limit / 关节限制
│  ├─ contact-query / 接触查询
│  ├─ snapshot-restore / 快照恢复
│  └─ counterfactual-query / 反事实查询
│
├─ executionMode / 执行模式
│  ├─ realtime / 实时
│  └─ validation-only / 仅验证
│
└─ qualityPolicy / 质量策略
   ├─ deterministic-required / 要求确定性
   ├─ realtime-required / 要求实时
   └─ fallback-policy / 降级策略
```

这样，今天可以选择 Rapier，未来可以在不改变 Door / Cloth / Robot 等上层实体语义的前提下增加其他 backend。

### 8.3 Physics Backend Contract / 物理后端契约

每个 backend 至少应该通过统一契约声明，而不是由 Runtime 猜测：

```text
PhysicsBackend / 物理后端
│
├─ identity + version / 身份与版本
├─ capabilities / 能力集合
├─ execution mode / 实时或离线模式
├─ supported shapes / 支持的碰撞形状
├─ supported joints / 支持的关节
├─ query features / 查询能力
├─ snapshot / restore / 快照与恢复
├─ step / execute / 推进与执行
├─ observe / 读取真实状态
└─ authority scope / 真值负责范围
```

Router 只在能力满足、policy 允许、所需验证能力完整时选择 backend；否则必须 fail-closed / 失败关闭，不能因为“有一个近似 solver”就静默降低世界真实性。

### 8.4 Physics Truth / 物理真值必须按 Authority Scope 管理

未来支持多个 backend 后，不能出现“两套 solver 都说自己是真值”。

```text
WorldRuntime / 世界运行时
        │
        ▼
Physics Capability Router / 物理能力路由器
        │
        ├─ Domain A / 物理域 A ──► Rapier
        │                            └─ authoritative / 权威
        │
        └─ Domain B / 物理域 B ──► Soft-body Backend / 柔体后端
                                     └─ authoritative / 权威
```

规则：

- 一个 physics domain / 物理域同一时刻只能有一个 authoritative backend；
- Renderer 只展示 backend 的结果，不能反向成为 physics truth；
- Validator 可以调用更高精度 backend 做独立证据，但 validation-only backend 不自动接管 live truth；
- backend 切换必须经过 snapshot/export → import/admission → verification，不能热切换后假装状态连续；
- backend 失败时，只有显式 fallback policy 才允许降级。

### 8.5 Cross-backend Coupling / 跨后端耦合

“Rapier 刚体 + Genesis 柔体”不是把两个 API 同时调用就完成。两种 solver 之间发生接触、力、约束时，需要显式 coupling contract / 耦合契约。

```text
Rigid Domain / 刚体域              Soft Domain / 柔体域
      Rapier                            Genesis-like backend
        │                                      │
        └──────── Coupling Adapter ────────────┘
                  跨后端耦合适配器
                         │
                         ▼
              shared contact/force contract
                共享接触 / 力交换契约
```

在没有经过验证的 Coupling Adapter 之前：

- 不允许声称两个 backend 的实体存在真实双向物理交互；
- 可以选择同一个 backend 统一承载该 coupling group；
- 或者把第二 backend 限定为 validation-only / 离线验证；
- 或者明确使用 proxy / 代理近似，并把结果标为 provisional / 临时，而不是 verified。

### 8.6 Runtime Backend 与 Validation Backend 要区分

未来的 Genesis、PhysX 或其他 solver 不一定都适合作为浏览器逐帧 Runtime backend。AgentScape 应区分两种角色：

```text
                    Physics Capability / 物理能力
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
    Runtime Backend / 实时运行后端   Validation Backend / 验证后端
                │                           │
        frame-by-frame / 逐帧         batch / remote / 高精度
                │                           │
         live world truth              independent evidence
         实时世界真值                  独立验证证据
```

只有真正满足 Runtime latency、snapshot、state sync、query、failure semantics 的 backend，才有资格成为 live authority / 实时权威后端。

### 8.7 迁移顺序 / Migration Order

物理可替换不能通过一次“大重构”完成。推荐顺序：

```text
P0  Current / 当前
    WorldRuntime → PhysicsSystem → Rapier
                    │
                    ▼
P1  Interface / 接口化
    WorldRuntime → PhysicsBackend Contract → RapierAdapter
                    │
                    ▼
P2  Capability Routing / 能力路由
    PhysicsRequirement → PhysicsCapabilityRouter → RapierAdapter
                    │
                    ▼
P3  Validation Backend / 外部验证后端
    Router ──► Rapier realtime / 实时
           └─► high-fidelity validator / 高精度验证
                    │
                    ▼
P4  Multi-backend / 多后端
    只有 Coupling + Snapshot + Verification contract 全部通过后才进入
```

第一步必须保持行为等价：**先把 Rapier 包进稳定接口，不同时改变物理行为。**

### 8.8 当前代码债 / Current Coupling Debt

当前 Rapier 绑定不只在 `PhysicsSystem` 本身。现有代码中，Runtime recovery / Navigation 等路径也存在 Rapier-specific assumptions / Rapier 特定假设。因此物理抽象 Gate 必须先扫描并收敛这些依赖，而不是只把 `import RAPIER` 移到另一个文件。

目标不是“为了抽象而抽象”，而是确保以后新增柔体、高精度验证或其他 solver 时，不需要重写 Agent、World IR、Interaction、Verification 的上层语义。

---

## 9. Core ⑤ — Verification & Repair / 验证与修复

职责：把“模型说成功”变成“系统证明成功”。

```text
Requested Action / 请求动作
          │
          ▼
Precondition Check / 前置条件检查
          │
          ▼
Execution / 执行
          │
          ├─ progress / 进展
          ├─ contact / 接触
          ├─ stall / 停滞
          └─ timeout / 超时
          │
          ▼
Observation / 真实观测
          │
          ▼
Verification / 验证
      ┌───┴──────────────────┐
      ▼                      ▼
VERIFIED / 已验证       FAILED / 失败
                             │
                             ▼
                 Failure Attribution / 失败归因
                             │
                ┌────────────┼────────────┐
                ▼            ▼            ▼
          blocker / 阻挡  geometry / 几何  rule / 规则
                │            │            │
                └────────────┼────────────┘
                             ▼
                    Repair Proposal / 修复提议
                             │
                             ▼
                    Canonical Re-run / 标准重跑
```

### 当前 AgentScape 映射

已有成熟基础：

- ArticulationVerifier
- WorldValidator
- failure attribution
- verified recovery
- counterfactual physics geometry
- recovery ranking / cleanup
- generated-world admission / validation

### 规划重点

- 统一几何 / 物理 / 交互 / 规则 / 任务五类 verifier contract；
- finding 必须带 provenance / 来源与 evidence / 证据；
- 失败优先局部归因、局部修复，不默认重生成整个世界；
- generated-world finding 应转成 constrained IR revision，而不是直接 patch live world；
- acceptance criteria 逐步从隐式 verifier 变为 World IR 的一等公民。

---

## 10. AI 与确定性系统的边界 / AI vs Deterministic Boundary

这是 AgentScape 最重要的工程边界。

```text
┌────────────────────────────────┐   ┌────────────────────────────────┐
│ AI / 智能推理                  │   │ Deterministic System / 确定系统│
├────────────────────────────────┤   ├────────────────────────────────┤
│ Intent / 理解意图              │   │ Collision / 碰撞               │
│ Planning / 规划                │   │ Physics / 物理                 │
│ Semantics / 语义               │   │ Joint solve / 关节求解         │
│ Inference / 推断               │   │ Navigation geometry / 导航几何 │
│ Proposal / 提议                │   │ State mutation / 状态修改      │
│ Rule design / 规则设计         │   │ Execution / 执行               │
│ Repair suggestion / 修复建议   │   │ Verification / 验证            │
└────────────────────────────────┘   └────────────────────────────────┘
                 │                                   ▲
                 └──── proposal / 提议 ──────────────┤
                                                     │
                 ┌──── evidence / 证据 ◄─────────────┘
                 ▼
         AI revises / AI 修订
```

永远保持：

> **Inference is not truth; execution evidence is truth. / 推断不是事实，执行证据才是事实。**

---

## 11. Support Plane / 支撑层

五大核心之外，当前仓库已有若干重要支撑系统。它们不应被误写成第六、第七套 world truth。

```text
┌────────────────────────────────────────────────────────────────────┐
│ Support Plane / 支撑层                                             │
├────────────────────────────────────────────────────────────────────┤
│ Provider & Connector / 外部能力接入                                │
│ Artifact & Job Infrastructure / 资产与异步任务基础设施             │
│ Persistence & History / 持久化与历史                               │
│ Human Editor / 人类编辑器                                          │
│ Environment Content / 环境内容                                     │
│ Policy & Trace / 权限与审计                                        │
└───────────────────────────────┬────────────────────────────────────┘
                                │ serves / 服务
                                ▼
                   Five Core Systems / 五大核心系统
```

### 11.1 Provider / Connector

```text
Asset Request / 资产请求
       │
       ├──────────────┬─────────────────┐
       ▼              ▼                 ▼
Asset Library     AI Generator      Procedural Generator
资产库            AI 生成器          程序生成器
                      │
          ┌───────────┼────────────┐
          ▼           ▼            ▼
     EmbodiedGen   Hunyuan3D    TRELLIS / ...
          │           │            │
          └───────────┼────────────┘
                      ▼
              Raw Artifact / 原始资产
                      │
                      ▼
       AgentScape Asset Compiler / 资产编译器
```

Provider 是 evidence / artifact provider，不是 World Truth owner。

### 11.2 Human + Agent 同一世界

```text
Human Editor / 人类编辑器 ──┐
                             ├──► WorldRuntime / 同一世界运行时
Agent / 智能体 ──────────────┘
                                  │
                  ┌───────────────┼────────────────┐
                  ▼               ▼                ▼
           History / 历史   Persistence / 持久化   Trace / 审计
```

---

## 12. 当前代码如何映射到目标架构

目标架构不要求立刻大规模搬目录。先稳定 contract，再做物理目录整理。

| Target / 目标模块 | 当前主要实现位置 | 当前判断 |
|---|---|---|
| World Planner / 世界规划器 | `src/pipeline/`, `src/agent/`, `src/validation/` | 已有 WorldSpec + canonical pipeline，下一步是 constrained revision 与更完整 IR |
| Asset Compiler / 资产编译器 | `src/compiler/`, `src/assets/`, `services/asset-compiler/` | 主链成熟；自动 segmentation/semantics/joint inference 仍是明显缺口 |
| Interaction & Rule Compiler / 交互与规则编译器 | `src/skills/`, manifests, runtime interaction, policy | 能力已有，但 contract 分散；这是目标架构需要显式补齐的一层 |
| World Runtime / 世界运行时 | `src/runtime/`, `src/core/` | 当前最成熟的事实层之一 |
| Physics Capability Layer / 物理能力层 | 当前主要在 `src/runtime/systems/PhysicsSystem.js`，且 Recovery/Navigation 仍有 Rapier-specific coupling | 当前默认 Rapier；目标先做 PhysicsBackend contract + Rapier parity adapter，再考虑 validation/multi-backend |
| Verification & Repair / 验证与修复 | `src/validation/` + verifier/recovery runtime code | 已有强执行验证链；需要统一到世界级 acceptance / finding contract |
| Provider Infrastructure / Provider 基础设施 | `src/providers/`, `src/connector/`, `src/generation/`, `src/jobs/`, `src/artifacts/` | 作为支撑层继续 provider-neutral |
| Human/Persistence / 人类编辑与持久化 | `src/editor/`, `src/persistence/`, `src/history/` | 保持同一 Runtime truth，不发展第二状态系统 |
| Environment / 内容环境 | `src/content/` | 作为 world pack / benchmark / demo 服务核心系统 |

---

## 13. 多 AI 并行开发规划 / Multi-AI Workstreams

可行，但必须按 **Architecture Ownership / 架构所有权** 分，而不是按“谁看到哪个文件就改哪个文件”分。

推荐：**7 个领域 AI + 1 个 Integration Guardian / 集成守门 AI**。

```text
                              ┌─────────────────────────────┐
                              │ AI-8 Integration Guardian  │
                              │ 集成 / 契约 / 架构守门     │
                              └──────────────┬──────────────┘
                                             │
       ┌──────────────────┬──────────────────┼───────────────────┐
       │                  │                  │                   │
       ▼                  ▼                  ▼                   ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ AI-1 Planner  │  │ AI-2 Assets   │  │ AI-3 Behavior │  │ AI-4 Runtime  │
│ 世界规划/IR   │  │ 资产编译      │  │ 交互与规则    │  │ 世界运行时    │
└───────┬───────┘  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘
        │                  │                  │                  │
        └──────────────────┴─────────┬────────┴──────────────────┘
                                     │ contracts / 契约
                                     ▼
                         ┌────────────────────────┐
                         │ AI-5 Verification      │
                         │ 验证 / 归因 / 修复     │
                         └───────────┬────────────┘
                                     │
                          ┌──────────┴──────────┐
                          ▼                     ▼
                 ┌────────────────┐    ┌────────────────────┐
                 │ AI-6 Provider  │    │ AI-7 Human/World   │
                 │ 生成/Connector │    │ 编辑器/持久化/内容 │
                 └────────────────┘    └────────────────────┘
```

### AI-1 — World Planner & IR / 世界规划与 IR

Ownership：

- WorldSpec / future World IR schema
- planning output contract
- revision / provenance
- generated-world canonical planning path

不拥有：Runtime mutation semantics、physics truth。

### AI-2 — Asset Compiler / 资产编译

Ownership：

- Asset Manifest schema
- segmentation / semantic evidence
- joint / collider / materialization
- asset quality / admission

不拥有：Provider truth、Runtime success semantics。

### AI-3 — Interaction & Rules / 交互与规则

Ownership：

- capability contract
- precondition / effect / state-transition schema
- interaction graph
- world rule representation

不拥有：底层 Physics solver、最终 verifier verdict。

### AI-4 — Runtime / 运行时

Ownership：

- `WorldRuntime`
- ObjectStore / physics / navigation / spatial
- live mutation transaction
- Runtime state ownership

这是最严格的 single-owner domain / 单一所有权领域。

### AI-5 — Verification & Repair / 验证与修复

Ownership：

- verifier semantics
- evidence / finding schema
- failure attribution
- recovery eligibility / ranking
- world acceptance semantics

不拥有：直接重写 WorldSpec 或 Asset Manifest 的权力；只能产生 finding / repair proposal。

### AI-6 — Provider / Generation Infrastructure / 外部生成基础设施

Ownership：

- Connector protocol
- Provider registry / capability metadata
- GenerationOrchestrator / Job Center
- artifact transport / ingestion

原则：Provider output 永远是 artifact/evidence/proposal。

### AI-7 — Human Editor / Persistence / Environments / 人类编辑与内容

Ownership：

- editor UX
- SceneSerializer / persistence schema
- history / undo-redo integration
- environment packs / demos / benchmarks

原则：UI 不复制 Runtime state。

### AI-8 — Integration Guardian / 集成守门

Ownership：

- cross-module contracts
- architecture invariants
- integration tests / E2E gates
- merge sequencing
- migration review

AI-8 默认不“拥有更多功能”，它拥有的是 **拒绝破坏边界的权力**。

---

## 14. Single Owner Contracts / 单一所有者契约

多个 AI 并行时，下列契约不能多人自由修改：

```text
World IR / WorldSpec schema
        └── AI-1 owner / 所有者

Asset Manifest schema
        └── AI-2 owner / 所有者

Capability / Rule contract
        └── AI-3 owner / 所有者

WorldRuntime mutation contract
        └── AI-4 owner / 所有者

Verification / Finding semantics
        └── AI-5 owner / 所有者

Connector protocol
        └── AI-6 owner / 所有者

Scene persistence schema
        └── AI-7 owner / 所有者

Cross-contract compatibility
        └── AI-8 gate / 守门
```

跨域修改流程：

```text
Consumer AI / 使用方 AI
        │
        ▼
Contract Change Proposal / 契约修改提案
        │
        ▼
Owner AI / 所有者 AI
        │
        ▼
Compatibility Tests / 兼容测试
        │
        ▼
AI-8 Integration Gate / 集成门
        │
        ▼
Merge / 合并
```

禁止：

- Agent 层私存一份 object truth；
- World Planner 自己实现 placement physics；
- Provider 把 semantic label 直接提升成 verified capability；
- Editor 直接绕过 Runtime mutation；
- verifier 为了“修复”直接改 live world 而不走正式 mutation / pipeline。

---

## 15. 重规划后的路线 / Replanned Roadmap

这里不再把未来拆成零散 feature list，而是沿“世界编译链”推进。

### Phase A — World IR 收敛 / World IR Convergence

目标：让 WorldSpec 从 generated-world input 稳定演进成五大核心共享的规划契约。

```text
Current WorldSpec / 当前 WorldSpec
          │
          ├─ stronger entity contract / 更强实体契约
          ├─ acceptance / 验收条件
          ├─ interaction intent / 交互意图
          ├─ rule intent / 规则意图
          ├─ provenance / 来源
          └─ revision identity / 修订身份
          │
          ▼
World IR vNext / 下一代世界中间表示
```

近期优先：

1. non-retriable finding → constrained WorldSpec revision；
2. exact-plan gate 扩展到 changed-plan / bounded revision gate；
3. acceptance criteria contract；
4. global spatial constraints 的表达和 deterministic validation。

### Phase B — Interaction & Rule Contract / 交互与规则契约

目标：把当前散布在 Manifest / Skill / Runtime 中的行为语义整理成可编译 contract。

```text
Capability / 能力
      +
Precondition / 前置条件
      +
Effect / 效果
      +
State Transition / 状态迁移
      +
Verifier / 验证器
      ↓
Executable Interaction / 可执行交互
```

先 contract，后目录重构。

### Phase C — Semantic Asset Automation / 语义资产自动化

目标：提升普通 GLB → executable entity 的自动 coverage，但继续保守准入。

优先顺序：

```text
Segmentation / 部件分割
        ↓
Semantic Evidence / 语义证据
        ↓
Joint Proposal / 关节提议
        ↓
Capability Proposal / 能力提议
        ↓
Physical Verification / 物理验证
        ↓
Executable Promotion / 可执行提升
```

### Phase D — World-level Verification / 世界级验证

目标：从“动作 verified”扩展到“用户要求的整个世界 verified”。

```text
Geometry / 几何
   + Physics / 物理
   + Interaction / 交互
   + Rules / 规则
   + Task Acceptance / 任务验收
              ↓
        World Verdict / 世界判定
```

### Phase E — Local Repair & Incremental Recompile / 局部修复与增量重编译

目标：失败时不重做整个世界，只重编译受到影响的 IR 子图。

```text
Finding / 问题
    ↓
Root Cause / 根因
    ↓
Affected IR Nodes / 受影响 IR 节点
    ↓
Bounded Revision / 有界修订
    ↓
Incremental Recompile / 增量重编译
    ↓
Re-verify / 再验证
```

### Phase F — Scale & Rich Physics / 大世界与丰富物理

在核心编译链稳定之后再扩大：

- large-world streaming / 大世界流式加载；
- dynamic replanning / 动态重规划；
- multi-agent avoidance / 多智能体避障；
- IK / grasp force / payload limits / 操作与抓取；
- physics backend abstraction / 物理后端抽象；
- soft-body provider / 柔体后端。

这些是 Runtime 能力扩张，不应提前破坏 World IR 与 verification contract。

---

## 16. 当前完成度应该怎样理解

`status-and-roadmap.md` 中约 91% 的数字，仍然只表示当前定义下：

> **“普通 GLB → 可信 Agent World + 当前 generated-world vertical slice”** 的成熟度粗估。

它不表示本文的最终使命已经完成 91%。

按照新的目标架构观察：

```text
Current Strength / 当前强项
────────────────────────────────────
World Runtime / 世界运行时                 █████████░
Action Verification / 动作验证             ██████████
Asset Compiler Foundation / 资产编译基础    █████████░
Generated-world Pipeline / 生成世界管线     ████████░░

Major Expansion Areas / 主要扩展区
────────────────────────────────────
World IR as full contract / 完整世界 IR     ██████░░░░
Interaction Compiler / 交互编译器           ████░░░░░░
Rule Compiler / 规则编译器                  ██░░░░░░░░
Auto Semantics / 自动语义                   ███░░░░░░░
Joint Inference / 自动关节推断              ███░░░░░░░
World-level Acceptance / 世界级验收         █████░░░░░
Incremental Repair / 增量修复               ███░░░░░░░
```

这些条形是架构方向示意，不替代 `status-and-roadmap.md` 的可证据成熟度表。

---

## 17. 最终生命周期 / World Lifecycle

```text
User Intent / 用户意图
        ↓
PLANNING / 规划中
        ↓
World IR Ready / 世界描述已生成
        ↓
ASSET COMPILING / 资产编译中
        ↓
BEHAVIOR COMPILING / 行为编译中
        ↓
WORLD BUILDING / 世界构建中
        ↓
VALIDATING / 验证中
        ↓
┌───────────────────────────┐
│                           │
▼                           ▼
PASS / 通过              FAIL / 失败
│                           │
│                    Attribution / 归因
│                           │
│                    Local Repair / 局部修复
│                           │
│                    Recompile / 重编译
│                           │
└───────────────┬───────────┘
                ▼
READY / 世界已就绪
```

只有通过 validation / 验证，才能把世界提升为 READY / 已就绪。

---

## 18. 最终上帝视角 / Final System View

```text
                                      User / 用户
                                          │
                                  Intent / 世界意图
                                          ▼
                              ┌─────────────────────┐
                              │ World Planner       │
                              │ 世界规划器          │
                              └──────────┬──────────┘
                                         │
                                  World IR / 世界 IR
                                         │
                  ┌──────────────────────┼──────────────────────┐
                  │                      │                      │
                  ▼                      ▼                      ▼
       ┌──────────────────┐   ┌────────────────────┐   ┌──────────────────┐
       │ Asset Compiler   │   │ Interaction & Rule │   │ Provider Support │
       │ 资产编译器       │   │ 交互与规则编译器   │   │ 外部生成支撑     │
       └────────┬─────────┘   └──────────┬─────────┘   └────────┬─────────┘
                │                        │                      │
                └────────────────────────┼──────────────────────┘
                                         ▼
                                ┌───────────────────┐
                                │ World Compiler    │
                                │ 世界编译链        │
                                └─────────┬─────────┘
                                          │
                                          ▼
                                ┌───────────────────┐
                 Human / 人类 ─►│ WorldRuntime      │◄─ Agent / 智能体
                                │ 世界运行时        │
                                └─────────┬─────────┘
                                          │
             ┌────────────────────────────┼────────────────────────────┐
             │                            │                            │
             ▼                            ▼                            ▼
      Physics / 物理              Navigation / 导航            Interaction / 交互
             │                            │                            │
             └────────────────────────────┼────────────────────────────┘
                                          ▼
                                ┌───────────────────┐
                                │ Verification      │
                                │ 验证与判定        │
                                └─────────┬─────────┘
                                          │
                              ┌───────────┴────────────┐
                              ▼                        ▼
                       VERIFIED / 已验证           FAILED / 失败
                                                       │
                                                       ▼
                                                Repair / 修复
                                                       │
                                                       ▼
                                          constrained revision
                                                 受约束修订
                                                       │
                                                       └──► World IR
```

---

## 19. 最终验收场景 / North-star Scenario

AgentScape 的 north-star / 北极星验收，不应该是“页面能显示一个漂亮场景”，而应该是完整世界任务：

```text
User / 用户：
“生成一个废弃实验室。
里面有一张桌子、一个可打开的柜子，
柜子里放一个红色盒子。
然后进去把盒子拿出来放到桌上。”

Prompt / 提示
   ↓
World IR / 世界中间表示
   ↓
Search or Generate Assets / 搜索或生成资产
   ↓
Compile Assets / 编译资产
   ↓
Compile Interactions & Rules / 编译交互与规则
   ↓
Compose Layout / 编排布局
   ↓
Physics Admission / 物理准入
   ↓
Spawn Runtime / 创建运行时世界
   ↓
Navigate / 导航
   ↓
Open Cabinet / 打开柜子
   ↓
Verify Joint / 验证关节
   ↓
Pickup Box / 拿起盒子
   ↓
Verify Hold / 验证持有
   ↓
Navigate to Table / 移动到桌边
   ↓
Place Box / 放置盒子
   ↓
Settle Physics / 等待物理稳定
   ↓
Verify Support Relation / 验证支撑关系
   ↓
VERIFIED TASK COMPLETE / 任务已真实验证完成
```

整个流程中，没有关键事实依赖 LLM 自己声明“成功”。

这就是 AgentScape 的最终使命：

> **把“我想要一个怎样的世界”，变成“系统能够证明这个世界真实可运行”。**
