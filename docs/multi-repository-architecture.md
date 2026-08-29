# Repository architecture convergence

AgentScape 已经结束旧的多 Submodule / 多 Provider 仓库拓扑。当前产品架构只要求理解两个代码仓库：

```text
AgentScape
   │ provider-neutral Capability / Job / Artifact contract
   ▼
modal-provider
```

`AgentScape-plan` 仅维护架构文档，不参与运行时。

## AgentScape

`AgentScape` 现在直接拥有过去分散在 Caller/Client 层的核心能力：

- Agent orchestration、LLM/VLM、Tool Calling、Skills；
- Human task/run/editor UI；
- Connector client、Job projection、ProviderRegistry；
- Artifact admission、Asset Compiler、Asset Repository；
- World Compiler、WorldRuntime、Physics/Nav/Interaction/Verification；
- `sdk/python` 第一方 SDK/CLI。

AgentScape **不再 pin Provider repository 为 Git submodule**。`npm run architecture:validate` 会显式拒绝 `providers/*` submodule，并要求 `sdk/python` 由本仓直接拥有。

## modal-provider

所有 Modal Provider 相关实现统一收敛在一个 monorepo：

```text
modal-provider/
├─ modal-gen-client/      optional local security gateway
├─ modal-2D-client/       image Reference Sidecar
├─ modal-2D/              image generation Provider
├─ modal-3D-client/       3D Reference Sidecar
├─ modal-3D/              3D generation Provider
└─ modal-EmbodiedGen/     EmbodiedGen build/runtime integration
```

这些目录仍可拥有独立 package、lockfile、测试、Modal app 与部署生命周期，但它们不再是 AgentScape 的独立 repository topology。

## Removed standalone boundaries

以下旧仓库名称只应出现在历史/迁移记录中：

```text
AgentScape-agent
modal-inference-hub
modal-gen-client
modal-2D-client
modal-2D
modal-3D-client
modal-3D
kaggle-inference-hub
modal-build
EmbodiedGen standalone checkout
modal-lab
```

Agent/LLM/VLM/Skill 与 Human workflow 已收敛到 AgentScape；Modal Provider/Sidecar/Gateway/Embodied runtime 已收敛到 `modal-provider`；Kaggle 和独立 Lab 不再是目标运行时组件；EmbodiedGen 是 Provider 侧 pin/clone 的外部 upstream。

## Runtime truth

仓库合并不改变领域边界：

```text
Provider execution truth  → modal-provider
Artifact admission        → AgentScape
Asset semantic truth      → AgentScape
World truth/runtime       → AgentScape
```

Provider 结果仍必须经过 AgentScape 的 Job/Artifact/Compiler/Admission 链才能成为可复用 Asset 或进入 World。
