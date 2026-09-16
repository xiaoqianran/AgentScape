import { assetManifests } from './manifests/index.js';
import { validateAssetManifest } from './schema.js';
import { Errors } from './errors.js';

const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};

export class AssetRegistry {
  constructor({ manifests = assetManifests } = {}) {
    this.manifests = new Map();
    for (const manifest of Object.values(manifests || {})) this.registerManifest(manifest);
  }

  registerManifest(manifest, { replace = false } = {}) {
    validateAssetManifest(manifest);
    const existing = this.manifests.get(manifest.id);
    if (existing && !replace) {
      if (canonical(existing) === canonical(manifest)) return false;
      throw Errors.invalidManifest(`Asset id conflict: ${manifest.id}`, { id: manifest.id });
    }
    this.manifests.set(manifest.id, structuredClone(manifest));
    return true;
  }

  assertCompatibleManifest(manifest) {
    const existing = this.manifests.get(manifest.id);
    if (!existing) return this.registerManifest(manifest);
    if (canonical(existing) !== canonical(manifest)) {
      throw Errors.invalidManifest(`Asset id conflict: ${manifest.id}`, { id: manifest.id });
    }
    return false;
  }

  has(assetId) { return this.manifests.has(assetId); }

  getManifest(assetId) {
    const manifest = this.manifests.get(assetId);
    if (!manifest) throw Errors.assetNotFound(assetId);
    return structuredClone(manifest);
  }

  listManifests() {
    return [...this.manifests.values()].map((manifest) => structuredClone(manifest));
  }

  get size() { return this.manifests.size; }
}
