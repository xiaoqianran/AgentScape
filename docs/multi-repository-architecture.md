# Multi-repository architecture convergence

AgentScape is the integration root. External provider runtimes/clients are pinned Git submodules; the first-party Python SDK is owned directly by the monorepo under `sdk/python`. The stable ownership tree is:

- `providers/modal/*`: Modal image runtime/client, unified connector, and object-3D runtime/client.
- `providers/kaggle/runtime`: Kaggle compatibility/runtime baseline.
- `providers/embodied/runtime`: `modal-build`, which owns deployable EmbodiedGen-facing runtime integration.
- `upstream/EmbodiedGen`: read-only upstream source pin.
- `sdk/python`: first-party AgentScape Python SDK package, versioned and published from this monorepo (distribution name remains `agentscape-client` for compatibility).
- `research/modal-lab`: research-only Modal experiments.

The runtime support plane converges on one `ProviderRegistry` and one paired Connector capability snapshot. Modal 2D, Modal 3D, and EmbodiedGen therefore publish provider-scoped operation IDs through the same capability contract instead of being hard-wired to repository paths. Repository topology never becomes runtime truth: provider results still flow through AgentScape Job/Artifact/Compiler/Admission boundaries before becoming world assets.

`npm run architecture:validate` mechanically checks the pinned submodule topology and repository ownership boundaries. `tests/cross-provider-support-plane-e2e.test.js` verifies that Modal 2D, Modal 3D, and EmbodiedGen can coexist in one Connector snapshot, replace their disabled placeholders atomically, route through one registry, and fall back to placeholders when the Connector session is cleared.

The convergence gate is part of `npm run check`, together with asset validation, the full Vitest suite, and the production build. Repository pin integrity remains separately enforced by `bash scripts/repos.sh check`.
