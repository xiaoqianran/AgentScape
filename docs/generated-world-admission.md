# Generated World Admission

Generated World 的 canonical truth 不由 Provider、LLM 或 Generator 决定，而由 AgentScape 的 WorldIR → Admission → Runtime 验证链决定。

## Current chain

```text
Planner proposal
    │
    ▼
proposeWorldIR
    │ Runtime-issued revision/provenance
    ▼
WorldIR
    │
    ▼
runWorldPipeline
    │
    ├─ resolve reusable Asset
    │
    ├─ missing + generation allowed
    │        ▼
    │   GenerationRuntime
    │        ▼
    │   Connector Job / Artifact
    │        ▼
    │   Asset publication / Compiler
    │
    ├─ asset admission
    ├─ deterministic layout
    ├─ behavior admission
    ├─ physics admission
    ├─ instantiate
    ├─ ON / NEAR / INSIDE relations
    ├─ validation / repair
    ├─ world acceptance
    └─ final world admission
```

## Reuse before generation

Asset resolution always prefers an existing admitted Asset. A missing search result can become generation input only when WorldIR/policy permits it. Runtime 的 bounded retry 只允许为 missing Asset 开启一次 generation；Agent 不自己翻转 retry state，也不能绕过 canonical pipeline。

## Asset truth

外部 Job 成功不是 AgentScape Asset。Artifact 必须经过本地完整性/content gate、publication、Compiler/admission，最终成为：

```text
asset-ready
asset-provisional
asset-rejected
```

Schema-valid 或 Provider-succeeded 都不等于 `asset-ready`。

## World truth

World admission 汇总 Asset、layout、behavior、physics、relation、validation 与 acceptance evidence：

```text
world-ready       → verified
world-provisional → unverified
world-rejected    → failed / rollback
```

Rejected candidate world 恢复之前 Scene/authority；部分成功的 spawn 不会变成 committed truth。

## Canonical placement

WorldIR 支持 Runtime-owned deterministic placement。用户没有要求精确坐标时，Planner 应省略 position，由 Runtime 使用 Asset footprint、Environment bounds 与 Physics preflight 决定位置。

Canonical relation input 包括：

```text
ON
NEAR
INSIDE + receptacleId
```

Planner 写出 relation 不等于 relation 成立；Runtime 必须物理执行，并由 Spatial/SceneGraph/verification 从实际世界重新推导结果。

## Provider neutrality

Generated World admission 不在源码默认值中认识 `modal-2d`、`modal-3d`、EmbodiedGen 或其它远程 Provider id。Provider capability 来自 Connector snapshot；World pipeline 只消费 normalized generation / Artifact / Asset contract。

## Low-level tools do not own World success

`generateAsset` 与 `spawnAsset` 仍适合显式低层编辑，但不能证明一个 generated multi-object world 已完成。此类任务必须走 `proposeWorldIR → runWorldPipeline` 并服从 final world admission。

Provider-specific import tool 不属于默认 Agent surface。

## Evidence and restore

持久化恢复出的 acceptance evidence 只是历史证据，必须针对当前 Runtime truth replay 后才能重新成为 current evidence。Scene restore 会先重建全新的 Physics World，再重新挂 Environment 与对象，避免旧 joint/collider/query 生命周期污染恢复后的世界。

See also:

- [`deterministic-world-composer.md`](./deterministic-world-composer.md)
- [`bounded-world-regeneration.md`](./bounded-world-regeneration.md)
- [`world-viability.md`](./world-viability.md)
- [`generation-runtime.md`](./generation-runtime.md)
