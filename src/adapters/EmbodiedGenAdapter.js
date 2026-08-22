const asVec3 = (value, fallback) => Array.isArray(value) && value.length === 3 ? value.map(Number) : fallback;

export class EmbodiedGenAdapter {
  /** Convert a provider payload into an AgentScape runtime manifest.
   * Accepts a deliberately loose shape so adapters can sit in front of multiple EmbodiedGen releases.
   */
  toManifest(payload, { id, glbUrl } = {}) {
    const src = payload?.asset || payload || {};
    const assetId = id || src.id || src.name || `embodied_${crypto.randomUUID()}`;
    const dimensions = asVec3(src.dimensions || src.size, [1, 1, 1]);
    const half = dimensions.map((v) => Math.max(0.01, v / 2));
    const actions = new Set(['move']);
    for (const affordance of src.affordances || []) {
      const name = typeof affordance === 'string' ? affordance : affordance?.type || affordance?.name;
      if (['pickup','open','close','toggle','place'].includes(name)) actions.add(name);
    }
    const url = glbUrl || src.glb_url || src.glbUrl || src.mesh_url || src.meshUrl;
    if (!url) throw new Error('EmbodiedGen adapter requires a browser-reachable GLB URL');
    return {
      id: String(assetId).replace(/[^a-zA-Z0-9_-]+/g, '_'),
      type: src.category || src.type || 'object',
      label: src.label || src.name || assetId,
      description: src.description || '',
      tags: [...new Set([src.category, ...(src.tags || [])].filter(Boolean))],
      source: { kind: 'glb', url },
      actions: [...actions],
      physics: {
        body: src.movable === false ? 'fixed' : 'dynamic',
        mass: Number(src.mass_kg || src.mass || 1),
        friction: Number(src.friction || 0.5),
        colliders: [{ shape: 'box', halfExtents: half, translation: [0, half[1], 0] }]
      },
      provenance: { provider: 'embodiedgen', original: { id: src.id, name: src.name } }
    };
  }
}
