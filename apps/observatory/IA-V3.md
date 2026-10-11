# Observatory IA v3 — Workspaces, Tools, Scenes

The user-visible Observatory navigation is **not** an exhaustive list of implementation `LabRegistry` entries. `WorkspaceRegistry.js` declares four user tasks:

| Workspace | Visible tools | Backing labs |
|---|---|---|
| 仿真与验证 | 物理 / 导航 / 空间查询 / 交互 | physics-studio / navigation / spatial / interaction |
| 资产检查 | 3D 资产 / Gaussian Splat | assets / gaussian |
| 智能体验证 | 构建与集成 / 工具调用 / 执行轨迹 | generation / agent / agent-trace |
| 渲染诊断 | 渲染运行场景 | physics-studio + its current RendererProbe / WebGPU probe inspector |

*Legacy* `physics` remains addressable through `?lab=physics` but is deliberately not a primary tool. It shares its simulation scenarios with the primary Physics Studio. Deprecation status is internal technical metadata, not a UI category.

The Renderer diagnostic workspace currently uses the Physics Studio's real renderer as a diagnostic fixture; **it does not yet implement an independent Rendering Lab**. No fake backend metrics are presented. Its active scene remains a physics test fixture, GPU probes are only enabled if WebGPU is supported, and simulation controls are hidden when this workspace is selected.

`?lab=<id>` deep links remain supported, including legacy lab IDs; `?workspace=rendering&lab=physics-studio` selects the rendering diagnostics context. Narrow viewports use the workspace dropdown when the desktop workspace bar is hidden.

`LabRegistry`, `ScenarioRegistry`, scenario execution and engine state remain unchanged. Do not make `WorkspaceRegistry` own simulation truth. When adding a new testing module, register it in `LabRegistry` and attach an appropriate user-visible tool in `WorkspaceRegistry`.
