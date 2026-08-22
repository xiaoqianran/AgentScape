# AgentScape

**Build interactive 3D worlds for agents.**

AgentScape is an experimental Web3D runtime where an AI agent can inspect and manipulate an interactive 3D scene through a small, explicit tool API.

## V1

The first version intentionally stays small:

- Three.js rendering runtime
- Rapier rigid-body physics for floor, furniture and movable props
- three-mesh-bvh accelerated spatial queries
- asset behavior metadata (`GLB + behavior` model)
- agent tool interface: spawn / move / pickup / drop / place / open / close
- interactive demo scene with a table, physics-enabled cup and behavior-driven cabinet door
- local deterministic demo planner, designed to be replaced by any tool-calling LLM
- `GLTFLoader`-based path ready for real `.glb` assets

## Architecture

```text
User / LLM
    |
    v
AgentTools
    |
    +-- listObjects
    +-- spawnAsset
    +-- moveObject
    +-- pickup / drop / place
    +-- open / close
    |
    v
World Runtime
    |
    +-- Three.js        rendering
    +-- Rapier          physics
    +-- three-mesh-bvh  spatial queries
    +-- AssetRegistry   GLB / generated assets
```

The key idea is that a mesh is not an interactive object by itself. AgentScape adds behavior metadata describing what an asset *can do*.

```json
{
  "type": "cup",
  "actions": ["pickup", "drop", "place"],
  "physics": { "body": "dynamic", "mass": 0.3 }
}
```

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
