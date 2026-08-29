# AgentScape

> **把生成式 3D 资产变成可被 LLM 安全操作、可验证的浏览器 3D 世界。**

AgentScape 是一个运行在浏览器中的 **Agent-ready 3D Runtime**。它把 Three.js、Rapier、Recast/Detour、资产 Manifest、空间语义、Skill Registry、验证/修复和 Tool-calling Agent 放在同一条 Runtime 边界后面，让人类编辑器与 AI Agent 操作同一个真实世界状态。

AgentScape **不重造 3D 基础模型或大型仿真平台**。EmbodiedGen、Hunyuan3D、TRELLIS、VLM、CoACD 等能力可以作为上游 Provider；AgentScape 负责把它们的输出编译、准入、放置、验证，并变成真正可执行的 Agent World。

## 当前仓库形态

AgentScape 已经从早期的多仓库拼装架构收敛为两个产品代码边界：

```text
┌─────────────────────────────────────┐
│             AgentScape              │
│ Agent / LLM / VLM / Skills         │
│ Human UI / Runs / Tasks            │
│ Job / Artifact / Asset / World     │
│ Runtime / Physics / Verification   │
└──────────────────┬──────────────────┘
                   │ Capability / Job / Artifact
                   ▼
┌─────────────────────────────────────┐
│           modal-provider            │
│ modal-gen-client                    │
│ modal-2D-client / modal-2D          │
│ modal-3D-client / modal-3D          │
│ modal-EmbodiedGen                   │
└─────────────────────────────────────┘
```

旧的 `AgentScape-agent`、`modal-inference-hub`、各独立 `modal-*` Provider 仓、`kaggle-inference-hub`、`modal-build`、`modal-lab` 与 AgentScape-owned `EmbodiedGen` checkout 都不再是当前仓库边界。Provider 内部仍可按 package/deployment unit 独立测试和部署，但统一归 `modal-provider` monorepo 管理。

详见 [`docs/multi-repository-architecture.md`](docs/multi-repository-architecture.md) 与 [`docs/provider-integration-plan.md`](docs/provider-integration-plan.md)。

## 一眼看懂

```text
Prompt / GLB / EmbodiedGen / External Generator
                       │
                       ▼
               Agent / Asset Gateway
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
        WorldSpec            Asset Manifest
             │                   │
             └─────────┬─────────┘
                       ▼
              Agent-Ready Compiler
                       │
             ready / provisional / rejected
                       │
                       ▼
             Deterministic World Composer
                       │
        Manifest footprint + Rapier preflight
                       │
                       ▼
          Three.js + Rapier + Recast Runtime
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
     Spatial        SceneGraph     SkillRegistry
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                  Tool-calling Agent
                       │
                       ▼
            verified / unverified / failed
```

## 现在已经能做什么

| 能力 | 当前状态 |
| --- | --- |
| 浏览器 3D Runtime | Three.js + Rapier，共享对象生命周期、事务与回滚 |
| Navigation | Recast/Detour NavMesh + Rapier 动态障碍 + Kinematic Character Controller |
| Embodied Interaction | `navigateTo`、`approachAndInteract`、`approachAndPickup`、`approachAndPlace` |
| Articulation | revolute / prismatic joint、live completion、STALL/TIMEOUT、Motion Sweep 验证 |
| Recovery | blocker attribution、pickup/articulated recovery、cleanup、original post-condition retry |
| Counterfactual Safety | Physics-first shape-pair、convergence、third-object / Environment hard veto |
| Generated Assets | Asset Generator Gateway + `EmbodiedGenAdapter` + Manifest admission |
| Generated Worlds | Strong WorldSpec + deterministic auto layout + Rapier pre-spawn preflight + bounded missing-asset regeneration |
| World Admission | asset/layout/relation/validation → `ready / provisional / rejected` |
| Agent Safety | Policy、Trace、mutation barrier、fresh replan、unresolved ledger、deterministic verification |
| Persistence | Scene serialization、Autosave、Undo/Redo、world-specific save |
| Asset Compiler | GLB inspection、Part/Joint、collider、resource budget、quality gate |

版本演进细节不再塞在 README；完整历史见 [`docs/evolution.md`](docs/evolution.md)，当前真实状态见 [`docs/status-and-roadmap.md`](docs/status-and-roadmap.md)。

## EmbodiedGen → AgentScape

AgentScape 已经把 EmbodiedGen 接入默认 generated-asset 主链，而不是仅保留一个孤立 Adapter：

```text
EmbodiedGen raw payload
        │
        ▼
EmbodiedGenAdapter.toManifest(...)
        │
        ▼
validateAssetManifest
        │
        ▼
AssetManager
        │
        ▼
asset admission
ready / provisional / rejected
        │
        ▼
WorldSpec canonical pipeline
        │
        ▼
compose → validate → repair → world admission
```

Adapter fallback collider、Provider semantics 等不确定性会明确保持 `provisional`；Schema 正确也不等于 Runtime 已验证。详见 [`docs/generated-world-admission.md`](docs/generated-world-admission.md) 与 [`docs/deterministic-world-composer.md`](docs/deterministic-world-composer.md)。

## Generated World 主链

自然语言生成世界时，LLM 只负责表达受约束的意图；几何真值仍由 Runtime 决定：

```text
User Prompt
   │
   ▼
ToolCallingAgent
   │
   ├── search / reuse first
   ▼
Strong WorldSpec
   │
   │  没有精确坐标要求 → 不写 position
   ▼
WorldComposer
   │
   ├── Manifest root collider footprint
   ├── Environment layout bounds
   ├── same-batch overlap reservation
   └── Rapier manifestPoseClear
   ▼
instantiate
   │
   ├── ON   → existing placement runtime
   └── NEAR → collider-derived spacing + Physics preflight
   ▼
WorldValidator / RepairEngine
   ▼
world-ready / world-provisional / world-rejected
```

WorldSpec 的未知字段会由 Runtime 自己 deterministic reject；不会依赖模型是否严格遵守 JSON Schema。 Search miss 且 Generator 已配置时，`runWorldPipeline` 还可在同一 mutation 内执行一次固定预算的内部 regeneration retry；详见 [`docs/bounded-world-regeneration.md`](docs/bounded-world-regeneration.md)。

## 核心设计原则

### Runtime 是事实源

编辑器与 Agent 不维护第二份场景模型。ObjectStore、Rapier、Manifest、SceneGraph、SkillRegistry、PolicyEngine 与 TraceRecorder 各自拥有明确职责。

### 确定性验证优先于模型判断

Bounds、碰撞、支撑、关节完成、路径、资源预算等能由 Runtime 验证的事实，不交给 LLM 猜。

### Proposal 不等于 Success

Generated asset、Recovery Hint、Part Proposal、Counterfactual recommendation 都可能只是 `provisional`。只有原始 post-condition 被 Runtime 验证，任务才算完成。

### 生成与运行时解耦

重型生成、VLM、CoACD 等通过 Provider/Gateway 接入。浏览器 Runtime 只消费标准化数据，并保留明确 fallback 与 provenance。

### 失败必须可追踪、可终止

Mutation 后 fresh replan；失败进入 unresolved ledger；Recovery 不能清除原始失败；重复诊断和重复恢复有 deterministic budget/gate。

## 快速开始

需要 Node.js 20+。

```bash
npm install
npm run dev
```

生产级检查：

```bash
npm run check
```

单独检查内置 GLB 与 Manifest 节点一致性：

```bash
npm run assets:validate
```

## 常用开发入口

```text
src/runtime/WorldRuntime.js              Runtime composition root
src/pipeline/createWorldPipeline.js      Generated-world canonical pipeline
src/pipeline/WorldSpec.js                WorldSpec schema + deterministic normalization
src/pipeline/WorldComposer.js            Deterministic placement / relation geometry
src/adapters/EmbodiedGenAdapter.js       EmbodiedGen → AgentScape Manifest
src/assets/library/AssetLibrary.js       Search / reuse / generation admission
src/runtime/systems/PhysicsSystem.js     Rapier truth + hypothetical shape queries
src/skills/registerCoreSkills.js         Agent executable capability registry
src/agent/ToolCallingAgent.js            Plan → act → observe orchestration
```

## Asset Compiler

Agent-Ready Asset Compiler 的目标不是“让 GLB 能显示”，而是把资产变成 Runtime 能安全消费的 Agent Asset：

```text
Inspect
  ↓
Geometry / hierarchy
  ↓
Semantic / Part evidence
  ↓
Articulation candidates
  ↓
Joint frame
  ↓
Root / Part colliders
  ↓
Resource budget / optimization
  ↓
Quality gate
  ↓
ready / provisional / rejected
```

浏览器保留保守 fallback；可选重型 Compiler 服务负责 trimesh / CoACD 等 enrichment。详见 [`docs/asset-compiler.md`](docs/asset-compiler.md) 与 [`services/asset-compiler/README.md`](services/asset-compiler/README.md)。

## Curated Worlds

当前三个 World Pack 共享同一套 Runtime：

| World | 尺度 | 重点 |
| --- | ---: | --- |
| Monument Hall | 32 × 24m | 室内秩序、柱廊、中央 Monument |
| Ruined Courtyard | 36 × 30m | 室外残构、台阶与高低差 |
| Grand Urban Block | 96 × 72m | 城市街区尺度、Instancing、Recast benchmark |

三个世界的建筑体块都进入 Three.js / Rapier / Recast，并提供 deterministic composer layout bounds。页面 World selector 使用独立 autosave，World Pack 通过 dynamic import 只加载当前内容。

详见 [`docs/worlds.md`](docs/worlds.md) 与 [`docs/asset-sourcing.md`](docs/asset-sourcing.md)。

## 外部 Gateway 与凭据

GitHub Pages 是静态前端，模型密钥和重型服务凭据不应提交到浏览器代码或仓库。

- LLM Gateway：[`docs/llm-gateway.md`](docs/llm-gateway.md)
- 本地测试 Agent：[`docs/test-agent.md`](docs/test-agent.md)
- Asset Generator：[`docs/asset-generator.md`](docs/asset-generator.md)
- Heavy Asset Compiler：[`services/asset-compiler/README.md`](services/asset-compiler/README.md)

`.env.local` 只用于本地测试，并应保持 Git ignore 与最小文件权限。

## GLB / Blender 约定

对于有关节资产，可动部件应导出为稳定独立节点；旋转节点原点应放在真实转轴；行为、动作 target 与物理由 Manifest 描述，GLB 主要负责视觉与层级。推荐输出 glTF 2.0 Binary (`.glb`)。

更完整约定与 Compiler 行为见 [`docs/asset-compiler.md`](docs/asset-compiler.md)。

## 文档入口

从 [`docs/README.md`](docs/README.md) 开始最方便。推荐顺序：

```text
mission-and-system-plan
      ↓
status-and-roadmap
      ↓
architecture
      ↓
evolution
      ↓
generated-world-admission
      ↓
deterministic-world-composer
      ↓
verified recovery / counterfactual docs
```

协议细节、测试方法与研究记录都保留在 `docs/`，README 只维护当前系统的入口视图。

## 架构研究

AgentScape 的架构是在实际阅读与对比成熟项目后收敛，而不是从空白重造，包括 EmbodiedGen、SceneSmith、Gizmo、Limina、Auto-Threejs、ObjaTHOR、CoACD、glTF-Transform 与 Articulate-Anything。

研究记录：[`docs/research/engine-architecture-study.md`](docs/research/engine-architecture-study.md)、[`docs/research/asset-compiler-study.md`](docs/research/asset-compiler-study.md)、[`THIRD_PARTY.md`](THIRD_PARTY.md)。

## 当前边界

AgentScape 不把启发式语义、节点名关节候选、Provider affordance、fallback collider 或 LLM 文本当成 verified world truth。Generated-world orchestration 已经能够规范化、准入、确定性布局、验证，并对“search miss + generator available”执行一次 Runtime-owned bounded regeneration；更复杂的 layout/relation/validation 约束修订、全局空间优化与动态第三体未来运动预测仍在继续推进。

## Repository boundary

AgentScape 不再把 Provider 作为 Git submodule 固定在主仓中。当前产品边界是：

```text
AgentScape
   │ provider-neutral Capability / Job / Artifact
   ▼
modal-provider
```

`modal-provider` 内统一维护 `modal-gen-client`、2D/3D Provider 与 Reference Sidecar、以及 `modal-EmbodiedGen` build/runtime integration。它们仍可独立测试和部署，但不是独立系统仓库。

`npm run architecture:validate` 会验证这一点：`sdk/python` 必须由 AgentScape 自己拥有，并拒绝任何 `providers/*` Git submodule。详见 [`docs/multi-repository-architecture.md`](docs/multi-repository-architecture.md) 与 [`docs/provider-integration-plan.md`](docs/provider-integration-plan.md)。
