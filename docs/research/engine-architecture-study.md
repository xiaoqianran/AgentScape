# AgentScape engine architecture study

This document records the architecture review that led to the AgentScape 1.0 engine core. The referenced repositories were cloned locally and indexed with CodeGraph; the implementation in AgentScape is a clean-room JavaScript design unless noted otherwise.

## Repositories studied

| Project | License | What AgentScape learns from it |
| --- | --- | --- |
| HorizonRobotics/EmbodiedGen | Apache-2.0 | simulation-ready asset pipeline, collision/physics preparation, provider/backend separation, exported assets |
| nepfaff/scenesmith | MIT | staged world-generation agents, asset manager/router, retrieval-vs-generation backends, collision generation as a service |
| generalholography/gizmo | Apache-2.0 | editor commands, atomic command batches, shared headless/editor engine boundary, schema registries |
| syndicalt/limina | AGPL-3.0 | skill registry concepts, permission boundary, causal trace/replay design; **ideas only, no code copied** |
| wrc356/Auto-Threejs | no license file found | compile/verify/check/repair-guard concepts; **ideas only, no code copied** |

## 1. Capability boundary: Skill Registry

A mature agent engine should not expose arbitrary Three.js mutations. Every capability is a named skill with metadata, validation, permissions, execution and trace emission.

```text
LLM / Human / future MCP
          |
          v
     SkillRegistry
       /   |    \
 validate policy execute
          |
          v
     WorldRuntime
```

This is the architectural replacement for the early `AgentTools` switch statement. `AgentTools` remains as a compatibility facade, but actual execution happens through `SkillRegistry`.

## 2. Policy before mutation

Every skill declares permissions such as:

- `world.read`
- `world.write`
- `asset.read`
- `asset.write`
- `spatial.read`
- `physics.read`

Profiles are evaluated before handlers run. This makes the boundary usable later for autonomous agents, human approval gates and MCP clients without teaching the renderer about security.

## 3. Auditable trace

Every policy decision, skill result and pipeline stage emits an event into an integrity-linked trace. The current browser implementation uses a deterministic lightweight hash chain for accidental/tamper detection; it is not presented as cryptographic non-repudiation.

The important design rule is causal structure:

```text
policy.decision
      |
      v
skill.executed / skill.failed
      |
      v
world mutation / pipeline stages
```

## 4. Transactions and batches

AI edits are frequently multi-step. Treating each primitive as an unrelated undo entry makes recovery fragile. `executeBatch` runs registered skills against one pre-edit world snapshot. If any nested operation fails, the entire batch restores the snapshot.

```text
snapshot
  |
  +-> call A -- ok
  +-> call B -- ok
  +-> call C -- fail
  |
restore snapshot
```

## 5. Staged world pipeline

SceneSmith demonstrates why world construction should be staged rather than one giant prompt. AgentScape now has a generic `PipelineEngine`; the default world pipeline is:

```text
resolve_assets
     ↓
instantiate
     ↓
apply_relations
     ↓
validate
     ↓
repair
     ↓
finalize
```

Stages can be run independently, making failures observable and allowing future replacement of each stage by a stronger backend.

## 6. Asset backends, not one generator

SceneSmith and EmbodiedGen both make backend separation explicit. AgentScape follows the same principle:

```text
AssetLibrary
  ├─ reusable builtin/GLB assets
  ├─ HTTP Asset Generator
  └─ external adapters
       └─ EmbodiedGenAdapter
```

The runtime never depends on Hunyuan3D/TRELLIS/SAM3D directly. Those systems produce assets; AgentScape consumes normalized manifests.

## 7. Compile / validate / repair loop

Auto-Threejs separates scene compilation/verification/physics checks and rejects repairs that make hard findings worse. AgentScape adopts that **principle**, not its unlicensed code.

Current deterministic checks include:

- below-ground geometry
- object overlap
- unsupported/floating advisory
- inverse semantic relation consistency

The repair engine can lift below-ground objects and attempt bounded overlap separation. A repair is rejected and the world restored if hard findings increase.

Future checks should add articulated joint sweeps, stability/toppling, collider coverage, navigability and task execution tests.

## 8. EmbodiedGen interoperability

`EmbodiedGenAdapter` is deliberately loose at the provider boundary and strict at the AgentScape manifest boundary. It maps browser-reachable GLB, dimensions, mass, friction and affordances into a runtime asset manifest. The adapter does not import EmbodiedGen Python runtime into the browser.

## 9. Why AgentScape stays browser-native

AgentScape should not become a smaller reimplementation of Isaac/MuJoCo/SAPIEN. Its differentiated execution target remains:

```text
GLB-first assets
       +
Three.js/Web browser
       +
Rapier physics
       +
Agent skills / semantic spatial model
```

Heavy robotics/generation systems are upstream backends; AgentScape is the interactive spatial-agent runtime and compiler target.
