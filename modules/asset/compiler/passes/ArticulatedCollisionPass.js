import { boxCollidersForNodes, sceneMeshOwnership } from '../partGeometry.js';

export class ArticulatedCollisionPass {
  async run(context) {
    const parts = context.articulation.parts || {};
    const ids = Object.keys(parts);
    if (!ids.length) return context;
    const root = context.document.getRoot();
    const scene = root.getDefaultScene() || root.listScenes()[0];
    if (!scene) return context;
    const nodes = new Map(root.listNodes().map((node) => [node.getName(), node]));
    const partNodes = {};
    for (const id of ids) {
      const node = nodes.get(parts[id].node);
      if (node) partNodes[id] = node;
    }
    const ownership = sceneMeshOwnership(scene, partNodes);
    const generated = [];
    const preserved = [];
    const finalParts = structuredClone(parts);

    for (const id of ids) {
      const part = finalParts[id];
      if (!part.physics?.collider?.generated && part.physics?.colliders?.length) {
        preserved.push({ part:id, colliders:part.physics.colliders.length });
        continue;
      }
      const node = partNodes[id];
      const colliders = boxCollidersForNodes(ownership.get(id) || [], node);
      if (!colliders.length) continue;
      part.physics = {
        body: part.physics?.body || 'dynamic',
        ...part.physics,
        colliders,
        collider: { strategy:'owned-mesh-aabb', quality:'coarse', generated:true }
      };
      generated.push({ part:id, colliders:colliders.length, meshNodes:(ownership.get(id) || []).map((item) => item.getName()) });
    }

    const rootColliders = boxCollidersForNodes(ownership.get(null) || []);
    const generatedPartColliders = generated.length > 0;
    const wholeAssetMass = Number.isFinite(context.physics?.mass) ? context.physics.mass : null;
    const physics = context.physics ? { ...context.physics } : context.physics;
    if (physics && wholeAssetMass != null) delete physics.mass;
    return {
      ...context,
      physics,
      articulation: { ...context.articulation, parts:finalParts },
      collision: { strategy:'articulated-owned-mesh-aabb', quality:rootColliders.length || generatedPartColliders ? 'coarse' : 'provider-part-colliders', colliders:rootColliders },
      partCollision: {
        ...(context.partCollision || {}),
        final: {
          strategy:'nearest-executable-part-ownership',
          rootColliders:rootColliders.length,
          rootMeshNodes:(ownership.get(null) || []).map((node) => node.getName()),
          generated,
          preserved,
          ...(wholeAssetMass != null ? { mass:{ status:'unpartitioned', wholeAssetMass } } : {})
        }
      }
    };
  }
}
