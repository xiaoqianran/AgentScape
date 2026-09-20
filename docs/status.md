# Current Status

本文件是 AgentScape 当前状态的**入口**，不再承担长期 roadmap 或版本演进记录。

## Documentation state

当前文档已经按以下层级收敛：

```text
L0 Project Truth
L1 System Architecture
L2 Module Contracts
L3 Capability Contracts
L4 Archive / Research / History
```

当前开发应优先读取 [`README.md`](README.md) 中定义的 authority policy。

## Runtime architecture

World Runtime 的当前系统边界以 [`architecture/world-runtime.md`](architecture/world-runtime.md) 为架构入口；具体接口分别以 `modules/` 下的 Module Contract 为准。

## Generated World

Generated World 已有 admission / composition / regeneration 等 capability 文档。3DGS / point-cloud → collider reconstruction 仍应作为独立 Module Contract 收敛，建议后续落为：

```text
modules/collider-provider.md
```

并由 Generated World capability 引用，而不是绑定某个前端工具或单一实现。

## Historical status

旧 `status-and-roadmap.md` 已归档到：

[`archive/history/status-and-roadmap.md`](archive/history/status-and-roadmap.md)

它只用于历史追溯，不代表当前系统状态。
