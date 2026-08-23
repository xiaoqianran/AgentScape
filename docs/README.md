# AgentScape 文档导航

AgentScape 的文档分成三层：**先理解为什么，再理解现在是什么，最后查协议细节。**

如果第一次阅读，不建议从 500 多行的 Asset Compiler 协议开始。推荐顺序如下。

## 1. 学习主线

### [`evolution.md`](./evolution.md) — 从第一个 Runtime 到当前版本

回答：

- 项目最初是什么？
- 每一个阶段解决了什么真实问题？
- 哪些早期设计后来被证明不够？
- 为什么最后形成现在的 Runtime / Skill / Compiler / Verifier 架构？

这是理解 AgentScape 最重要的一篇。

### [`architecture.md`](./architecture.md) — 当前系统全景

回答：

- Human、Agent、Runtime、Compiler、Physics 的边界在哪里？
- 哪些是 single source of truth？
- 一次 `open` 动作最终经过哪些模块？
- 一个普通 GLB 如何变成 Agent 可以真实操作的对象？

### [`engineering-method.md`](./engineering-method.md) — 我们如何研究和做工程决策

回答：

- 为什么每次先用 CodeGraph 看调用图？
- 如何挑成熟开源项目作为参照？
- 如何处理许可证？
- 什么情况下复用库，什么情况下只借鉴思想？
- 一个新能力怎样从“想法”走到可以 commit？

### [`decisions-and-lessons.md`](./decisions-and-lessons.md) — 关键决策、踩坑和反例

回答：

- 为什么 SkillRegistry 只能有一个？
- 为什么 inferred articulation 不等于 executable articulation？
- 为什么不能自动 flatten / 猜 axis / 猜 mass？
- 为什么 Provider 失败默认应该降级而不是让编译失败？
- 为什么 whole-asset collider 不能继续用于 articulated Root？
- 为什么“测试绿”还不够，必须跑真实 GLB / Rapier / FastAPI E2E？

### [`status-and-roadmap.md`](./status-and-roadmap.md) — 当前完成度与下一阶段

回答：

- 现在大概做到什么程度？
- 哪些模块已经比较成熟？
- 哪些仍是明显短板？
- 为什么 Motion Sweep、Navigation Truth、Action-aware Diagnosis 与 Embodied Locomotion 按这个顺序演进？

## 2. 当前协议与实现文档

- [`navigation.md`](./navigation.md)：1.10 Current-world Navigation Truth：Recast/Detour、TileCache、Rapier 动态障碍与查询时同步。
- [`action-aware-navigation.md`](./action-aware-navigation.md)：1.14 单动作反事实诊断：blocker provenance、verified action eligibility 与动作后重规划。
- [`locomotion.md`](./locomotion.md)：1.15 Embodied Locomotion：Agent Body、Rapier CharacterController、跨帧 History 与 blocked 执行语义。
- [`interaction-range.md`](./interaction-range.md)：1.16 Embodied Interaction：固定交互距离、Rapier LOS、可达交互位与 articulation action sweep。
- [`agent-carry.md`](./agent-carry.md)：1.17 Agent Carry：Hold Anchor、heldBy ownership、pickup transfer shape cast 与携带碰撞。
- [`agent-place.md`](./agent-place.md)：1.18 Agent-held Place：carry-aware release pose、三段 shape-cast transfer、Dynamic settle 与 support post-condition。
- [`asset-sourcing.md`](./asset-sourcing.md)：Curated scene packs 的素材来源、许可、风格与 Web 资源准入。
- [`worlds.md`](./worlds.md)：WORLD 01/02、Environment Catalog、世界切换、存档隔离与场景真值。
- [`asset-compiler.md`](./asset-compiler.md)：Agent-Ready Asset Compiler 的完整契约。
- [`asset-generator.md`](./asset-generator.md)：可选 Asset Generator Gateway。
- [`llm-gateway.md`](./llm-gateway.md)：LLM Tool Calling Gateway。
- [`test-agent.md`](./test-agent.md)：1.15.1 本地 OpenAI-compatible 测试 Agent、Secret 边界、tool-call history 与 live probe。

服务端补充：

- [`../services/asset-compiler/README.md`](../services/asset-compiler/README.md)：FastAPI / trimesh / CoACD / URDF / multipart heavy geometry。

## 3. 研究记录

这些文档保留“我们参考了什么，以及最终为什么没有照搬”。

- [`research/engine-architecture-study.md`](./research/engine-architecture-study.md)：Gizmo、Limina、SceneSmith 等对 Runtime 架构的影响。
- [`research/asset-compiler-study.md`](./research/asset-compiler-study.md)：ObjaTHOR、glTF-Transform、CoACD、Articulation 等资产编译研究。
- [`research/alternatives-study.md`](./research/alternatives-study.md)：2026-08 对可能替代 AgentScape 的开源项目重新审计。

## 一张图理解整个项目

```text
                        Human Editor
                             │
                             │ same capabilities
                             ▼
LLM / Agent ──────────> SkillRegistry
                             │
                        Policy / Trace
                             │
                             ▼
                       WorldRuntime
             ┌───────────────┼────────────────┐
             ▼               ▼                ▼
         ObjectStore     SpatialSystem    PhysicsSystem
             │               │                │
             └───────────────┼────────────────┘
                             ▼
                       Three.js Scene

普通 GLB
   │
   ▼
AssetCompiler
   │
   ├─ Inspect / Normalize / Budget
   ├─ Segmentation Evidence
   ├─ Part Materialization
   ├─ Part Proposal
   ├─ Joint Frame
   ├─ Part Collider
   ├─ Per-Part CoACD
   └─ Quality Gate
   │
   ▼
Agent-Ready Manifest + optimized GLB
   │
   ▼
AssetManager
   │
   ▼
WorldRuntime / Rapier
   │
   ▼
ArticulationVerifier
```

## 阅读原则

AgentScape 文档会持续区分四种信息，不混写：

```text
Fact        当前 GLB / Runtime 可以确定的事实
Evidence    外部模型、URDF、几何算法提供的证据
Proposal    可能成为能力，但还没有满足执行条件
Executable  Runtime 真能执行、Schema 真能表达的能力
Verified    真正运行过并通过验证的能力
```

如果一个文档看起来把 `Proposal` 写成了 `Verified`，那就是需要修的文档错误，而不是措辞问题。
