const normalize = (value = '') => String(value).trim().toLowerCase();
const SEARCH_STOPWORDS = new Set(['a', 'an', 'the', 'of', 'to', 'for', 'in', 'on', 'with', 'and', 'or']);

const tokens = (value = '') => normalize(value)
  .split(/[^a-z0-9\u4e00-\u9fff]+/)
  .filter((token) => token && !SEARCH_STOPWORDS.has(token) && (/[^a-z0-9]/.test(token) || token.length >= 2));

export function summarizeAsset(manifest) {
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

export function searchAssetManifests(manifests, query, { limit = 8 } = {}) {
  const all = [...manifests];
  const q = normalize(query);
  if (!q) return all.slice(0, limit).map(summarizeAsset);
  const qTokens = tokens(q);
  const scored = [];
  for (const manifest of all) {
    const fields = [
      manifest.id,
      manifest.type,
      manifest.label,
      manifest.description,
      ...(manifest.tags || []),
      ...(manifest.aliases || [])
    ].filter(Boolean).map(normalize);
    let score = 0;
    for (const field of fields) {
      if (field === q) score += 12;
      else if (field.includes(q)) score += 6;
      for (const token of qTokens) if (field.includes(token)) score += 2;
    }
    if (score > 0) scored.push({ score, asset: summarizeAsset(manifest) });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id))
    .slice(0, limit)
    .map(({ asset }) => asset);
}

export class AssetCatalog {
  constructor({ assetManager }) {
    if (!assetManager?.manifests || typeof assetManager.getManifest !== 'function') {
      throw new TypeError('AssetCatalog requires an assetManager manifest store');
    }
    this.assetManager = assetManager;
  }

  has(assetId) { return this.assetManager.has(assetId); }
  get(assetId) { return this.assetManager.getManifest(assetId); }
  list() { return [...this.assetManager.manifests.values()].map(summarizeAsset); }
  search(query, options) { return searchAssetManifests(this.assetManager.manifests.values(), query, options); }
  summary(manifest) { return summarizeAsset(manifest); }

  resolveExisting(query, { limit = 5, assetId = null } = {}) {
    if (assetId && this.has(assetId)) {
      return { status: 'found', query, assets: [this.summary(this.get(assetId))] };
    }
    const assets = this.search(query, { limit });
    return assets.length
      ? { status: 'found', query, assets }
      : { status: 'missing', query, assets: [] };
  }
}
