# AgentScape 文档体系

AgentScape 文档按“当前真相”与“历史背景”分层。阅读和开发时不要把所有 Markdown 视为同等权威。

## 权威优先级

发生冲突时，按以下顺序判断：

1. **代码与可执行测试** — 当前实现的最终事实。
2. **L2 Module Contracts** — 模块公开 API、输入输出、状态、错误和不变量。
3. **L1 System Architecture** — 系统边界、ownership、依赖 DAG 与 single source of truth。
4. **L3 Capability Contracts** — 跨模块工作流和端到端能力。
5. **L0 Project Truth** — 项目级导航、仓库边界和当前状态摘要。
6. **Archive / Planning** — 研究、历史、旧计划、阶段记录；不得作为当前契约。

如果 Archive 与 L0–L3 或代码冲突，Archive 自动失效。

## L0 — Project Truth

- [`architecture.md`](architecture.md) — 当前系统总架构。
- [`repository-layout.md`](repository-layout.md) — 当前仓库边界与目录 ownership。
- [`status.md`](status.md) — 当前文档与系统状态入口。
- 本文件 — 文档导航和 authority policy。

L0 只描述“现在是什么”，不保存演进故事。

## L1 — System Architecture

目录：[`architecture/`](architecture/)

- [`architecture/world-runtime.md`](architecture/world-runtime.md) — Physics / Spatial / Navigation / Locomotion / Interaction / Rendering 的系统边界。
- [`architecture/multi-repository.md`](architecture/multi-repository.md) — 多仓库职责边界。
- [`architecture/observability.md`](architecture/observability.md) — Observatory / developer runtime observability。

L1 描述系统 ownership 和依赖方向，不承担字段级 API 说明。

## L2 — Module Contracts

目录：[`modules/`](modules/)

当前核心接口文档：

- [`modules/physics.md`](modules/physics.md)
- [`modules/spatial.md`](modules/spatial.md)
- [`modules/navigation.md`](modules/navigation.md)
- [`modules/locomotion.md`](modules/locomotion.md)
- [`modules/interaction.md`](modules/interaction.md)
- [`modules/asset-compiler.md`](modules/asset-compiler.md)
- [`modules/generation-runtime.md`](modules/generation-runtime.md)
- [`modules/llm-gateway.md`](modules/llm-gateway.md)
- [`modules/debug-overlay.md`](modules/debug-overlay.md)
- [`modules/design-system.md`](modules/design-system.md)
- [`modules/test-agent.md`](modules/test-agent.md)

**新模块优先新增到这一层。** 模块文档应逐步统一为：

```text
Responsibility
Owns
Does Not Own
Public API
Inputs / Outputs
Errors
State / Lifecycle
Dependencies
Invariants
Side Effects
Examples
Tests
```

例如后续的 Generated World collider 能力，应优先形成 `modules/collider-provider.md`，而不是写进历史计划。

## L3 — Capability Contracts

目录：[`capabilities/`](capabilities/)

这里描述跨多个模块的完整行为，例如：

- carry / place / interaction range
- articulation / recovery / counterfactual recovery
- generated-world admission
- deterministic world composition
- bounded regeneration
- world authoring / viability

Capability 文档可以引用多个 Module Contract，但不能重新定义底层模块 API。

## L4 — Archive

目录：[`archive/`](archive/)

- [`archive/research/`](archive/research/) — 开源项目、算法、替代方案研究。
- [`archive/history/`](archive/history/) — evolution、旧 roadmap、旧 mission/plan、阶段 brief、旧 decisions 等。

这些内容用于回答“为什么曾经这样设计”，**不是 Current Truth**。

## Planning

执行计划、backlog、未来事项属于仓库根目录 [`../planning/`](../planning/)，不属于 Current Docs。

历史 `execution-backlog.md` 已移动到 `planning/archive/`。

## 推荐阅读路径

修改某个模块时：

```text
对应 modules/<module>.md
        ↓
相关 architecture/*.md
        ↓
相关 capabilities/*.md
        ↓
必要时再查 archive/
```

首次理解项目时：

```text
README
→ architecture.md
→ repository-layout.md
→ architecture/world-runtime.md
→ 目标 module contract
```

## 文档维护规则

1. 新接口首先更新 Module Contract。
2. 跨模块行为再更新 Capability Contract。
3. 架构 ownership 改变才更新 L1。
4. 历史原因进入 Archive/ADR，不写进当前接口正文。
5. Roadmap、TODO、下一轮计划进入 `planning/`。
6. 不允许用 Archive 文档证明当前行为。
7. 文档和代码冲突时，先以代码/测试确认事实，再修正文档。
