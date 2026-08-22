# AgentScape

**Build interactive 3D worlds for agents.**

AgentScape is an experimental Web3D runtime where an AI agent can inspect and manipulate an interactive 3D scene through a small, explicit tool API.

## V0.6

The current version intentionally stays focused:

- Three.js rendering runtime
- Rapier rigid-body physics for floor, furniture and movable props
- three-mesh-bvh accelerated spatial queries
- asset behavior metadata (`GLB + behavior` model)
- agent tool interface: spawn / move / pickup / drop / place / open / close
- interactive demo scene with a table, physics-enabled cup and articulated GLB cabinet
- visual editor: click selection, move/rotate gizmos, inspector, duplicate and delete
- Human Editor and AI Agent share the same runtime command boundary
- local deterministic demo planner, designed to be replaced by any tool-calling LLM
- `GLTFLoader`-based path ready for real `.glb` assets

## Architecture

```text
User / LLM
    |
    v
ToolCallingAgent           <- iterative plan / act / observe loop
    |
    v
AgentTools                 <- stable capability boundary
    |
    v
WorldRuntime               <- orchestration only
    |
    +-- AssetManager       <- builtin / GLB / future generated assets
    +-- ObjectStore        <- runtime object lifecycle
    +-- InteractionSystem  <- move / pickup / place / open / close
    +-- PhysicsSystem      <- Rapier integration
    +-- EventBus           <- observability and loose coupling
    |
    +-- Three.js           rendering
    +-- three-mesh-bvh     spatial queries
```

Assets are described by validated manifests instead of hard-coding behavior into the renderer:

```js
{
  id: 'cabinet',
  type: 'cabinet',
  source: { kind: 'glb', url: '/assets/cabinet.glb' },
  actions: ['open', 'close', 'move'],
  parts: {
    door: {
      node: 'Door_Hinge',
      joint: { type: 'revolute', axis: [0, 1, 0], limits: [-1.35, 0] }
    }
  }
}
```

This separation is deliberate: replacing the demo planner with an LLM, replacing a builtin primitive with a Blender GLB, or adding an asset generator should not require rewriting the world runtime.

### Stability gates

Every push to `main` must pass:

```bash
npm run check
```

That executes the unit test suite and a production build before GitHub Pages deployment.

## Run

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Next milestone

1. Import real Blender-exported GLB assets.
2. Store behavior metadata in glTF `extras` / sidecar JSON.
3. Upgrade articulated parts to Rapier revolute/prismatic joints.
4. Add collision-aware placement and support-surface queries.
5. Add a real LLM adapter using the existing `AgentTools` contract.
6. Add an asset resolver: search existing assets first, generate missing assets second.

## License

MIT

## Blender / GLB authoring contract

V0.3 loads a real GLB asset from `public/assets/cabinet.glb`. The demo GLB follows the same node contract expected from Blender:

```text
Cabinet scene
├── Body
└── doorHinge          <- pivot/origin placed on the hinge axis
    └── Door
```

For a replacement Blender asset:

1. Model moving parts as separate objects.
2. Put the hinge/pivot origin on the physical rotation axis.
3. Preserve node names on glTF export (`Body`, `doorHinge`, `Door`).
4. Export as glTF 2.0 binary (`.glb`).
5. Register the asset in `src/assets/manifests/index.js`.
6. Run `npm run assets:validate` before committing.

The manifest owns behavior and physics. The GLB owns visuals and hierarchy. This keeps art assets replaceable without changing Agent tools or world logic.

## Editor controls

- Click an object to select it.
- `W` switches to translate mode.
- `E` switches to rotate mode.
- `Delete` removes the selected object.
- The top toolbar can duplicate an object.
- Inspector action buttons call the same `AgentTools` used by an AI agent.

The editor never edits an independent copy of the scene. Human and agent operations mutate the same `WorldRuntime`, so future undo/redo, persistence, multiplayer, and LLM planning can be built around one authoritative world state.

## Spatial intelligence

V0.5 adds a dedicated `SpatialSystem` used by both the editor and agents:

- `getBounds(id)`
- `findNearby(id, radius)`
- `raycast(origin, direction)`
- `isColliding(id)`
- `findSupportSurface(targetId)`
- `findFreeSpace(id, targetId)`

`place(id, targetId)` no longer uses a hard-coded offset. It queries the target support surface, measures the object bounds, searches candidate positions, rejects collisions, then hands the chosen pose to the physics system.

## Tool-calling agent

V0.6 replaces the keyword-only demo agent with a real iterative agent loop:

```text
User goal
   ↓
LLM Gateway
   ↓
Tool calls
   ↓
AgentTools
   ↓
WorldRuntime
   ↓
Tool results
   └────────→ LLM Gateway (repeat)
```

The loop is capped at 8 planning steps and feeds tool errors back to the model as structured results, so a planner can recover instead of crashing the scene.

Because GitHub Pages is a static frontend, AgentScape deliberately does **not** collect or persist model provider API keys. Configure a server-side Gateway URL in the Agent Console. The browser stores only that URL. See [`docs/llm-gateway.md`](docs/llm-gateway.md) for the provider-neutral request/response contract.

Without a Gateway URL, AgentScape automatically uses a deterministic local fallback planner so the public demo remains usable.
