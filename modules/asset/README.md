# Asset

`modules/asset` owns the lifecycle that turns a verified Artifact into an AgentScape Asset and later materializes that Asset for World runtime use. Entry point: `AssetModule.js`.

It does not schedule generation jobs and does not own World instance state.

## Structure

```text
asset/
├─ AssetModule.js        composition root
├─ model/                Asset definition and validity
├─ production/           Artifact → Asset production
├─ registry/             known Asset metadata and queries
├─ loading/              Asset → runtime object
└─ persistence/          durable local Asset state
```

## Boundaries

- `model/`: `AssetRef`, schema, parts, admission, resource budgets, Asset errors. No external I/O.
- `production/`: `AssetProductionPipeline`, compiler, compiler passes/providers, and external payload adapters. This is the only Artifact → Asset path.
- `registry/`: `AssetRegistry` is manifest identity/registration truth; `AssetCatalog` is its search/read view; built-in manifests live here.
- `loading/`: `AssetLoader` resolves a registered Asset into a Three.js runtime object; `GltfAssetLoader` and built-in factories are loading details.
- `persistence/`: compiled bytes, persisted manifests, and the user-approved `LocalAssetLibrary`.

## Lifecycle

```text
Artifact
   ↓
production
   ↓
model validation / admission
   ↓
registry
   ├─→ persistence
   ↓
loading
   ↓
World Object
```

`AssetModule` is the composition root and the owner of `AssetRegistry`, `AssetLoader`, persistence stores, and Asset production configuration. Heavy geometry services remain in `services/asset-compiler`.

Validation: `npm run test:asset`, `npm run assets:validate`, and `npm run architecture:validate`.
