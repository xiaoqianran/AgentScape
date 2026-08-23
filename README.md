# AgentScape

> **为 AI Agent 构建可交互的浏览器 3D 世界。**

AgentScape 是一个以 GLB 为核心、运行在浏览器中的空间 Agent Runtime。它把 Three.js、Rapier、空间语义、Agent Skill、资产编译和世界持久化放在同一条稳定边界后面，使人类编辑器和 AI Agent 操作同一个真实世界状态。

## 项目目标

AgentScape 不训练新的 3D 基础模型，也不重新实现 Isaac Sim、MuJoCo 或 EmbodiedGen。重型生成、语义理解和几何处理作为上游后端；AgentScape 负责把结果编译成浏览器中可理解、可操作、可验证的 Agent Asset。

```text
GLB / 生成资产 / 外部数据
          ↓
 Agent-Ready Asset Compiler
          ↓
      Asset Manifest
          ↓
 Three.js + Rapier Runtime
          ↓
 Spatial / Semantic World
          ↓
       SkillRegistry
          ↓
 Human / LLM / future MCP
```

## 当前能力

- Three.js Web3D 运行时与 Rapier 物理，具备明确的对象资源生命周期与失败回滚。
- GLB 加载、节点校验、关节和物理电机。
- 可视化编辑：选择、移动、旋转、复制、删除。
- 空间查询：Bounds、Raycast、Nearby、碰撞、支撑面、空位搜索；1.9 建立 Recast/Detour NavMesh，1.10 再用 TileCache 从当前 Rapier collider 同步动态障碍，`canReach / findPath / path cost` 现在反映当前物理世界。
- 语义 Scene Graph：`ON / SUPPORTS / NEAR / INSIDE / CONTAINS`，采用 dirty + 按需刷新，批量变更合并重建。
- Skill Registry：能力定义、参数 Schema、权限、执行和审计使用同一事实源。
- Tool-calling Agent：支持多轮 plan → act → observe。
- 原子批处理、Undo/Redo、Autosave、场景导入导出。
- World Validator 与受保护的自动修复。
- Asset Library、资产生成 Gateway、EmbodiedGen Adapter。
- Agent-Ready Asset Compiler：glTF 检查、保守坐标规范化、几何分析、浏览器资源预算、语义/关节候选、碰撞代理、优化、持久化与 `ready / provisional / rejected` 编译质量门。
- 可执行 Part / Joint 契约与隔离 Rapier Motion Sweep Verifier：按 target 执行完整轨迹，检查碰撞穿透回归、停滞、limits、post-condition 与 open→close 可逆性，只有通过才可从 `provisional` 晋升。
- Provider-neutral `Part Proposal v1` 与 URDF Adapter：可信机械结构可进入 Compiler，但缺少 collider/action/target 时不会被误提升为 Runtime 能力。
- `Segmentation Evidence v1`、安全 `SegmentMaterializePass` 与保守 `JointFramePass`：完整 TRIANGLES 分割可转换成稳定 GLB Part Nodes；复杂分割仍保持证据身份，URDF frame 只有在原始 GLB 零位姿可证明一致时才自动编译 Rapier anchors。
- Part-level Collider Compiler：按最近 executable Part 重新分配 Mesh 碰撞所有权，自动生成可追踪的 local AABB fallback；Root 不再重复包含可动 Part，Provider 的高质量 Part collider 优先保留。
- Per-Part Heavy Geometry：materialized GLB 可通过 multipart 上传给可选 Compiler 服务，按 Part-local Mesh 运行 trimesh + CoACD，并用通过 Schema 校验的 convex hull 升级 coarse Part collider。
- 可选 CoACD 后端生成凸分解碰撞体。

## 核心设计原则

**单一事实源。** Skill 的名称、描述、参数 Schema、权限和 Handler 只在 Skill Registry 注册一次；LLM 工具定义和 AgentTools 都由 Registry 导出。

**Runtime 是权威状态。** 编辑器和 Agent 不维护第二份场景模型，都通过同一个 WorldRuntime 修改世界。对象生成后立即刷新 Scene Graph。

**资产 ID 是稳定身份。** 同一 ID 重复注册相同 Manifest 是幂等操作；同一 ID 对应不同内容会明确报冲突，除非调用方显式要求替换。

**资产生成与运行时解耦。** Hunyuan3D、TRELLIS、EmbodiedGen 等可以作为上游后端，但运行时只消费标准化 Manifest 和 GLB。

**先确定性检查，再使用模型。** Bounds、碰撞、支撑、GLB 结构等能用几何方法解决的问题不交给 LLM。

**重型能力可替换。** CoACD、VLM 语义和关节推断通过 Provider 接口接入，浏览器始终保留明确的轻量 fallback。

## 快速开始

需要 Node.js 20。

```bash
npm install
npm run dev
```

完整检查：

```bash
npm run check
```

它依次执行 GLB 资产校验、Vitest 和生产构建。

## Asset Compiler

页面可直接上传 `.glb` 或提供 GLB URL。Compiler 流水线为：

```text
Inspect
  ↓
Geometry
  ↓
Semantic heuristic
  ↓
Articulation candidates
  ↓
Collider fallback / remote enrichment
  ↓
Optimize
  ↓
Manifest
  ↓
IndexedDB
```

详见 [`docs/asset-compiler.md`](docs/asset-compiler.md)。

## 外部 Gateway

GitHub Pages 是静态前端，因此模型密钥和重型服务凭据不应存进浏览器。

- LLM Gateway：[`docs/llm-gateway.md`](docs/llm-gateway.md)
- Asset Generator：[`docs/asset-generator.md`](docs/asset-generator.md)
- 重型 Compiler：[`services/asset-compiler/README.md`](services/asset-compiler/README.md)

## Blender / GLB 约定

对于有关节的资产：

- 可动部件应是独立节点。
- 旋转节点的原点应放在真实转轴上。
- 节点名称应稳定，避免导出后随机变化。
- 推荐导出 glTF 2.0 Binary (`.glb`)。
- 行为和物理由 Manifest 描述，GLB 主要负责视觉和层级。

内置 GLB 可运行：

```bash
npm run assets:validate
```

检查 Manifest 所需节点是否真实存在。


## Curated Worlds

Pages 现在有两个共享同一 Runtime 的 curated world：

```text
WORLD 01 · Monument Hall     32 × 24m
WORLD 02 · Ruined Courtyard  36 × 30m
```

Monument Hall 强调恢弘室内秩序；Ruined Courtyard 强调室外残构、高低差、台阶、倒塌柱与自然侵入。两者的建筑体块都同时进入 Three.js / Rapier / Recast。页面顶部 World selector 通过 `?world=` 重载世界，每个世界拥有独立 autosave。

世界架构见 [`docs/worlds.md`](./docs/worlds.md)，素材来源见 [`docs/asset-sourcing.md`](./docs/asset-sourcing.md)。

## 文档学习路径

如果希望从项目最初的设计过程一路理解到当前 1.7.0，建议从 [`docs/README.md`](./docs/README.md) 开始。里面按“演进史 → 当前架构 → 工程研究方法 → 决策与踩坑 → 路线图”组织，而协议细节仍保留在各自文档中。

## 架构研究

当前架构是在实际拉取并用 CodeGraph 阅读多个成熟仓库后收敛的，而不是从空白重新发明：

- EmbodiedGen
- SceneSmith
- Gizmo
- Limina
- Auto-Threejs
- ObjaTHOR
- CoACD
- glTF-Transform
- Articulate-Anything

研究结论见：

- [`docs/research/engine-architecture-study.md`](docs/research/engine-architecture-study.md)
- [`docs/research/asset-compiler-study.md`](docs/research/asset-compiler-study.md)
- [`THIRD_PARTY.md`](THIRD_PARTY.md)

## 当前边界

AgentScape 仍在快速演进。当前不会把启发式语义或节点名关节候选伪装成高置信度 AI 推断；碰撞体没有重型后端时会明确标记为 `aabb-fallback`。这类不确定性必须进入编译报告，而不是被隐藏。
