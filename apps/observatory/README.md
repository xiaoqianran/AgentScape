# Observatory

入口 `main.js`，公开路由仍为 `/observatory/`。任务见 [tasks.jsonl](tasks.jsonl)，验证使用 `npm run test:observatory`。实验性 WebGPU Probe 位于 `probes/rendering/`，正式 RendererProbe 属于 `modules/rendering`。

Observatory keeps its original shell, viewport, telemetry, and lab navigation. Three labs are now the primary entries:

1. list and preview the complete `AssetCatalog`, and compile uploaded GLB files through the production `AssetCompiler` before registration;
2. accept Gaussian Splat PLY or SPZ files, transcode PLY to the Runtime SPZ format, and preview the result through the production SPZ loader;
3. the Physics Studio (`?lab=physics-studio`), a dedicated physics frontend that drives the production `PhysicsSystem` and exposes its complete public API surface as invokable workbench operations. The surface itself lives in core as `modules/physics/PhysicsApiSurface.js` (67 public methods: 52 direct tools, 2 host spawn/despawn tools, 13 declared host-only/lifecycle exclusions) and is shared with the standalone `npm run physics:check` harness, so the UI and the headless harness cannot drift.

The former Physics, Spatial, Navigation, Interaction, Generation, Agent, and Agent Trace labs remain accessible in the same Lab selector and retain regression coverage, but are labeled Deprecated as product-facing modules.
