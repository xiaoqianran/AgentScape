import { boxCollidersForNodes, sceneMeshOwnership } from '../partGeometry.js';

export class PartColliderPass {
  async run(context) {
    const proposal = context.partProposal;
    if (!proposal?.parts?.length || !context.document) return context;
    const root = context.document.getRoot();
    const scene = root.getDefaultScene() || root.listScenes()[0];
    if (!scene) return context;

    const nodesByName = new Map();
    for (const node of root.listNodes()) {
      const name = node.getName();
      if (!name) continue;
      if (!nodesByName.has(name)) nodesByName.set(name, []);
      nodesByName.get(name).push(node);
    }
    const ids = new Set();
    const partNodes = {};
    for (const part of proposal.parts) {
      const id = String(part.id || '').trim();
      const matches = nodesByName.get(part.node) || [];
      if (!id || ids.has(id) || matches.length !== 1) continue;
      ids.add(id);
      partNodes[id] = matches[0];
    }
    const ownership = sceneMeshOwnership(scene, partNodes);
    const next = structuredClone(proposal);
    const generated = [];
    const skipped = [];

    for (const part of next.parts) {
      const id = String(part.id || '').trim();
      if (part.physics?.colliders?.length) { skipped.push({ part:id, reason:'provider-collider' }); continue; }
      const node = partNodes[id];
      if (!node) { skipped.push({ part:id, reason:'node-unresolved' }); continue; }
      const meshNodes = ownership.get(id) || [];
      const colliders = boxCollidersForNodes(meshNodes, node);
      if (!colliders.length) { skipped.push({ part:id, reason:'geometry-empty' }); continue; }
      part.physics = {
        body: part.physics?.body || 'dynamic',
        ...part.physics,
        colliders,
        collider: { strategy:'proposal-owned-mesh-aabb', quality:'coarse', generated:true }
      };
      generated.push({ part:id, colliders:colliders.length, meshNodes:meshNodes.map((item) => item.getName()) });
    }
    return { ...context, partProposal:next, partCollision:{ provisional:{ strategy:'nearest-proposal-part-ownership', generated, skipped } } };
  }
}
