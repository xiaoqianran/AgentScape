# Yuanmingyuan Western Mansions Environment

This is a native AgentScape Environment adapted from the standalone
`/workspace/wk/001/src/` project in the user's CNB workspace. The standalone
project remains unchanged. The procedural geometry and GLSL shaders are kept
in the corresponding source modules to reduce visual regressions.

## Entry points

- Studio: `/?world=yuanmingyuan-western-mansions`
- SDK: `AgentScape.open({ environment: 'yuanmingyuan-western-mansions' })`
- Factory: `createYuanmingyuanEnvironment({ renderer, quality, seed })`

## Ownership and lifecycle

The factory produces `root`, `colliders`, `navigationRoot`, rendering settings,
views and persistent environment state. The AgentScape Runtime owns the scene,
renderer, physics, main simulation loop and resource disposal. There is no
independent canvas or `requestAnimationFrame` loop.

The scene uses custom GLSL ShaderMaterial and requires the classic Three.js
WebGLRenderer (`webgl-legacy`) rather than WebGPURenderer's WebGL backend.
Studio reloads the route when switching from an incompatible renderer.

## Current integration boundaries

- Terrain is backed by one simplified trimesh collision/navigation proxy.
  Building walls, stairs and lake exclusions need dedicated physics/nav proxies.
- Three.js scene layers use the original procedural batching; object-level
  semantic interaction IDs are not fully migrated yet.
- The original standalone postprocessing, HUD, custom time-of-day controls and
  film-grade effects are not yet exposed as Studio UI controls.
- Project-bundle serialization references this built-in environment by ID.
  A portable self-contained `.agentscape` world archive is a separate feature.
- The original source project did not contain a standalone LICENSE file. Confirm
  the source author's redistribution permission before public release.
