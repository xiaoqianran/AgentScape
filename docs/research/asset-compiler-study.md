# Asset compiler source study

The following repositories were cloned and CodeGraph-indexed before AgentScape 1.1 was implemented.

| Project | License observed | Principle reused |
| --- | --- | --- |
| allenai/objathor | Apache-2.0 | staged GLB normalization, canonical sizing/orientation, collider generation, annotation/visibility, simulator validation |
| SarahWeiii/CoACD | MIT | convex decomposition as a standalone geometry service with deterministic parameters |
| donmccurdy/glTF-Transform | MIT | direct library reuse for GLB read/write, inspection and optimization transforms |
| vlongle/articulate-anything | no license file observed | articulation actor→compile→render→feedback→retry architecture only; no source copied |

## ObjaTHOR lesson

The useful abstraction is not `GLB → format conversion`. Its pipeline establishes physical scale, cleans geometry, generates colliders and metadata, then validates the result in its target simulator. AgentScape mirrors the staged nature while targeting a browser runtime instead of THOR.

## CoACD lesson

Collision geometry is a compiler artifact, not a rendering artifact. CoACD takes vertices/faces and returns multiple convex hull meshes. AgentScape exposes `convexHull` in its collider schema and converts returned hull vertices into `Rapier.ColliderDesc.convexHull(...)`.

## glTF-Transform lesson

Do not write another glTF parser or optimizer. AgentScape directly uses glTF-Transform for binary IO, structured inspection and `dedup → prune → weld`. The compiler is dynamically imported so normal world runtime startup does not pay the dependency cost.

## Articulate-Anything lesson

A useful articulation system separates links/parts from joint prediction, compiles a candidate articulation into an executable representation, renders or simulates the predicted motion, and uses feedback to retry. Because the studied repository had no license file, AgentScape implements only a clean-room provider interface and local node-name candidate detector; no source was copied.
