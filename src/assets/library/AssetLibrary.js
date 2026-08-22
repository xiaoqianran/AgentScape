import { validateAssetManifest } from '../schema.js';

const normalize = (value = '') => String(value).trim().toLowerCase();
const tokens = (value = '') => normalize(value).split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);

export class AssetLibrary {
  constructor({ assetManager, generator = null, events = null } = {}) {
    this.assetManager = assetManager;
    this.generator = generator;
    this.events = events;
  }

  list() {
    return [...this.assetManager.manifests.values()].map((manifest) => this.summary(manifest));
  }

  summary(manifest) {
    return {
      id: manifest.id,
      type: manifest.type,
      label: manifest.label || manifest.id,
      description: manifest.description || '',
      tags: [...(manifest.tags || [])],
      actions: [...manifest.actions],
      source: manifest.source.kind
    };
  }

  search(query, { limit = 8 } = {}) {
    const q = normalize(query);
    if (!q) return this.list().slice(0, limit);
    const qTokens = tokens(q);
    const scored = [];
    for (const manifest of this.assetManager.manifests.values()) {
      const fields = [manifest.id, manifest.type, manifest.label, manifest.description, ...(manifest.tags || []), ...(manifest.aliases || [])]
        .filter(Boolean).map(normalize);
      let score = 0;
      for (const field of fields) {
        if (field === q) score += 12;
        else if (field.includes(q)) score += 6;
        for (const token of qTokens) if (field.includes(token)) score += 2;
      }
      if (score > 0) scored.push({ score, asset: this.summary(manifest) });
    }
    return scored.sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id)).slice(0, limit).map((x) => x.asset);
  }

  async resolve(query, options = {}) {
    const found = this.search(query, { limit: options.limit ?? 5 });
    if (found.length) return { status: 'found', query, assets: found };
    if (!options.generate) return { status: 'missing', query, assets: [] };
    const generated = await this.generate(query, options);
    if (generated.status === 'generator_not_configured') return { status: generated.status, query, assets: [], hint: generated.hint };
    return { status: 'generated', query, assets: [generated] };
  }

  async generate(prompt, options = {}) {
    if (!this.generator?.isConfigured?.()) {
      return {
        status: 'generator_not_configured',
        prompt,
        hint: 'Configure an Asset Generator endpoint before requesting missing assets.'
      };
    }
    const result = await this.generator.generate({ prompt, ...options });
    const manifest = validateAssetManifest(result.manifest);
    this.assetManager.registerManifest(manifest);
    this.events?.emit('asset.registered', { assetId: manifest.id, generated: true });
    return this.summary(manifest);
  }
}
