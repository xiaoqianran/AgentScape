# Generation Runtime

AgentScape 的生成控制面只有一条主链：

```text
Studio / Agent / World retry
        │
        ▼
GenerationRuntime
        │
        ▼
Connector session
        │
        ▼
capability snapshot
        │
        ├─ submit / reconcile Job
        └─ import verified Artifact
                │
                ▼
          Asset publication
                │
                ▼
          Asset Compiler
                │
                ▼
       ready / provisional / rejected
```

## Ownership

`GenerationRuntime` 位于 `generation/orchestration/GenerationRuntime.js`，负责 AgentScape 侧 composition：

- Connector pairing 与 capability snapshot；
- Provider-neutral capability selection；
- Job projection / reconcile / cancel；
- Artifact hash、MIME、bytes admission；
- Artifact → Asset publication；
- Asset Compiler wiring。

它**不拥有**远程 Provider 实现、Provider 私有凭据、GPU runtime 或 Provider-private storage。这些属于兄弟仓库 `modal-provider`。

## Provider discovery

`ProviderRegistry` 默认不预置任何远程 Provider id。

```text
AgentScape source
    X modal-2d
    X modal-3d
    X embodiedgen
    X legacy-http-generator
```

远程 Provider 只能通过当前 Connector capability snapshot 动态进入 registry。Snapshot 消失后，对应 Connector-owned Provider 也从 registry 删除。

显式 local test/development capability 可以注册，但其 ownership 为 local，Connector 不得覆盖。

## No direct generation gateway

以下旧路径已经删除：

```text
LegacyAuthoringShell
HttpAssetGenerator
/api/capabilities/asset-generate
runtime.authoring
browser-configured remote Provider endpoint
```

AgentScape 自身部署 capability 只保留它真正拥有的能力，例如 `agent` 与 `asset.compile`。远程生成不能绕过 Connector 直接调用 Provider。

## Agent surface

Agent 可以通过 generation skill pack 使用：

```text
listGenerationProviders
listGenerationCapabilities
submitGenerationJob
getGenerationJob
cancelGenerationJob
importGenerationResult
generateAndCompileAsset
```

`generateAsset` 是一个高层 convenience tool，也仍然进入 `GenerationRuntime`，不会恢复 direct Provider client。

Provider-specific import tool 不属于默认 Agent surface。上游 payload adapter（例如 `asset/adapters/EmbodiedGenAdapter.js`）只属于 Asset compatibility/import implementation，不代表 Provider topology。

## Python SDK

Python SDK 与浏览器 Runtime 使用同一原则：只暴露 Unified Connector contract，不再暴露 Kaggle/direct Modal Provider client。

详见 [`../sdk/python/README.md`](../sdk/python/README.md)。
