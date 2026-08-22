export class RemoteEnrichmentPass {
  constructor({ provider } = {}) { this.provider = provider; }
  async run(context) {
    if (!this.provider?.isConfigured()) return { ...context, enrichment: { skipped: true } };
    const response = await this.provider.run('enrich', {
      source: { name: context.sourceName, url: context.sourceUrl },
      inspection: { nodes: context.inspection.nodes, stats: context.inspection.stats },
      geometry: context.geometry,
      semantics: context.semantics,
      articulationCandidates: context.articulation.candidates
    });
    return {
      ...context,
      semantics: response?.semantics ? { ...context.semantics, ...response.semantics, source: 'provider' } : context.semantics,
      articulation: response?.articulation ? { ...context.articulation, ...response.articulation, source: 'provider' } : context.articulation,
      collision: response?.collision || context.collision,
      physics: response?.physics || context.physics,
      enrichment: { skipped: false, provider: this.provider.endpoint, raw: response }
    };
  }
}
