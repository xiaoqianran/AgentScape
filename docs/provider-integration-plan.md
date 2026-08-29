# AgentScape Provider Integration

> Current architecture as of 2026-08-29. 旧的“Modal/Kaggle/Embodied 多独立仓库”Provider 计划已经作废。

## 1. Repository boundary

AgentScape 只对接一个 Provider monorepo：`modal-provider`。

```text
AgentScape
  │
  │ Capability / Job / Artifact
  ▼
modal-provider
  ├─ modal-gen-client      optional local security gateway
  ├─ modal-2D-client       image sidecar
  ├─ modal-2D              image provider
  ├─ modal-3D-client       3D sidecar
  ├─ modal-3D              3D provider
  └─ modal-EmbodiedGen     EmbodiedGen build/runtime integration
```

AgentScape 不依赖这些内部 package 的文件路径、数据库、Volume path 或 Modal call id。

## 2. Stable contract

AgentScape 面向 provider-neutral 语义：

```text
Capability
Execution / Job
Artifact descriptor
Artifact bytes + integrity
Finding / evidence
```

典型操作：

```text
capabilities
submit
status/get
cancel
artifact
```

具体 operation id 可以保留 provider scope，例如：

```text
modal-2d.image.text_to_image.v1
modal-3d.asset.image_to_3d.v1
```

但 AgentScape 的 Asset/World 逻辑不能通过 operation 名推断 Provider 私有实现。

## 3. Runtime ownership

### AgentScape owns

- capability selection / Agent or Human intent；
- Connector-facing session/job projection；
- admitted Artifact identity；
- Asset Compiler / admission；
- World composition/runtime/verification。

### modal-provider owns

- Modal credential and runtime；
- provider-private jobs and artifacts；
- GPU/model lifecycle；
- sidecar restore/cache；
- optional local pairing/security gateway；
- 2D/3D input conditioning；
- EmbodiedGen upstream pin、build artifact、patch、runtime。

## 4. 2D → 3D flagship flow

```text
Text / Human Intent
  → AgentScape Skill/UI
  → image capability
  → modal-provider/modal-2D-client
  → modal-provider/modal-2D
  → image candidate artifact(s)
  → AgentScape Agent/VLM/Human selection
  → 3D capability
  → modal-provider/modal-3D-client
  → modal-provider/modal-3D
  → GLB artifact
  → AgentScape Artifact admission
  → Asset Compiler
  → World Pipeline
```

“Text → 3D”仍可以由 AgentScape Skill composition 实现，不需要制造新的顶层 Provider 仓库。

## 5. Optional local security gateway

`modal-provider/modal-gen-client` 只在 Browser/WebView 或本机特权隔离需要时出现：

```text
AgentScape/WebView
  → pairing/session/scope
  → modal-gen-client
  → provider sidecar
```

它不是 AgentScape 的业务 Orchestrator，也不是 Asset/World authority。

## 6. EmbodiedGen

EmbodiedGen 不再作为 AgentScape workspace 的独立仓库节点。

```text
modal-provider/modal-EmbodiedGen
  → pin/clone exact upstream source
  → apply compatibility/build/runtime integration
  → produce Provider artifacts
  → AgentScape EmbodiedGenAdapter / admission
```

AgentScape 可以继续识别 `provider=embodiedgen` 的数据语义，但不直接 import upstream internals。

## 7. Removed paths

当前架构不再包含：

- Kaggle 平级生产 Provider；
- 独立 `modal-inference-hub` Human Caller 仓库；
- 独立 `AgentScape-agent` 仓库；
- 独立 `modal-build` / `modal-lab`；
- Provider Git submodule topology。

如果未来需要重新引入新的 Provider repository boundary，必须先证明它拥有独立的 state/security/deployment/failure lifecycle，并通过新的 ADR，而不是复活旧拓扑。
