# Agent-Ready Asset Compiler

AgentScape 1.1 introduces a pass-based compiler for turning ordinary GLB files into runtime-registerable Agent-Ready assets.

## Pipeline

```text
GLB bytes / URL
   ↓
GLTFInspectPass          @gltf-transform/core + inspect()
   ↓
GeometryPass             bounds / scale diagnostics / origin-to-ground
   ↓
SemanticHeuristicPass    deterministic baseline semantics
   ↓
ArticulationCandidatePass node-based joint candidates
   ↓
ColliderFallbackPass     deterministic AABB fallback
   ↓
RemoteEnrichmentPass     optional CoACD / VLM / articulation service
   ↓
OptimizeGLBPass          glTF-Transform dedup → prune → weld
   ↓
ManifestPass             AgentScape manifest + provenance/report
   ↓
CompiledAssetStore       IndexedDB
   ↓
AssetManager / Three.js / Rapier
```

The compiler is lazy-loaded: glTF-Transform is fetched by the browser only when compilation is requested.

## Why passes

The design follows patterns found while studying ObjaTHOR, EmbodiedGen and Articulate-Anything: asset conversion is not one model call. Geometry normalization, collision, semantics, articulation and validation have different failure modes and should be individually replaceable and observable.

## Local vs heavy passes

Browser-local deterministic passes always remain available. Heavy geometry/vision tasks are provider-backed:

- **CoACD** convex decomposition — implemented by `services/asset-compiler`.
- semantic/affordance VLM enrichment — provider contract prepared; model/backend is replaceable.
- articulation enrichment — provider contract prepared; can wrap an appropriately licensed articulation implementation or external service.

If no provider is configured, collision generation degrades explicitly to `aabb-fallback`; the manifest records that quality level rather than pretending a precise collider was generated.

## Compiled binary persistence

Optimized GLB bytes are stored in IndexedDB (`agentscape-assets`) and manifests use:

```json
{
  "source": {
    "kind": "compiled",
    "key": "compiled_asset_id",
    "fallbackUrl": "https://optional-source/model.glb"
  }
}
```

This means a local uploaded GLB can survive page refresh in the same browser. Scene JSON contains the compiled manifest; for cross-device portability a future scene bundle format should package the binary blobs with `scene.json`.

## Heavy compiler service

See [`services/asset-compiler/README.md`](../services/asset-compiler/README.md). The provided service downloads a public GLB, flattens its scene geometry with trimesh, runs CoACD, and returns Rapier-compatible convex hull colliders plus estimated physics properties.
