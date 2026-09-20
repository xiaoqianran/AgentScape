# World Authoring v1

> Status: **FROZEN**
>
> Canonical v1 description. world-authoring.md keeps detailed design notes and implementation rationale.

Explicit promotion is now available as an application workflow: [Authoring → Asset → World Entity](authoring-promotion.md). It does not change this frozen document format or make visual edits implicit World mutations.

## Purpose

World Authoring gives an external LLM a familiar Three.js creation surface while keeping AgentScape runtime semantics isolated.

~~~text
LLM writes Three.js
       |
       v
$llm-world subtree
       |
       v
AuthoringState
       |
       v
AuthoringDocument
       |
       +--> revision / diff / undo / redo
       |
       +--> IndexedDB save / open
       |
       v
reloadable authored world
~~~

The central rule is:

~~~text
THREE.Object3D
      !=
AuthoringDocument
      !=
World Entity
~~~

Three.js is the **authoring runtime**.
AuthoringDocument is the **persistent authored state**.
World Entity remains the **semantic runtime state**.

## Boundary

World Authoring owns:

- isolated Three.js subtree
- stable authoring IDs
- capture / export / load
- geometry / material / texture resource pools
- ModelRef / AssetRef
- patch / revision / diff
- undo / redo
- Studio save/open workflow

World Authoring does **not** own:

- WorldCommands
- Physics / Navigation / Interaction
- World Entity mutation
- Asset manifests or AssetRegistry truth
- arbitrary JavaScript persistence

## Runtime architecture

~~~text
                         External LLM
                              |
                     ordinary Three.js
                              |
                              v
                +---------------------------+
                | WorldAuthoringContext     |
                |                           |
                | THREE                     |
                | scene = $llm-world        |
                | clear / onFrame           |
                | modelRef                  |
                +-------------+-------------+
                              |
                              v
                    Live Three.js Subtree
                              |
                         capture()
                              |
                              v
                   +---------------------+
                   | AuthoringState      |
                   | normalized graph    |
                   | nodesById           |
                   | parent/children     |
                   | resource pools      |
                   +----------+----------+
                              |
                          export()
                              |
                              v
                   +---------------------+
                   | AuthoringDocument   |
                   | persistent JSON     |
                   +----+-----------+----+
                        |           |
                revision/diff    Studio Store
                        |           |
                  undo / redo    IndexedDB
~~~

## Live authoring API

The LLM code receives only:

~~~js
THREE
scene
clear()
onFrame(handler)
modelRef(object, reference)
~~~

Example:

~~~js
const house = new THREE.Group();
house.name = 'house';

const wall = new THREE.Mesh(
  new THREE.BoxGeometry(8, 3, 0.2),
  new THREE.MeshStandardMaterial({ color:'#ffffff' })
);

house.add(wall);
scene.add(house);
~~~

The LLM does not directly receive WorldRuntime, renderer, Physics, Navigation, Interaction, AssetRegistry, or WorldCommands.

## Stable identity

Persistent identity is object.userData.authoringId.

~~~text
THREE.uuid        -> runtime identity
authoringId       -> persistent authored identity
~~~

## Persistent document

AuthoringDocument is portable JSON:

~~~js
{
  format: 'agentscape-world-authoring',
  version: 1,
  root: {...},
  geometries: {...},
  materials: {...},
  textures: {...}
}
~~~

Internal editing state is normalized; external persistent state is tree-shaped.

## Supported v1 content

Native persistence supports:

~~~text
Group
Mesh
InstancedMesh

BoxGeometry
SphereGeometry
PlaneGeometry
CylinderGeometry
ConeGeometry
TorusGeometry
BufferGeometry fallback

MeshBasicMaterial
MeshStandardMaterial
MeshPhysicalMaterial

map
normalMap
roughnessMap
metalnessMap
emissiveMap
alphaMap
aoMap

AmbientLight
HemisphereLight
DirectionalLight
PointLight
SpotLight

hierarchy
transform
visibility
shadow flags
JSON metadata
~~~

Unsupported native types fail explicitly instead of being silently discarded.

## ModelRef / AssetRef

Large GLTF assets are not expanded into AuthoringDocument.

~~~text
AuthoringDocument
└─ ModelRef
      |
      +-- URL
      |
      +-- AssetRef { assetId }
~~~

At runtime:

~~~text
ModelRef
   |
loadAsync()
   |
resolveModel()
   |
GLTF / Asset Object3D subtree
~~~

Resolved descendants are runtime detail and do not get re-exported into the authored document. Synchronous load rejects ModelRef; model-backed documents use loadAsync.

## Editing and history

~~~text
live subtree
    |
 commit()
    |
    v
rev_000001
rev_000002
rev_000003  <- cursor
~~~

Supported operations:

~~~js
authoring.commit()
authoring.diff()

authoring.patch()
authoring.patchAsync()

authoring.undo()
authoring.redo()

authoring.undoAsync()
authoring.redoAsync()
~~~

History is bounded and session-local. It is not embedded into AuthoringDocument.

## Persistence workflow

Studio owns persistence:

~~~text
WorldAuthoringContext
       |
     export
       |
       v
AuthoringWorldController
       |
       v
AuthoringWorldStore
       |
       v
IndexedDB
~~~

Studio supports New / Open / Save / Save As / dirty protection.

Dirty means:

~~~text
current live AuthoringDocument
          !=
last successfully saved AuthoringDocument
~~~

This is intentionally independent from revision history.

## Studio frame lifecycle

~~~text
sync input
    |
simulation.pump()
    |
authoring.update(dt, elapsed)
    |
rendering.update()
    |
rendering.render()
~~~

dt and elapsed are seconds.

A failing onFrame handler is removed and reported through authoring.frame-error so authored animation cannot terminate the Studio RAF loop.

## Main application flow

~~~text
createSession()
     |
     +--> WorldRuntime
     |
     +--> RenderingSystem
     |
     +--> WorldAuthoringContext
                |
                v
           $llm-world
                |
        +-------+-------+
        |               |
      export         RuntimeDriver
        |               |
        v               v
 AuthoringDocument   update/frame
        |
        v
 AuthoringWorldController
        |
        v
 AuthoringWorldStore
        |
        v
     IndexedDB
~~~

## Why this architecture exists

Without the intermediate AuthoringDocument:

~~~text
LLM
 -> arbitrary Three.js
 -> scene.toJSON()
 -> persistent World
~~~

would make Three.js implementation details the long-term AgentScape world format.

v1 instead keeps:

~~~text
Three.js
= authoring language/runtime

AuthoringDocument
= persistent visual authored truth

WorldRuntime
= semantic simulation truth
~~~

This preserves the future option to explicitly compile/promote authored nodes into WorldSpec / World Entities.

## v1 non-goals

The following are intentionally deferred:

- native SkinnedMesh / Skeleton serialization
- native morph-target serialization
- native AnimationClip / timeline persistence
- ShaderMaterial / NodeMaterial persistence
- persistent revision repository across sessions
- large-world incremental live patch hydration
- AuthoringDocument -> World Entity promotion
- secure execution of untrusted JavaScript

Current AsyncFunction execution is a capability boundary, **not a security sandbox**.

## Validation

v1 freeze requires:

~~~text
Three subtree -> export -> clear -> load -> equivalent export
ModelRef -> save -> loadAsync -> equivalent export
patch / revision / diff / undo / redo
IndexedDB save/open workflow
Studio authoring frame update
architecture:validate
production build
~~~

Current freeze validation:

~~~text
World Authoring + Studio focused tests  PASS
architecture:validate                  PASS
production build                       PASS
CodeGraph sync                         PASS
~~~

## Freeze rule

Do not expand v1 merely to cover more Three.js classes.

New native serialization or World Entity promotion must be driven by concrete product pressure and belongs to v2.
