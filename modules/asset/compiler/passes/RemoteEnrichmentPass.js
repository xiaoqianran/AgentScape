export class RemoteEnrichmentPass {
  constructor({ provider } = {}) { this.provider = provider; }

  async run(context) {
    if (!this.provider?.isConfigured()) return { ...context, enrichment: { skipped: true } };
    try {
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
        articulation: context.articulation,
        partProposal: response?.partProposal || context.partProposal || null,
        partSegmentation: response?.partSegmentation || context.partSegmentation || null,
        collision: response?.collision || context.collision,
        physics: response?.physics || context.physics,
        meshQuality: response?.geometry || context.meshQuality || null,
        enrichment: { skipped: false, provider: this.provider.endpoint }
      };
    } catch (error) {
      return {
        ...context,
        enrichment: { skipped: true, provider: this.provider.endpoint, error: error.message }
      };
    }
  }
}
