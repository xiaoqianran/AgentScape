const slug = (value) => String(value || 'asset').toLowerCase().replace(/[^a-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'') || 'asset';

export class ManifestPass {
  async run(context) {
    const id = context.assetId || `${slug(context.semantics.type)}_${slug(context.sourceName.replace(/\.(glb|gltf)$/i,''))}`;
    const physics = context.physics || {};
    const parts = context.articulation.parts || undefined;
    const actions = new Set(context.semantics.actions || ['move']);
    if (parts && Object.values(parts).some((part) => part.actions?.includes('open'))) actions.add('open');
    if (parts && Object.values(parts).some((part) => part.actions?.includes('close'))) actions.add('close');

    const manifest = {
      id,
      type: context.semantics.type,
      label: context.semantics.label,
      description: context.semantics.description || '',
      tags: [...new Set(context.semantics.tags || [])],
      aliases: context.semantics.aliases || [],
      source: { kind: 'compiled', key: context.storageKey || id, fallbackUrl: context.sourceUrl || null },
      actions: [...actions],
      ...(parts ? { parts } : {}),
      physics: {
        body: physics.body || (actions.has('pickup') ? 'dynamic' : 'fixed'),
        mass: Number(physics.mass ?? (actions.has('pickup') ? 0.5 : 1)),
        friction: Number(physics.friction ?? 0.5),
        colliders: context.collision.colliders
      },
      compiler: {
        version: context.compilerVersion,
        compiledAt: new Date().toISOString(),
        sourceName: context.sourceName,
        quality: context.quality,
        semanticConfidence: context.semantics.confidence,
        collisionStrategy: context.collision.strategy,
        optimization: context.optimization,
        inspection: context.inspection.stats,
        structure: context.structure,
        normalization: context.normalization,
        articulationCandidates: context.articulation.candidates,
        meshQuality: context.meshQuality || null,
        resources: context.resources
      },
      provenance: { sourceUrl: context.sourceUrl || null, compiler: 'AgentScape' }
    };
    return { ...context, manifest };
  }
}
