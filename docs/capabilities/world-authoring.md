# World Authoring

> Canonical frozen v1: [world-authoring-v1.md](world-authoring-v1.md). This file keeps detailed design notes and implementation rationale.

World Authoring lets an external LLM create visual world content with ordinary Three.js code, then persist and restore that authored subtree without making Three.js runtime objects the canonical World model.

## Boundary

```text
External LLM
    |
    | ordinary Three.js
    v
Live Authoring Subtree
THREE.Group("$llm-world")
    |
    | capture()
    v
AuthoringState
normalized editable graph
    |
    | export()
    v
AuthoringDocument
portable persistent JSON
    |
    | future promote/compile
    v
WorldSpec / WorldIR
```

The three identities are intentionally different:

```text
THREE.Object3D != AuthoringDocument != World Entity
```

World Authoring does not own WorldCommands, Physics, Navigation, Interaction, Asset production, or runtime World Entity mutation.

## Reference designs

The design is based on direct source inspection of shallow clones under `wk08/_references`:

- Three.js Editor: `Editor.toJSON() -> scene.toJSON() -> IndexedDB -> ObjectLoader.parseAsync()`. Useful for resource-pool serialization, but too tightly coupled to Three runtime JSON for AgentScape.
- react-three-game: `Prefab -> normalized PrefabState -> runtime Object3D`, with `decomposeModelToPrefabNodes(Object3D)` for the reverse direction. This is the primary reference for AgentScape's editable intermediate state.
- PlayCanvas Editor: persistent scene entity records -> Observer model -> engine entities. This reinforces document/runtime separation and stable entity identity.
- Theatre.js: historic persistent state vs ephemeral non-persistent runtime state. This informs the treatment of `onFrame()` callbacks.

## Live authoring subtree

The runtime authoring surface remains deliberately small:

```js
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(2, 1, 3),
  new THREE.MeshStandardMaterial({ color: '#ffffff' })
);

mesh.name = 'table';
scene.add(mesh);
```

The LLM receives THREE, scene, clear, onFrame, and modelRef. It does not receive WorldRuntime, renderer, physics, navigation, assets, or WorldCommands.

All authored objects live below:

```text
$visual-decorations
└─ $llm-world
```

This makes live authoring visual-only until a future explicit promotion step.

## Stable identity

Three.js `uuid` is runtime identity. World Authoring assigns a separate persistent identity:

```js
object.userData.authoringId
```

Rules:

1. Existing `authoringId` is preserved.
2. Missing IDs are assigned during capture.
3. `load()` restores the persisted IDs.
4. Future edits address authored objects by `authoringId`, not runtime UUID.

## AuthoringState

The in-memory intermediate state is normalized for editing:

```ts
interface AuthoringState {
  version: 1;
  rootId: string;
  nodesById: Record<string, AuthoringNode>;
  childIdsById: Record<string, string[]>;
  parentIdById: Record<string, string | null>;
  geometries: Record<string, GeometryDefinition>;
  materials: Record<string, MaterialDefinition>;
  textures: Record<string, TextureDefinition>;
}
```

This avoids path-based edits such as `root.children[3].children[2]`. A node is addressed directly by ID.

## AuthoringNode

Nodes are component-oriented rather than hard-coded per Three.js class:

```js
{
  id: 'wall_01',
  name: 'Wall',
  components: {
    transform: {
      type: 'Transform',
      properties: {
        position: [0, 1.5, -4],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1]
      }
    },
    mesh: {
      type: 'Mesh',
      properties: { castShadow: true, receiveShadow: true }
    },
    geometry: {
      type: 'GeometryRef',
      properties: { geometryId: 'geo_01' }
    },
    material: {
      type: 'MaterialRef',
      properties: { materialId: 'mat_01' }
    }
  }
}
```

This lets future capabilities add components such as Light, ModelRef, Audio, Animation, or Script without changing the base node schema.

## Resource pools

Like `Object3D.toJSON()`, shared resources are pooled rather than duplicated. Primitive geometry is stored as type + parameters when possible; BufferGeometry is the fallback for arbitrary geometry. Large production meshes should eventually become AssetRefs rather than embedded authoring geometry.

## Authored intent vs runtime defaults

Persistent documents store authored intent, not every Three.js runtime default. Values equal to known defaults should be omitted where practical.

## Ephemeral behavior

`onFrame()` is runtime behavior and is not persisted in v1:

```text
onFrame callback = ephemeral authoring runtime state != persistent animation
```

Persistent animation will require an explicit Animation/Timeline/Behavior representation later.

## Initial API sketch (superseded by frozen v1 spec)

```js
authoring.THREE
authoring.scene
authoring.run(source)
authoring.clear()
authoring.onFrame(handler)
authoring.update(delta, elapsed)
authoring.capture()
authoring.export()
authoring.load(document)
authoring.get(id)
authoring.dispose()
```

`export()` returns a plain JSON-compatible object. It does not perform file or storage IO.

## AuthoringDocument

The portable document is tree-shaped for readability and persistence:

```js
{
  format: 'agentscape-world-authoring',
  version: 1,
  root: {
    id: 'root',
    name: '$llm-world',
    components: { transform: { type: 'Transform', properties: { position: [0,0,0], quaternion: [0,0,0,1], scale: [1,1,1] } } },
    children: []
  },
  geometries: {},
  materials: {}
}
```

The internal normalized state and external tree document are intentionally different representations.

## Initial v1 subset (later expanded)

- Group
- Mesh
- BoxGeometry
- SphereGeometry
- PlaneGeometry
- CylinderGeometry
- ConeGeometry
- TorusGeometry
- BufferGeometry fallback
- MeshBasicMaterial
- MeshStandardMaterial
- MeshPhysicalMaterial
- AmbientLight
- DirectionalLight
- PointLight
- SpotLight
- HemisphereLight
- hierarchy
- local transform
- visibility
- mesh shadow flags
- JSON-compatible metadata

Unsupported object or material types fail explicitly instead of silently dropping authored content.

## Persistence round-trip

```text
empty $llm-world
    | run()
    v
house + mesh + light
    | export()
    v
AuthoringDocument
    | clear()
    v
empty
    | load(document)
    v
restored subtree
    | export()
    v
semantically equivalent AuthoringDocument
```

Promotion into WorldSpec / WorldIR is deliberately outside the v1 document format. The application now provides [explicit Asset/World Entity promotion](authoring-promotion.md). Saving a visual authoring document and turning authored content into formal World Entities remain separate operations.

## Expanded authoring capabilities

### Texture pool

Textures are persisted as shared resources rather than duplicated inside materials.

Supported material slots:

- map
- normalMap
- roughnessMap
- metalnessMap
- emissiveMap
- alphaMap
- aoMap

A texture document records its source plus authored sampler/transform state:

```js
textures: {
  tex_brick: {
    source: { type: 'url', uri: '/textures/brick.png' },
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    repeat: [2, 3],
    offset: [0, 0],
    center: [0, 0],
    rotation: 0,
    colorSpace: 'srgb'
  }
}
```

URL textures are loaded through `TextureLoader` in browser environments. DataTexture sources are embedded as typed-array data and can round-trip synchronously in headless tests.

### InstancedMesh

Repeated authored content can remain instanced instead of expanding into hundreds of Mesh nodes.

The AuthoringDocument stores:

- count
- instance matrices
- optional instance colors
- geometry/material references
- shadow flags

The geometry and material stay in the shared resource pools.

### Document patching

Stable `authoringId` enables targeted document mutation:

```js
authoring.patch({
  update: [{
    id: 'wall_01',
    name: 'north-wall',
    components: {
      transform: {
        properties: {
          position: [4, 2, -1]
        }
      }
    }
  }],
  remove: ['old-chair'],
  add: [{
    parentId: 'room',
    node: {
      id: 'new-lamp',
      name: 'lamp',
      components: {
        transform: {
          type: 'Transform',
          properties: {
            position: [1, 0, 1],
            quaternion: [0, 0, 0, 1],
            scale: [1, 1, 1]
          }
        }
      }
    }
  }]
});
```

`patchDocument(document, patch)` is a pure document operation. The AuthoringContext convenience method `patch(patch)` currently applies the document patch and rehydrates the isolated authoring subtree. A future incremental live-patch path may optimize this without changing the persistent patch format.

Resource definitions can also be added through `geometries`, `materials`, and `textures` in the same patch. Conflicting resource IDs fail explicitly.

## ModelRef / GLTF / AssetRef

Complex models are persisted as opaque references instead of being decomposed into large embedded BufferGeometry trees.

URL-backed model:

```js
{
  type: 'ModelRef',
  properties: {
    source: {
      type: 'url',
      uri: '/models/tree.glb'
    }
  }
}
```

AgentScape asset-backed model:

```js
{
  type: 'ModelRef',
  properties: {
    source: {
      type: 'asset',
      assetRef: { assetId: 'tree_oak_01' }
    }
  }
}
```

LLM-authored Three.js can mark a node directly:

```js
const tree = new THREE.Group();
tree.name = 'tree';
modelRef(tree, { assetRef:{ assetId:'tree_oak_01' } });
scene.add(tree);
```

A ModelRef is an authored leaf. Any GLTF descendants resolved at runtime are opaque runtime detail and are not exported back into AuthoringDocument.

```text
AuthoringDocument ModelRef
        |
        | loadAsync(document, { resolveModel })
        v
Authoring wrapper Group
        |
        +-- resolved GLTF / Asset Object3D subtree
               runtime-only detail
```

The synchronous `load()` path rejects ModelRef explicitly. It never creates a placeholder and never claims that an unresolved model has been restored.

```js
await authoring.loadAsync(document, { resolveModel });
```

`resolveModel(reference, node)` must return an owned `THREE.Object3D` instance. The Authoring subtree owns that instance and may dispose it during clear, patch, reload, or dispose.

### Resolver adapter

`application/world-authoring/AuthoringModelResolver.js` adapts injected model-loading capabilities without importing Asset internal modules:

```js
const resolveModel = createAuthoringModelResolver({
  assetLoader,
  gltfLoader
});
```

Resolution rules:

- URL ModelRef -> injected `gltfLoader.loadScene(uri)`
- Asset ModelRef -> injected `assetLoader.instantiate(assetId)`

The AuthoringDocument keeps only the stable AssetRef. It does not copy the Asset manifest and does not become a second asset registry.

A live document containing ModelRef uses `patchAsync()` when rehydration is required:

```js
await authoring.patchAsync(patch, { resolveModel });
```

Pure `patchDocument(document, patch)` remains synchronous.

## Revision history, diff, undo and redo

Revision history is an editor/application concern and is intentionally not embedded inside AuthoringDocument.

```text
AuthoringDocument
      |
      | commit()
      v
Revision History
      |
      +-- rev_000001
      +-- rev_000002
      +-- rev_000003  <- cursor
```

v1 stores immutable document snapshots behind a bounded history window. This is deliberately simple and reliable: arbitrary Three.js changes made through `run()` can be checkpointed even when they did not originate from a structured patch.

The storage representation can later be optimized into snapshot + patch chains without changing the public API.

### Commit behavior

A new AuthoringContext begins with:

```text
rev_000001
Initial world
```

Arbitrary live Three.js changes are checkpointed explicitly:

```js
await authoring.run(source);
authoring.commit('Build garden');
```

Structured patch operations commit automatically:

```js
authoring.patch(patch, { label:'Move house' });

await authoring.patchAsync(patch, {
  resolveModel,
  label:'Move imported tree'
});
```

Loading a different AuthoringDocument resets the in-session history around that loaded world.

Repeated `commit()` calls with no document change are deduplicated.

### Stable-ID diff

```js
const change = authoring.diff();
```

With no arguments, `diff()` compares the current committed revision against the current live subtree. This is useful for inspecting uncommitted LLM edits.

Diff reports:

```text
nodes
├─ added
├─ removed
├─ updated
└─ moved

resources
├─ geometries
├─ materials
└─ textures
   each: added / removed / updated
```

Compare an older revision with the current live world:

```js
authoring.diff('rev_000002');
```

Compare two committed revisions:

```js
authoring.diff('rev_000002', 'rev_000005');
```

Hierarchy movement is detected from stable node ID plus parent/index changes.

### Undo / redo

For documents without ModelRef:

```js
authoring.undo();
authoring.redo();
```

For revisions containing ModelRef:

```js
await authoring.undoAsync({ resolveModel });
await authoring.redoAsync({ resolveModel });
```

A failed synchronous or asynchronous hydration does not leave the revision cursor moved.

If the user undoes and then creates a new commit, the old redo branch is discarded:

```text
A -> B -> C
     ^
    undo

new commit D

A -> B -> D
         ^
C is discarded
```

The history is bounded by `historyLimit` (default 64) to prevent unbounded editor memory growth.

### Revision API

```js
authoring.commit(labelOrOptions)

authoring.history()
authoring.currentRevision()

authoring.diff()
authoring.diff(fromRevisionId)
authoring.diff(fromRevisionId, toRevisionId)

authoring.canUndo()
authoring.canRedo()

authoring.undo()
authoring.redo()

authoring.undoAsync({ resolveModel })
authoring.redoAsync({ resolveModel })
```

Revision metadata contains ID, index, label, source, and creation time. Document snapshots remain internal to the history object rather than being exposed through `history()`.

## Current supported surface

The verified persistent/editor surface now includes:

- Group / hierarchy / transforms / metadata
- Mesh
- InstancedMesh
- primitive geometries and BufferGeometry fallback
- MeshBasicMaterial
- MeshStandardMaterial
- MeshPhysicalMaterial
- shared Texture/DataTexture resources
- common PBR texture slots
- Ambient / Hemisphere / Directional / Point / Spot lights
- stable authoring IDs
- pure AuthoringDocument patches
- `patch()` and `patchAsync()`
- opaque URL ModelRef
- opaque AgentScape AssetRef ModelRef
- async model hydration through injected resolver
- bounded revision history
- stable-ID document diff
- undo / redo
- async undo / redo for model-backed revisions

Complex GLTF contents such as SkinnedMesh, Skeleton, morph targets, or animations may exist inside a resolved ModelRef subtree. They are treated as opaque asset/runtime content rather than native AuthoringDocument nodes.

Still intentionally outside native AuthoringDocument serialization:

- embedded SkinnedMesh / Skeleton serialization
- embedded morph targets
- native AnimationClip/timeline persistence
- ShaderMaterial / NodeMaterial
- render targets
- arbitrary JavaScript persistence
- `onFrame()` persistence

## Persistent Studio world files

World Authoring persistence is hosted by Studio instead of being owned by WorldAuthoringContext.

```text
WorldAuthoringContext
       |
       | export()
       v
AuthoringDocument
       |
       v
AuthoringWorldController
       |
       v
AuthoringWorldStore
       |
       v
IndexedDB
```

`apps/studio/persistence/AuthoringWorldStore.js` stores records with:

```js
{
  id,
  name,
  createdAt,
  updatedAt,
  document
}
```

Browser Studio uses IndexedDB by default. A shared in-memory Map can be injected for headless tests.

The store exposes only:

```js
save({ id, name, document })
load(id)
list()
remove(id)
```

`list()` returns metadata without copying the potentially large AuthoringDocument payload.

## Studio New / Open / Save workflow

`AuthoringWorldController` owns file-style workflow state:

```text
New
Open
Save
Save As
Dirty
```

Dirty state is not based on the latest revision. It is calculated by diffing the live AuthoringDocument against the last successfully saved document:

```text
last saved document
        |
        | diff
        v
current live document
        |
        +-- empty diff  -> saved
        +-- changes     -> dirty
```

This means `patch()` may create an editor revision while the world still correctly remains unsaved until `save()` succeeds.

Saving checkpoints any uncommitted live Three.js changes before writing the document.

Opening a persisted world uses `loadAsync()`, so ModelRef-backed documents use the same injected model resolver as the rest of World Authoring.

New/Open operations in Studio ask before discarding dirty authored content.

## Studio runtime lifecycle

Studio now passes World Authoring into `RuntimeDriver`.

Per frame:

```text
sync input
    |
simulation.pump(frameTime)
    |
authoring.update(deltaSeconds, elapsedSeconds)
    |
rendering.update()
    |
rendering.render(frameTime)
```

The first authored frame receives `delta=0, elapsed=0`. Later frames use seconds.

This keeps frame scheduling outside WorldRuntime while allowing `onFrame()` authoring behavior to run in the real Studio loop.

ModelRef resolution is composed in Studio from capabilities already exposed by the runtime Asset loader:

```text
URL ModelRef
  -> world.assetLoader.loadGLB(uri)

AssetRef ModelRef
  -> world.assetLoader.instantiate(assetId)
```

World Authoring does not import Asset loading internals.

Unsaved-world prompting uses `beforeunload`. Destructive runtime cleanup uses `pagehide`, so canceling a navigation prompt does not leave Studio already disposed.

## World Authoring v1 freeze

World Authoring v1 is considered feature-complete at the following boundary:

```text
ordinary Three.js authoring
        |
live isolated subtree
        |
capture / export
        |
AuthoringDocument
        |
patch / revision / diff
        |
undo / redo
        |
ModelRef / AssetRef
        |
IndexedDB save / open
        |
Studio lifecycle
```

v1 intentionally does not expand native serialization further.

Future work is pressure-driven v2 work, not a v1 correctness requirement:

- native AnimationClip / timeline authoring
- native SkinnedMesh / Skeleton serialization
- native morph-target serialization
- ShaderMaterial / NodeMaterial authoring
- incremental live patching for very large authored scenes
- durable revision repositories across application sessions
- explicit AuthoringDocument -> WorldSpec / World Entity promotion
- security isolation for untrusted generated JavaScript

The current `AsyncFunction` execution boundary remains suitable only for trusted/self-generated code. It is not a security sandbox.
