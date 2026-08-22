const slug = (value) => String(value || 'asset').toLowerCase().replace(/[^a-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'') || 'asset';

export class ManifestPass {
  async run(context) {
    const id = context.assetId || `${slug(context.semantics.type)}_${slug(context.sourceName.replace(/\.(glb|gltf)$/i,''))}`;
    const physics = context.physics || {};
    const manifest = {
      id,
      type: context.semantics.type,
      label: context.semantics.label,
      description: context.semantics.description || '',
      tags: [...new Set(context.semantics.tags || [])],
      aliases: context.semantics.aliases || [],
      source: { kind: 'compiled', key: context.storageKey || id, fallbackUrl: context.sourceUrl || null },
      actions: [...new Set(context.semantics.actions || ['move'])],
      physics: {
        body: physics.body || (context.semantics.actions?.includes('pickup') ? 'dynamic' : 'fixed'),
        mass: Number(physics.mass ?? (context.semantics.actions?.includes('pickup') ? 0.5 : 1)),
        friction: Number(physics.friction ?? 0.5),
        colliders: context.collision.colliders
      },
      compiler: {
        version: context.compilerVersion,
        compiledAt: new Date().toISOString(),
        sourceName: context.sourceName,
        semanticConfidence: context.semantics.confidence,
        collisionStrategy: context.collision.strategy,
        optimization: context.optimization,
        inspection: context.inspection.stats,
        warnings: [...context.geometry.warnings],
        articulationCandidates: context.articulation.candidates
      },
      provenance: { sourceUrl: context.sourceUrl || null, compiler: 'AgentScape' }
    };
    return { ...context, manifest };
  }
}
