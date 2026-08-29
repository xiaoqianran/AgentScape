# Repository Baseline

Captured: 2026-08-29

## Current repositories

| Repository | HEAD at capture | Role |
|---|---|---|
| `AgentScape` | `3718ec0a3f6f07d7bda94e0231b90ead82c4bed2` | Agent/Human + Artifact/Asset/World domain/runtime |
| `modal-provider` | `660130a682510787786328e7e15ab83f09f18dce` | Modal Provider monorepo |
| `AgentScape-plan` | `5718499553a4055674ec8b9c4b2d2520c6c86f00` | architecture documentation authority |

## Current topology

`AgentScape` has no Provider Git submodules. The repository architecture validator intentionally expects zero pinned submodules and rejects any `providers/*` submodule path.

`modal-provider` contains the active Modal packages:

```text
modal-gen-client
modal-2D-client
modal-2D
modal-3D-client
modal-3D
modal-EmbodiedGen
```

Package/deployment independence inside `modal-provider` does not create a new repository boundary.

## Retired standalone inventory

The former standalone repositories `AgentScape-agent`, `modal-inference-hub`, `modal-gen-client`, `modal-2D*`, `modal-3D*`, `kaggle-inference-hub`, `modal-build`, `modal-lab`, and the AgentScape-owned `EmbodiedGen` checkout are historical only and must not be used as the current architecture baseline.
