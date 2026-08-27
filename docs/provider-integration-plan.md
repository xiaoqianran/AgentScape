> **Historical migration note (2026-08-27):** 本文记录的是仓库拆分前的 Provider 集成状态，不再是目标架构权威。原 `modal-3D-client` 已重命名为 `modal-inference-hub`（Human Caller），新的独立 `modal-3D-client` 是纯 Reference Sidecar。当前目标架构以 `AgentScape-plan` 的 System Landscape / Repository Cards / Integration Ledger 为准。

# AgentScape Provider 集成计划

## 1. 当前状态

AgentScape 已完成多仓库 Submodule 集成，主仓作为组合工程，各子项目仍保留独立 Git、历史、远端和 CI。

```text
AgentScape.git
├── src/                              # AgentScape 核心
├── providers/
│   ├── modal/
│   │   ├── connector/                # modal-gen-client
│   │   ├── image-runtime/            # modal-2D
│   │   ├── image-agent/              # modal-2D-client
│   │   ├── object3d-runtime/         # modal-3D
│   │   ├── inference-hub/            # modal-inference-hub (Human Caller)
│   │   └── object3d-agent/           # new modal-3D-client Reference Sidecar
│   ├── kaggle/runtime/               # kaggle-inference-hub
│   └── embodied/runtime/             # modal-build
├── sdk/python/                        # AgentScape-client
├── upstream/EmbodiedGen/              # EmbodiedGen
└── research/modal-lab/                # modal-lab
```

当前主仓与各子仓 pinned HEAD 已对齐；AgentScape 核心测试和构建通过。

仓库结构阶段已完成，下一步不再调整 repo 拆分，重点转向运行时架构收口。

---

## 2. 目标架构

AgentScape 只理解 **Capability / Job / Artifact / Evidence**，不理解 Modal、Kaggle 的内部实现。

```text
                         AgentScape
                             │
                             ▼
                        World IR
                             │
                             ▼
                      World Pipeline
                             │
                             ▼
                  GenerationOrchestrator
                             │
                             ▼
                     ProviderRegistry
                   /          |          \
                  /           |           \
                 ▼            ▼            ▼
              Modal         Kaggle      Embodied
                 │            │            │
                 ▼            ▼            ▼
          Modal Runtime   Kaggle Hub   EmbodiedGen
                 │            │            │
                 └────────────┴────────────┘
                              │
                              ▼
                           Artifact
                              │
                              ▼
                        AssetCompiler
                              │
                              ▼
                     Physics Admission
                              │
                              ▼
                         WorldRuntime
                              │
                              ▼
                         Verification
```

核心原则：

```text
AgentScape 面向 capability
Provider 负责实现 capability
Modal / Kaggle 并列
EmbodiedGen 作为独立 Provider
```

禁止形成：

```text
AgentScape
    ↓
modal-gen-client
    ↓
所有 Provider
```

`modal-gen-client` 只能是 Modal Provider 的实现，不是全系统唯一 Connector Authority。

---

## 3. Provider Contract

公共语义由 AgentScape 定义。

最小能力：

```text
submit
get/status
cancel
artifact
```

统一数据：

```text
Capability
Job
Artifact
Evidence
```

Capability 必须与 Provider 解耦。

错误：

```text
modal-2d.image.text_to_image.v1
modal-3d.asset.image_to_3d.v1
```

作为上层 capability。

正确：

```text
image.generate
object3d.generate
asset.generate
```

Provider 自己记录底层 operation：

```text
capability = object3d.generate
provider   = modal
operation  = modal-3d.asset.image_to_3d.v1
```

或：

```text
capability = object3d.generate
provider   = kaggle
operation  = kaggle.<model>.image_to_3d.v1
```

不要引入不必要的 `Factory / Manager / Strategy` 层；优先在现有 `ProviderRegistry` 和 `GenerationOrchestrator` 中收口。

---

## 4. 当前剩余问题

### 4.1 Kaggle 尚未进入生产主链

`kaggle-inference-hub` 已作为 Submodule 接入，但 AgentScape Runtime 还没有真正的 `KaggleProvider`。

必须复用现有 Kaggle 机制：

```text
task
worker
claim
heartbeat
complete/fail
artifact
```

只增加最薄的 AgentScape Adapter，不重写 Kaggle Hub。

### 4.2 Generation 仍有两条路径

当前仍存在：

```text
World Pipeline
    ↓
AssetLibrary
    ↓
legacy HttpAssetGenerator
```

以及：

```text
GenerationOrchestrator
    ↓
Connector / Job / Artifact
```

最终必须只有一条 canonical path：

```text
World Pipeline
    ↓
AssetLibrary
    ↓
GenerationOrchestrator
    ↓
ProviderRegistry
```

### 4.3 Modal Connector 职责过高

当前 `modal-gen-client` 仍接近系统级 Unified Connector。

目标：

```text
modal-gen-client
= Modal Provider Client
```

不是：

```text
modal-gen-client
= AgentScape 全局 Provider Authority
```

### 4.4 modal-3D-client 存在旧 Connector facade

`modal-3D-client` 仍有 `/connector/v1/*` 兼容入口。

目标：

```text
modal-3D-client
= 3D Local Provider Agent
```

旧 Connector facade 先保留兼容，待新主链 E2E 稳定且无调用者后再删除。

### 4.5 Submodule 初始化过重

当前 `repos.sh init` 使用递归初始化，会继续拉取 EmbodiedGen 内部大量第三方子模块。

需要区分：

```text
repos.sh init
    → 只初始化 AgentScape 一级 Submodule

repos.sh init-full
    → 明确需要时才递归初始化所有第三方依赖
```

`status/check` 也必须正确识别未初始化 Submodule，不能穿透到父仓误判。

---

## 5. 执行顺序

| 阶段 | 工作 | 完成标准 |
|---|---|---|
| P15 | 修 `repos.sh` | 一级初始化稳定；`init-full` 才递归；`status/check` 判断准确 |
| P16 | Provider-neutral Capability | 上层只使用 `image.generate / object3d.generate / asset.generate` |
| P17 | 接入 KaggleProvider | AgentScape 可通过统一 Contract 提交、查询、取消并获取 Kaggle Artifact |
| P18 | Modal 降为普通 Provider | `modal-gen-client` 不再拥有系统级 Provider Authority |
| P19 | Generation 单链收口 | World Pipeline 只经 `GenerationOrchestrator → ProviderRegistry` 生成资产 |
| P20 | Cross-provider E2E | Modal、Kaggle、Embodied 的真实组合链通过 |
| P21 | 清理 Legacy | 无 production caller 后再删除 legacy generator / compatibility facade |

严格按顺序执行，不并行删除旧链。

---

## 6. P19 最终主链

```text
World IR
   │
   ▼
World Pipeline
   │
   ▼
AssetLibrary
   │
   ├── 已有资产 ───────────────► 返回
   │
   └── 缺失资产
          │
          ▼
 GenerationOrchestrator
          │
          ▼
    ProviderRegistry
       /        \
      ▼          ▼
   Modal       Kaggle
      │          │
      ▼          ▼
     Job        Job
      │          │
      ▼          ▼
  Artifact    Artifact
      └────┬─────┘
           ▼
      AssetCompiler
           │
           ▼
   Physics Admission
           │
           ▼
      WorldRuntime
```

`AssetLibrary` 不再拥有独立生成后端，只负责资产搜索、注册和调用统一 Generation 入口。

---

## 7. Cross-provider E2E

至少覆盖：

```text
Case 1
Kaggle image.generate
    ↓
PNG
    ↓
Modal object3d.generate
    ↓
GLB
    ↓
AssetCompiler
```

```text
Case 2
Modal image.generate
    ↓
Modal object3d.generate
    ↓
AssetCompiler
```

如果 Kaggle 已有可用 3D Worker：

```text
Case 3
Kaggle image.generate
    ↓
Kaggle object3d.generate
    ↓
AssetCompiler
```

EmbodiedGen：

```text
Case 4
EmbodiedGen
    ↓
Bundle v1
    ├── primary_glb
    ├── source_urdf
    ├── part_segmentation
    ├── raw_grasps
    └── part_semantics
    ↓
EmbodiedGenBundleAdapter
    ↓
AssetCompiler
```

测试必须验证真实 Job / Artifact / hash / MIME / lineage，不只验证 success flag。

---

## 8. Legacy 删除条件

只有同时满足以下条件才删除旧路径：

```text
新 Provider Contract 已稳定
        +
Kaggle / Modal / Embodied E2E 通过
        +
World Pipeline 已完全切到新链
        +
无 production caller
```

再处理：

```text
HttpAssetGenerator
legacy-http-generator
modal-3D-client /connector/v1 compatibility facade
旧 generation skill path
```

原则：

```text
先证明新链
再 deprecated
最后删除旧链
```

---

## 9. 完成定义

本阶段完成时，系统必须满足：

```text
1. AgentScape 不依赖 Modal/Kaggle 私有实现。
2. Modal 与 Kaggle 是平级 Provider。
3. Capability 与 Provider 名称解耦。
4. World Pipeline 只有一个 Generation 主链。
5. Artifact 统一进入 AssetCompiler / Admission。
6. EmbodiedGen 保持现有 Bundle Contract，不重复设计。
7. 各 Provider 仓库仍可独立开发、测试、发布。
8. AgentScape 只通过 Submodule pin 组合经过验证的版本。
```

最终结构：

```text
                     AgentScape
                         │
                         ▼
                 World Pipeline
                         │
                         ▼
              GenerationOrchestrator
                         │
                         ▼
                  ProviderRegistry
                 /       |       \
                ▼        ▼        ▼
             Modal     Kaggle   Embodied
                │        │        │
                └────────┴────────┘
                         │
                         ▼
                      Artifact
                         │
                         ▼
                   AssetCompiler
                         │
                         ▼
                Physics Admission
                         │
                         ▼
                    WorldRuntime
```
