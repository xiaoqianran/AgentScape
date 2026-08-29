# AgentScape 文档导航

AgentScape 的文档分成三层：**先理解为什么，再理解现在是什么，最后查协议细节。**

如果第一次阅读，不建议从 500 多行的 Asset Compiler 协议开始。推荐顺序如下。

## 1. 学习主线

### [`mission-and-system-plan.md`](./mission-and-system-plan.md) — 最终使命、目标架构与多 AI 分工

回答：

- AgentScape 最终要成为什么？
- 为什么核心是“世界编译权”，而不是让 LLM 直接控制 Three.js？
- World IR、资产、交互规则、Runtime、验证修复如何形成完整编译链？
- 如果多个 AI 并行开发，怎样按 Architecture Ownership 分工而不制造多套 Truth？

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

## 2. 当前仓库与 Provider 边界

- [`repository-layout.md`](./repository-layout.md)：当前根目录、产品系统、Observatory Developer Surface、真实工程边界与禁止回退规则。
- [`observatory.md`](./observatory.md)：Developer Runtime Observatory：Physics/Spatial 单步、replay、backend comparison 与 debug contract。
- [`world-viability.md`](./world-viability.md)：产品级 World Viability Gate：INSIDE cabinet → OPEN → PICKUP → CARRY → PLACE → Acceptance → Restore。
- [`multi-repository-architecture.md`](./multi-repository-architecture.md)：当前已收敛的 `AgentScape + modal-provider` 仓库边界。
- [`provider-integration-plan.md`](./provider-integration-plan.md)：Provider contract、2D→3D 主链、Gateway 与 EmbodiedGen ownership。
- [`repository-baseline.md`](./repository-baseline.md)：2026-08-29 当前仓库基线与已退役 standalone inventory。

## 3. 当前协议与实现文档

- [`navigation.md`](./navigation.md)：1.10 Current-world Navigation Truth：Recast/Detour、TileCache、Rapier 动态障碍与查询时同步。
- [`action-aware-navigation.md`](./action-aware-navigation.md)：1.14 单动作反事实诊断：blocker provenance、verified action eligibility 与动作后重规划。
- [`locomotion.md`](./locomotion.md)：1.15 Embodied Locomotion：Agent Body、Rapier CharacterController、跨帧 History 与 blocked 执行语义。
- [`interaction-range.md`](./interaction-range.md)：1.16 Embodied Interaction：固定交互距离、Rapier LOS、可达交互位与 articulation action sweep。
- [`agent-carry.md`](./agent-carry.md)：1.17 Agent Carry：Hold Anchor、heldBy ownership、pickup transfer shape cast 与携带碰撞。
- [`agent-place.md`](./agent-place.md)：1.18 Agent-held Place：carry-aware release pose、三段 shape-cast transfer、Dynamic settle 与 support post-condition。
- [`live-articulation.md`](./live-articulation.md)：1.19 Live Articulation Completion：joint coordinate、STALL/TIMEOUT、requested-vs-verified state 与 motor finalization。
- [`verified-task-sequencing.md`](./verified-task-sequencing.md)：1.20 Verified Multi-step Task Sequencing：mutation barrier、semantic outcome、unresolved ledger、真实 open→pickup→place E2E。
- [`task-observation.md`](./task-observation.md)：1.21 Compact Task Observation：relevant-world evidence、provisional recovery hints、bounded recovery context。
- [`failure-attribution.md`](./failure-attribution.md)：1.22 Failure Attribution：Rapier active contact、collider provenance 与 non-causal blocker candidates。
- [`verified-recovery.md`](./verified-recovery.md)：1.23 Verified Recovery：Policy/capability preflight、auxiliary blocker pickup 与原任务 retry verification。
- [`recovery-ranking.md`](./recovery-ranking.md)：1.24 Multi-candidate Recovery：typed eligibility、current-contact aggregation 与 non-causal route-cost ranking。
- [`recovery-cleanup.md`](./recovery-cleanup.md)：1.25 Verified Recovery Cleanup：world-space release、shared transfer/settle 与 hands-full recovery continuation。
- [`articulated-recovery.md`](./articulated-recovery.md)：1.26 Articulated Blocker Recovery：verified Part state、unique alternate action 与 auxiliary articulated recovery。
- [`counterfactual-articulated-recovery.md`](./counterfactual-articulated-recovery.md)：1.27 Counterfactual Articulated Recovery：multi-action Three-AABB evidence、tie refusal 与 execution-time rerank。
- [`physics-counterfactual-geometry.md`](./physics-counterfactual-geometry.md)：1.28 Physics-backed Counterfactual：hypothetical Rapier shape-pairs、Physics-first ranking 与 explicit Three fallback。
- [`counterfactual-calibration.md`](./counterfactual-calibration.md)：1.29 Counterfactual Calibration：non-zero childAnchor、adaptive sampling、prismatic coverage 与 observed contact consistency。
- [`counterfactual-convergence.md`](./counterfactual-convergence.md)：1.30 Counterfactual Convergence：denser resampling gate、nested parent-frame validation 与 explicit frame assumptions。
- [`third-object-counterfactual.md`](./third-object-counterfactual.md)：1.31 Third-object Coverage：Rapier world-query、introduced collision hard veto 与 execution-time revalidation。
- [`generated-world-admission.md`](./generated-world-admission.md)：Generated World canonical admission：WorldIR、GenerationRuntime、Asset/World admission 与 rollback。
- [`deterministic-world-composer.md`](./deterministic-world-composer.md)：1.33 Deterministic World Composer：strong WorldSpec、auto layout、Rapier preflight 与 Runtime-derived NEAR。
- [`bounded-world-regeneration.md`](./bounded-world-regeneration.md)：1.34 Bounded World Regeneration：missing-asset-only retry、fixed attempt budget 与 exact-plan duplicate gate。
- [`asset-sourcing.md`](./asset-sourcing.md)：Curated scene packs 的素材来源、许可、风格与 Web 资源准入。
- [`worlds.md`](./worlds.md)：WORLD 01/02、Environment Catalog、世界切换、存档隔离与场景真值。
- [`asset-compiler.md`](./asset-compiler.md)：Agent-Ready Asset Compiler 的完整契约。
- [`generation-runtime.md`](./generation-runtime.md)：唯一生成控制面：Connector capability / Job / Artifact → Asset publication。
- [`llm-gateway.md`](./llm-gateway.md)：LLM Tool Calling Gateway。
- [`test-agent.md`](./test-agent.md)：1.15.1 本地 OpenAI-compatible 测试 Agent、Secret 边界、tool-call history 与 live probe。

服务端补充：

- [`../services/asset-compiler/README.md`](../services/asset-compiler/README.md)：FastAPI / trimesh / CoACD / URDF / multipart heavy geometry。

## 4. 研究记录

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
