# Repository Layout

AgentScape 的目录结构直接表达产品架构。仓库不再使用一个总 `src/` 容器包住所有系统。

## Core product systems

```text
AgentScape/
├─ studio/       Human-facing application, editor, UI, local persistence
├─ agent/        Agent loop, tools, LLM gateway, skills, recovery
├─ generation/   Job / Artifact / Connector / Provider-facing orchestration
├─ asset/        Asset truth, manifests, admission, adapters, compiler
├─ world/        World spec, compiler, runtime, verification, content
└─ core/         Small business-neutral primitives only
```

主要依赖方向：

```text
studio ───────┬────────► agent
              ├────────► generation ─────► asset
              └──────────────────────────► world

agent ────────► generation / asset / world
generation ──► asset
world ────────► narrow Asset contracts

studio / agent / generation / asset / world ──► core
core ──X──► product domains
```

`modal-provider` 不在本仓内；它是 AgentScape 的兄弟仓库。`generation/` 只拥有 provider-neutral consumer/orchestration 语义。

## Repository-level boundaries

以下目录允许保留在根部，因为它们拥有真实的工程或发布边界：

```text
api/           Vercel Functions deployment convention
services/      independently runnable/deployable services
sdk/           externally consumed SDK/release artifacts
tests/         cross-domain integration/regression/e2e tests
tooling/       repository scripts, architecture validators, experiments
docs/          project documentation
public/        Vite static public assets
```

`api/_server/` 是 API deployment 的私有 helper；不再建立一个模糊的根级 `server/`。

## Ownership examples

```text
WorldRuntime                 → world/runtime/WorldRuntime.js
WorldSpec                    → world/spec/WorldSpec.js
WorldComposer                → world/compiler/WorldComposer.js
WorldValidator               → world/verification/WorldValidator.js
AssetCompiler                → asset/compiler/AssetCompiler.js
EmbodiedGenAdapter           → asset/adapters/EmbodiedGenAdapter.js
ArtifactRegistry             → generation/artifacts/ArtifactRegistry.js
ConnectorClient              → generation/connector/ConnectorClient.js
GenerationOrchestrator       → generation/orchestration/GenerationOrchestrator.js
ToolCallingAgent             → agent/ToolCallingAgent.js
SkillRegistry                → agent/skills/SkillRegistry.js
AppShell                     → studio/ui/AppShell.js
```

## Rules

1. 禁止重新建立根级 `src/`。
2. 禁止新增根级技术分类，例如 `pipeline/`、`validation/`、`adapters/`、`helpers/`、`utils/`。
3. 代码跟 owner 走：World validation 属于 `world/verification`，Asset adapter 属于 `asset/adapters`。
4. `core/` 只能放 business-neutral primitive，并且不能依赖任何产品 domain。
5. `services/*` 必须能够解释为独立 runtime/deployment unit；`sdk/*` 必须解释为独立消费/发布边界。
6. 只有出现真实的独立 package/release lifecycle 时才引入 `packages/`；不能为了“整理目录”而 package 化。
7. `tooling/` 只放 repository engineering；某个 domain 专属的工具应该留在对应 domain。
8. unit test 可以逐步靠近 owner；根 `tests/` 主要承担 integration、contract、regression、e2e。

`npm run architecture:validate` 会机械拒绝旧的 `src/ server/ tools/ scripts/ experiments/ ops/` 根目录回归，并验证 Core / Asset / World 的关键依赖边界。
